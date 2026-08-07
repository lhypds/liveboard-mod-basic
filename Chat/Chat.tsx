import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getScAccount } from "@utils/sc";
import {
  DEFAULT_BRIDGE_URL,
  connectSc,
  newSessionId,
  normalizeBridgeUrl,
  trailingPrompt,
  type ScClient,
  type ScState,
} from "./sc";
import styles from "./chat.module.css";

type Lang = "en" | "ja" | "zh";

type ChatComp = {
  bridgeUrl?: string;
  bridgeSession?: string;
  scSession?: string;
  model?: string;
  terminal?: string;
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 20000;

const STRINGS: Record<string, Record<Lang, string>> = {
  starting: { en: "Starting sc…", ja: "sc を起動中…", zh: "正在启动 sc…" },
  unavailable: {
    en: "No answer from the sc bridge at {{url}}",
    ja: "sc ブリッジ ({{url}}) が応答しません",
    zh: "sc 桥接服务 ({{url}}) 无响应",
  },
  unconfigured: {
    en: "No sc bridge set — put one in this card's config (bridgeUrl), or in VITE_SC_BRIDGE_URL",
    ja: "sc ブリッジが未設定です — このカードの config (bridgeUrl) か VITE_SC_BRIDGE_URL に指定してください",
    zh: "未设置 sc 桥接服务 —— 请在本卡片的 config (bridgeUrl) 或 VITE_SC_BRIDGE_URL 中填写",
  },
};

function useLang(): Lang {
  const { i18n } = useTranslation();
  return (i18n.language as Lang) in STRINGS.starting ? (i18n.language as Lang) : "en";
}

// `:login <user> <password>` is forwarded to the CLI as typed, but the terminal is saved
// in the board's config, so the password never goes in it. Matched per line, because a
// message can span several.
function forScrollback(line: string): string {
  return line.replace(/^(:login\s+\S+\s+)(\S+)(.*)$/gim, (_, head, pass, tail) => {
    return `${head}${"*".repeat(pass.length)}${tail}`;
  });
}

// The two lines that wipe the screen, as they do in the CLI and on the bridge's own terminal
// page. `:clear` clears the CLI's with an escape code (cli.js writes `\x1Bc`) that the bridge
// strips out on its way here, so it would otherwise pass unnoticed; `:reset` starts the
// conversation over, which the card has more to do about — see submit(). The reset-suffixed
// commands (`:model reset`, `:store reset`, …) are other commands and match neither.
const CLEAR = /^:clear\b/i;
const RESET = /^:reset\b/i;

export default function Chat({ config }: { config: Record<string, unknown> }) {
  const lang = useLang();
  const comp = config.comp as ChatComp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const cardId = typeof config._id === "string" ? config._id : "";

  // The bridge this card talks to: its own if it names one, the deployment's default otherwise.
  const bridgeUrl = normalizeBridgeUrl(comp?.bridgeUrl) || DEFAULT_BRIDGE_URL;

  const maxChars = typeof comp?.maxChars === "number" ? comp.maxChars : DEFAULT_MAX_CHARS;
  // Keep the scrollback bounded, cutting at a line break so the top stays readable.
  const cap = (text: string) => {
    if (maxChars <= 0 || text.length <= maxChars) return text;
    const tail = text.slice(-maxChars);
    const nl = tail.indexOf("\n");
    return nl === -1 ? tail : tail.slice(nl + 1);
  };

  // Which CLI process on the bridge this card talks to. Derived from the card's own
  // instance id so a duplicated card gets its own CLI instead of sharing the original's
  // (Duplicate copies the config, session id and all). The fallback only matters if the
  // board ever renders a card without an id.
  const [fallbackSession] = useState(newSessionId);
  const bridgeSession = cardId ? cardId.replace(/[^\w-]/g, "-") : comp?.bridgeSession || fallbackSession;

  // Everything the CLI has printed, plus the lines we echoed for it (its stdin is a pipe,
  // so it echoes nothing itself). Append-only — this is the scrollback.
  const [log, setLog] = useState(() => comp?.terminal ?? "");
  // Whether the CLI behind the card is usable yet. Anything but "live" covers the terminal
  // with a message instead, so the box only ever holds the session itself. Stamped with the
  // bridge it describes, so pointing the card elsewhere is back to "starting" on its own.
  const [conn, setConn] = useState<{ url: string; state: "starting" | "live" | "unavailable" }>({
    url: bridgeUrl,
    state: "starting",
  });
  const phase = !bridgeUrl ? "unconfigured" : conn.url === bridgeUrl ? conn.state : "starting";
  // The line being typed, i.e. everything after the prompt.
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<ScState>(() => ({
    scSession: comp?.scSession ?? "",
    model: comp?.model ?? "",
    online: true,
  }));

  const generatingRef = useRef(false);
  const clientRef = useRef<ScClient | null>(null);
  // The prompt the CLI last left on screen, so clearing for a new session can put it back.
  const promptRef = useRef(trailingPrompt(comp?.terminal ?? ""));

  // The CLI puts a blank line before each prompt, which on an empty screen would be a blank
  // first line — after a clear, the prompt belongs at the top of the card.
  const append = (text: string) =>
    setLog((prev) => cap(prev + (prev ? text : text.replace(/^[\r\n]+/, ""))));

  // What we last wrote to (or read from) the card's config, so neither direction of the
  // sync loops: an incoming config that matches this is our own echo coming back.
  const lastSavedRef = useRef<string | null>(null);
  const snapshot = (c: { state: ScState; log: string }) =>
    JSON.stringify({
      bridgeSession,
      scSession: c.state.scSession,
      model: c.state.model,
      terminal: cap(c.log),
    });

  // The saved simple-ai session id, re-attached once per CLI process so a card that
  // outlived its CLI (dev restart, idle timeout) keeps the same conversation.
  const wantedScSessionRef = useRef(comp?.scSession ?? "");
  const attachedRef = useRef(false);
  // Whether the saved simple-ai account has been signed in on this CLI process yet.
  const loggedInRef = useRef(false);

  useEffect(() => {
    if (!bridgeUrl) return;
    attachedRef.current = false;
    loggedInRef.current = false;
    const mark = (state: "live" | "unavailable") => setConn({ url: bridgeUrl, state });

    const client = connectSc(bridgeUrl, bridgeSession, {
      // Straight into the scrollback, banner and prompt included, exactly as the CLI
      // printed it — the card is a view of the terminal, not a chat transcript. Notices
      // about the bridge itself stay out of it; they belong to the card, not the session.
      onChunk: (text) => {
        mark("live");
        append(text);
        const prompt = trailingPrompt(text);
        if (prompt) promptRef.current = prompt;
      },
      onReady: () => {
        generatingRef.current = false;
        mark("live");
      },
      // The CLI answered `:info`, which is proof it is up — and on a reconnect that answer is
      // the only proof coming, since the banner went to the page that has since been reloaded.
      onState: (next) => {
        mark("live");

        // Sign in as the account saved in the browser (Profile → SC Account), which is
        // what the reader's own conversations belong to — a CLI on the bridge otherwise
        // stays whoever it was last logged in as, which is nobody on a fresh one. Once
        // per CLI process, and before the attach below: `:login` re-initialises the
        // CLI's session memory, so the other order would empty the conversation it has
        // just re-attached. With no password saved the card is signed in as whatever the
        // bridge's CLI already is, exactly as it was before.
        if (!loggedInRef.current) {
          loggedInRef.current = true;
          const { username, password } = getScAccount();
          if (username && password) {
            // login() reads the state it ends up on, so this same handler runs again.
            void client.login(username, password);
            return;
          }
        }

        const wanted = wantedScSessionRef.current;
        if (wanted && next.scSession && next.scSession !== wanted && !attachedRef.current) {
          attachedRef.current = true;
          // attach() reports the state it ends up on, so this same handler runs again.
          void client.attach(wanted).then((res) => {
            // The saved conversation is gone from the server, so it is never coming back:
            // the card starts a new one by itself rather than keeping a dead id and a
            // scrollback the model on the other end has no memory of. Same as Reset.
            if (res?.missing) void newSession();
          });
          return;
        }
        attachedRef.current = true;
        wantedScSessionRef.current = next.scSession;
        setState(next);
        // A card restored from config with nothing on screen still deserves a prompt to
        // type at — the one the CLI printed went to the page that has since been reloaded.
        if (next.model) setLog((prev) => prev || `${next.model}> `);
      },
      onUnavailable: () => mark("unavailable"),
    });
    clientRef.current = client;

    return () => {
      clientRef.current = null;
      client.close();
    };
    // `append` is re-made every render but only ever calls setLog, so re-subscribing the
    // stream on its identity would restart the CLI's output for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeSession, bridgeUrl]);

  // Persist everything the card needs to come back as it is now.
  useEffect(() => {
    const serialized = snapshot({ state, log });
    if (lastSavedRef.current === null) {
      // First render: only write if we already differ from what is stored (a card that
      // has never run has no bridge session yet).
      const stored = JSON.stringify({
        bridgeSession: comp?.bridgeSession ?? "",
        scSession: comp?.scSession ?? "",
        model: comp?.model ?? "",
        terminal: cap(comp?.terminal ?? ""),
      });
      lastSavedRef.current = stored;
      if (stored === serialized) return;
    } else if (lastSavedRef.current === serialized) {
      return;
    }
    lastSavedRef.current = serialized;
    save?.({
      ...comp,
      bridgeSession,
      scSession: state.scSession,
      model: state.model,
      terminal: cap(log),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeSession, state, log]);

  // Adopt a config that was replaced under us — a board import, or an edit in the Edit
  // modal. The board's store is an external system here, not a prop we derive from, and
  // skipping this would let a stale scrollback overwrite the imported one on next save.
  useEffect(() => {
    const incoming = JSON.stringify({
      bridgeSession,
      scSession: comp?.scSession ?? "",
      model: comp?.model ?? "",
      terminal: cap(comp?.terminal ?? ""),
    });
    if (lastSavedRef.current === null || incoming === lastSavedRef.current) return;
    lastSavedRef.current = incoming;
    wantedScSessionRef.current = comp?.scSession ?? "";
    setLog(comp?.terminal ?? "");
    setState((prev) => ({ ...prev, scSession: comp?.scSession ?? "", model: comp?.model ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp]);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Whether new output should scroll into view — false while the reader has scrolled up.
  const stickRef = useRef(true);

  // New output puts the caret back where a terminal keeps it: at the end, after the prompt.
  // A reader who has selected text to copy is left alone. Keyed on the scrollback alone and
  // not on the draft, or every keystroke would drag the caret to the end — which is where it
  // already is when typing at the end, and never where it was meant to go when editing an
  // earlier line of a multi-line message.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    if (el.selectionStart === el.selectionEnd) el.setSelectionRange(el.value.length, el.value.length);
  }, [log]);

  const pinToBottom = () => {
    const el = areaRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  };

  // Before the paint, not after: a reload restores the scrollback mid-session, and the
  // newest lines are the ones it should come back on — not the oldest, and not the top of
  // the box for a frame first.
  useLayoutEffect(pinToBottom, [log, draft]);

  // The box changing size moves the bottom out from under the view: a resized card re-wraps
  // every line, and on a reload the card is laid out after this mounts. Both leave the
  // terminal stranded above the newest output unless it is put back. Reads refs only, so the
  // first render's closure is as good as any later one. (Safari 12 has no ResizeObserver —
  // the card is then pinned on mount alone, as it was before.)
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(pinToBottom);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleScroll() {
    const el = areaRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    // Only the tail after the prompt is editable; an edit reaching into the scrollback is
    // put back as it was (setting .value also parks the caret at the end).
    if (!next.startsWith(log)) {
      e.target.value = log + draft;
      return;
    }
    // Line breaks are kept, in the draft and all the way to the model: the bridge encodes a
    // multi-line message onto one stdin line so the CLI still reads it as a single
    // submission. What is on screen is what gets sent, pasted blocks included.
    setDraft(next.slice(log.length));
  }

  function submit() {
    const line = draft.trim();
    if (!line || generatingRef.current || phase !== "live") return;
    setDraft("");
    stickRef.current = true;

    // `:reset` is what the card's Reset button does, so it goes the same way: the new
    // conversation's id is then the one the card stores, instead of the one just abandoned.
    if (RESET.test(line)) {
      void newSession();
      return;
    }

    generatingRef.current = true;
    // A line that clears takes the screen with it, itself included — the way it goes in a
    // terminal. What the CLI prints next, its prompt, is then the whole card.
    if (CLEAR.test(line)) setLog("");
    else append(`${forScrollback(line)}\n`);

    void clientRef.current?.send(line).then((res) => {
      if (res?.error) {
        generatingRef.current = false;
        append(`[${res.error}]\n${promptRef.current}`);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter runs the line. A live IME composition keeps it, so committing a candidate with
    // Enter does not submit half a sentence. Shift+Enter is left to the box, whose own
    // default is to break the line — a message can span several, and one still sends as one.
    if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // What the card's Reset button does, and what typing `:reset` does: a new simple-ai session,
  // and a cleared screen with the prompt back on it. Closing over the first render is safe:
  // everything it touches is a ref or a setter, so there is nothing stale to capture.
  async function newSession() {
    if (generatingRef.current) return;
    // Held for the round trip, so a second Enter cannot start over what is already starting
    // over. The CLI prints nothing for `:reset`, so no `ready` is coming to release it.
    generatingRef.current = true;
    try {
      const res = await clientRef.current?.reset();
      // No new session means nothing was reset (no bridge, for one) — leave the screen alone
      // rather than clearing a scrollback that is still the truth.
      if (!res?.state) return;
      setDraft("");
      stickRef.current = true;
      wantedScSessionRef.current = res.state.scSession;
      attachedRef.current = true;
      setState(res.state);
      setLog(`${res.state.model}> `);
    } finally {
      generatingRef.current = false;
    }
  }

  // Registering is what gives the card its Reset button; unregistering on unmount takes it away.
  useEffect(() => {
    const setReset = config._setReset as ((fn: (() => void | Promise<void>) | null) => void) | undefined;
    setReset?.(newSession);
    return () => setReset?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.container}>
      <textarea
        ref={areaRef}
        className={styles.terminal}
        value={log + draft}
        spellCheck={false}
        autoComplete="off"
        aria-label="sc terminal"
        disabled={phase !== "live"}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
      />
      {phase !== "live" && (
        <div className={styles.notice}>
          <span>{STRINGS[phase][lang].replace("{{url}}", bridgeUrl)}</span>
        </div>
      )}
    </div>
  );
}
