import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFollowBottom } from "@hooks/useFollowBottom";
import { generateEdit, getScAccount } from "@utils/sc";
import { GENERATE_PROMPT } from "./config";
import styles from "./x.module.css";

type Locale = "en" | "ja" | "zh";

type XComp = {
  source?: string;
  prompt?: string;
  showSource?: boolean;
  autoFix?: boolean;
};

/* What the board's Generate button needs to know to rewrite this card: where its
   text is, and where the rewrite goes. Declared here rather than imported because
   a module is its own package — the board's copy of this shape is in Home.tsx. */
type GenerateTarget = {
  content: () => string;
  prompt?: string;
  onGenerated: (next: string) => void;
  onDone?: (text: string) => void;
  onBusy?: (busy: boolean) => void;
};

/**
 * How long the source has to sit still before it is rendered again. A rewrite
 * streams in a chunk at a time (every 60ms, see Generate.tsx), and rendering each
 * chunk would put half a document on screen dozens of times over — so nothing is
 * rendered until the writing stops, whether that writing is a stream or someone
 * typing in the source.
 *
 * This is the timer for text arriving by every route *except* a finished rewrite,
 * which says so and renders at once (see `onDone`).
 */
const SETTLE_MS = 700;

/**
 * How long an error waits before it is sent back to be repaired. A stream that
 * pauses longer than SETTLE_MS renders a half-finished document, which throws for
 * a reason that fixes itself two chunks later; anything still broken after this
 * has stopped being written and is genuinely broken.
 */
const AUTO_FIX_DELAY_MS = 1500;

/**
 * Consecutive repairs attempted without being asked. A model that can't fix its
 * own output in two tries usually can't fix it in ten either, and each attempt is
 * a full rewrite — so it stops and hands the button to the user. Reset by any edit
 * or Generate that isn't itself a repair.
 */
const MAX_AUTO_FIX = 2;

/** Errors kept from one render. The bar shows the first; the rest go to the model. */
const MAX_ERRORS = 3;

const STRINGS = {
  empty: {
    en: "Nothing here yet — press the brain in the header and describe what you want.",
    ja: "まだ空です。ヘッダーの脳ボタンから、作りたいものを説明してください。",
    zh: "还是空的 —— 点标题栏的大脑按钮，说说你想要什么。",
  },
  writing: { en: "Writing…", ja: "生成中…", zh: "生成中…" },
  noCredential: {
    en: "Sign in to simple-ai from the user menu to repair this.",
    ja: "修復するには、ユーザーメニューから simple-ai にサインインしてください。",
    zh: "要修复它，请先在用户菜单里登录 simple-ai。",
  },
  fixing: { en: "Repairing…", ja: "修復中…", zh: "修复中…" },
  fix: { en: "Repair", ja: "修復", zh: "修复" },
  fixFailed: { en: "Repair failed.", ja: "修復に失敗しました。", zh: "修复失败。" },
  source: { en: "Source", ja: "ソース", zh: "源码" },
  previewTitle: { en: "Widget", ja: "ウィジェット", zh: "小工具" },
} satisfies Record<string, Record<Locale, string>>;

/* Appended to the standing prompt for both a rewrite and a repair: the answer is
   written straight into the document, so anything wrapped around it — a fence, a
   sentence of explanation — ends up being rendered as part of the page. */
const ANSWER_RULE =
  "Answer with the complete HTML document alone — no markdown fences, no commentary before or after it.";

const FIX_RULE =
  "This document threw the error below when it ran. Fix the cause and answer with the whole corrected document. " +
  ANSWER_RULE;

function getLocale(language: string): Locale {
  return language === "ja" || language === "zh" ? language : "en";
}

/**
 * The script injected into every rendered document. Two jobs, both of which exist
 * because the frame has no origin of its own:
 *
 * - `localStorage` and `sessionStorage` *throw on access* under a null origin, and
 *   a widget that reaches for one would die on a line that works everywhere else.
 *   They are replaced with in-memory stand-ins, which is also the honest contract:
 *   nothing here survives the next render.
 * - Nothing inside the frame can reach the card, so errors are posted out to it.
 *   That is what the repair loop reads.
 */
function bridgeScript(channel: string): string {
  return `(() => {
  const channel = ${JSON.stringify(channel)};
  const post = (text) => {
    try { parent.postMessage({ source: "liveboard-x", channel, text: String(text) }, "*"); } catch (_error) {}
  };
  const describe = (value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (_error) { return String(value); }
  };
  const memoryStorage = () => {
    const values = new Map();
    return {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },
      key(index) { return Array.from(values.keys())[Number(index)] ?? null; },
      removeItem(key) { values.delete(String(key)); },
      setItem(key, value) { values.set(String(key), String(value)); }
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    try { window[name].length; } catch (_error) {
      try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch (_defineError) {}
    }
  }
  addEventListener("error", (event) => post(describe(event.error || event.message)));
  addEventListener("unhandledrejection", (event) => post(describe(event.reason)));
  const original = console.error.bind(console);
  console.error = (...values) => {
    original(...values);
    post(values.map(describe).join(" "));
  };
})();`;
}

/**
 * The base stylesheet every document is rendered on top of. It goes in *before* the
 * document's own head, so anything the widget declares wins — this only decides what
 * an unstyled element looks like, which is what keeps a generated card from arriving
 * in Times New Roman with the browser's default margin around it.
 */
const BASE_STYLE = `html, body { height: 100%; }
  /* No padding here, deliberately. A widget laid out to \`100vh\` or \`100%\` — which is
     most of them, having been told to fill the card — measures against the viewport,
     while padding on body pushes it down and out. The result was a document taller
     than its frame by exactly twice the padding, on every widget, whatever it was:
     the scrollbar that never went away. The card's own body has no padding for the
     same reason (card.module.css), and a widget that wants breathing room puts it
     inside its own box, where border-box below keeps it from adding to the height.

     \`flow-root\` is what padding was also quietly doing: containing the top margin of
     a first child — a leading <h1> — instead of letting it collapse out through body
     and make the page taller than the viewport all over again. */
  body { margin: 0; display: flow-root; font-family: Helvetica, sans-serif; font-size: 13px; line-height: 1.5; color: #0f172a; background: #fff; -webkit-text-size-adjust: 100%; }
  *, *::before, *::after { box-sizing: border-box; }
  /* No bars inside the widget, the way the page itself and every module that
     scrolls hides its own (global.css, card.module.css). A bar down the side of a
     card this size costs more room than what it scrolls is worth, and the wheel
     still scrolls whatever it is over. Declared for both the old rule and the new —
     scrollbar-width only landed in Safari 18.4, and this board is read on an old
     iPad too — and the WebKit one is declared bare as well as through the universal
     selector, because the bar the viewport paints is the document's own and does not
     reliably answer to \`*\`. */
  * { scrollbar-width: none; -ms-overflow-style: none; }
  ::-webkit-scrollbar { display: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none; }`;

/**
 * Wraps a widget's source into the document that actually gets rendered. The head
 * content has to land inside `<head>` — a `<script>` placed after `<body>` opens
 * would miss the errors thrown by anything above it, which is most of them.
 */
function buildDocument(source: string, channel: string): string {
  const head = `<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BASE_STYLE}</style>
<script>${bridgeScript(channel)}</script>`;

  if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${head}`);
  if (/<html(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<html(?:\s[^>]*)?>/i, (tag) => `${tag}<head>${head}</head>`);
  }
  // A fragment rather than a document — a bare <div> and a <style>, which is what a
  // model hands back when the instruction was small enough not to warrant a page
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
}

export default function X({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const locale = getLocale(i18n.language);
  const comp = config.comp as XComp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;

  const source = comp?.source ?? "";
  const prompt = comp?.prompt ?? GENERATE_PROMPT;
  const showSource = comp?.showSource ?? false;
  const autoFix = comp?.autoFix ?? true;

  /* What is on screen right now. Set only by `render` below — never derived from
     `source`, because the source changes far more often than it is worth rendering.
     The channel doubles as the iframe's key, so a re-run with unchanged text still
     remounts the frame and actually runs again. */
  const [rendered, setRendered] = useState<{ channel: string; doc: string }>({ channel: "", doc: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [fixing, setFixing] = useState(false);
  const [fixFailed, setFixFailed] = useState(false);
  /* Two halves of one run, kept apart because they are shown differently.
     `busy` covers the whole of it, opening wait included — that stretch belongs to
     the board's own overlay, and all the card has to do is not show anything
     underneath it that would read through the veil.
     `writing` starts at the first chunk, which is where the board's overlay steps
     back: from there the card is expected to show the text arriving, and this card
     is deliberately not rendering it yet, so it says so instead. */
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef("");
  const runIdRef = useRef(0);
  /* The text that is currently rendered. `null` until the first render, which is
     how the effect below tells "just mounted, show what was saved at once" from
     "someone is writing, wait for them to stop". */
  const renderedSourceRef = useRef<string | null>(null);
  const autoFixCountRef = useRef(0);
  const fixingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /* `busy` again, for the two readers that can't wait for a render: the repair loop
     (a document still being written is not a document that failed, so an error
     thrown by half of one is not worth a repair) and `onGenerated`, which has to
     tell a chunk of a live run from an undo replaying old text at it. */
  const busyRef = useRef(false);

  const { mark, follow } = useFollowBottom(sourceRef);

  const persist = useCallback(
    (patch: Partial<XComp>) => {
      save?.({ ...comp, ...patch });
    },
    [save, comp],
  );

  const render = useCallback((next: string) => {
    const channel = `x-${++runIdRef.current}`;
    channelRef.current = channel;
    renderedSourceRef.current = next;
    setErrors([]);
    setFixFailed(false);
    setRendered({ channel, doc: next.trim() ? buildDocument(next, channel) : "" });
  }, []);

  /* The source landing on screen. A card coming back (board switched, page
     reloaded) renders what it had at once; every later change waits for the
     writing to stop, so a stream is watched in the panel and rendered once. */
  useEffect(() => {
    if (source === renderedSourceRef.current) return;
    if (renderedSourceRef.current === null) {
      render(source);
      return;
    }
    const timer = window.setTimeout(() => {
      // Nothing has written for SETTLE_MS, so whatever was writing has stopped —
      // including a run that ended without reporting (aborted, or the card was away
      // when it finished). This is the flags' only other way back down.
      busyRef.current = false;
      setBusy(false);
      setWriting(false);
      render(source);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [source, render]);

  /* Errors posted out of the frame. Checked three ways — the tag, the channel of
     the render that is on screen, and the frame itself — so a message from another
     card's widget, or from anything else on the page, is not read as this one's. */
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; channel?: string; text?: string } | null;
      if (
        !data ||
        data.source !== "liveboard-x" ||
        data.channel !== channelRef.current ||
        event.source !== iframeRef.current?.contentWindow ||
        typeof data.text !== "string"
      )
        return;
      const text = data.text;
      setErrors((prev) => (prev.includes(text) || prev.length >= MAX_ERRORS ? prev : [...prev, text]));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  /* The card's own text and how to write it, for the callbacks below: a Generate
     target and a Refresh handler are both registered once and outlive the render
     that made them, so neither can read from that render's closure. */
  const liveRef = useRef({ source, prompt, persist, render });
  useEffect(() => {
    liveRef.current = { source, prompt, persist, render };
  });

  const repair = useCallback(async (messages: string[]) => {
    if (fixingRef.current) return;
    const broken = liveRef.current.source;
    if (!broken.trim() || !messages.length) return;
    if (!getScAccount().token) return;

    const controller = new AbortController();
    abortRef.current = controller;
    fixingRef.current = true;
    setFixing(true);
    setFixFailed(false);

    try {
      const next = await generateEdit({
        content: broken,
        instruct: liveRef.current.prompt,
        prompt: `${FIX_RULE}\n\n${messages.join("\n")}`,
        // The repair streams into the source the same way a rewrite does, so it can
        // be watched in the panel; the settle timer decides when it is rendered
        onText: (partial) => {
          if (!controller.signal.aborted) liveRef.current.persist({ source: partial });
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (next.trim()) liveRef.current.persist({ source: next });
      else setFixFailed(true);
    } catch {
      if (!controller.signal.aborted) setFixFailed(true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      fixingRef.current = false;
      setFixing(false);
    }
  }, []);

  /* A broken document sends itself back to be fixed. The delay is what keeps a
     half-streamed document from being "repaired" while it is still being written:
     any further chunk re-renders, which clears the errors and cancels this. */
  useEffect(() => {
    if (!errors.length || !autoFix || fixing || fixFailed) return;
    if (autoFixCountRef.current >= MAX_AUTO_FIX || busyRef.current) return;
    const timer = window.setTimeout(() => {
      autoFixCountRef.current += 1;
      void repair(errors);
    }, AUTO_FIX_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [errors, autoFix, fixing, fixFailed, repair]);

  /* A card unmounted mid-repair (deleted, board switched) shouldn't leave the
     request running against a card that is no longer there */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* Where the header's Generate button reads this card's text and writes the
     rewrite back. Registering it is also what puts that button in the header.
     Registered once: the board keys these by card id and compares by identity, so
     handing it a new function every render would loop. */
  useEffect(() => {
    const setGenerate = config._setGenerate as ((target: GenerateTarget | null) => void) | undefined;
    setGenerate?.({
      content: () => liveRef.current.source,
      prompt: `${liveRef.current.prompt} ${ANSWER_RULE}`,
      // The whole run, opening wait included. `writing` is cleared from here rather
      // than from `onDone`, which a run that changed nothing never reaches.
      onBusy: (next) => {
        busyRef.current = next;
        setBusy(next);
        if (!next) setWriting(false);
      },
      onGenerated: (next) => {
        // A rewrite the user asked for starts the repair budget over — whatever the
        // last document couldn't fix about itself, this is not that document
        autoFixCountRef.current = 0;
        // Only a live run is being written; Ctrl+Z replaying an old version through
        // here is text arriving, not a card at work, and shouldn't say it is
        if (busyRef.current) setWriting(true);
        mark();
        liveRef.current.persist({ source: next });
      },
      // The run is over, so this is the document — render it now rather than waiting
      // out a settle timer on text that is already final. The text comes in with the
      // call because the last chunk written above has not been through a render yet.
      onDone: (final) => {
        if (final.trim()) liveRef.current.render(final);
      },
    });
    return () => setGenerate?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Refresh runs the widget again from the top — the closest thing this card has to
     re-reading its data. Same text, new frame: a clock starts over, a random layout
     comes out different, a widget that failed on a transient gets another go. */
  useEffect(() => {
    const setRefresh = config._setRefresh as ((fn: (() => void) | null) => void) | undefined;
    setRefresh?.(() => {
      autoFixCountRef.current = 0;
      liveRef.current.render(liveRef.current.source);
    });
    return () => setRefresh?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A rewrite arrives a chunk at a time; keep the newest line in view for someone
     reading the source panel who was already at the end of it */
  useLayoutEffect(() => {
    follow();
  }, [source, follow]);

  function handleSourceChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    // Hand-edited, so the repair budget starts over for the same reason a rewrite
    // resets it: this is no longer the document that couldn't fix itself
    autoFixCountRef.current = 0;
    persist({ source: e.target.value });
  }

  const canRepair = Boolean(errors.length) && !fixing;
  const status = fixing
    ? STRINGS.fixing[locale]
    : fixFailed
      ? STRINGS.fixFailed[locale]
      : // Short-circuits on the empty case: this reads localStorage, and every board
        // save re-renders the card
        errors.length && !getScAccount().token
        ? STRINGS.noCredential[locale]
        : (errors[0] ?? "");

  return (
    <div className={styles.container}>
      {/* The source takes the card rather than splitting it: at the size these cards
          are, half of one is too little to read code in and too little to run it in
          either. The toggle in the footer swaps which one is showing. */}
      <div className={styles.stage}>
        {showSource ? (
          <textarea
            ref={sourceRef}
            className={styles.code}
            value={source}
            spellCheck={false}
            onChange={handleSourceChange}
            aria-label={STRINGS.source[locale]}
          />
        ) : rendered.doc ? (
          <iframe
            key={rendered.channel}
            ref={iframeRef}
            className={styles.frame}
            srcDoc={rendered.doc}
            title={STRINGS.previewTitle[locale]}
            /* allow-scripts and nothing else. Adding allow-same-origin alongside it
               would let the document reach out and remove its own sandbox, which is
               the whole guard — see the README. */
            sandbox="allow-scripts"
          />
        ) : (
          // Gone for the whole run, not just the writing half: through the opening
          // wait the board's overlay is only 85% opaque, and a line saying the card
          // is empty reads straight through the veil that is saying it is working
          !busy && <p className={styles.placeholder}>{STRINGS.empty[locale]}</p>
        )}
        {writing && (
          /* Over the whole card while there is nothing under it, out of the way in a
             corner once there is: a rewrite can run for the better part of a minute,
             and veiling a working widget for that long hides the thing the card is
             for. Either way it takes no clicks — the widget underneath stays live.
             Only from the first chunk: until then this would sit under the board's
             own overlay saying the same thing twice. */
          <span className={`${styles.working} ${rendered.doc && !showSource ? styles.workingBadge : styles.workingAlone}`}>
            {STRINGS.writing[locale]}
          </span>
        )}
      </div>

      {status && (
        <div className={styles.errorBar}>
          <span className={styles.errorText} title={errors.join("\n")}>
            {status}
          </span>
          {canRepair && (
            <button type="button" className={styles.errorAction} onClick={() => void repair(errors)}>
              {STRINGS.fix[locale]}
            </button>
          )}
        </div>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.toggle}
          title={STRINGS.source[locale]}
          aria-pressed={showSource}
          onClick={() => persist({ showSource: !showSource })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6 3.5 12 9 18" />
            <path d="M15 6 20.5 12 15 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
