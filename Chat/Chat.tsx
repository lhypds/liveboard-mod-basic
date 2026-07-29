import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BRIDGE_URL, connectSc, newSessionId, trailingPrompt, type ScClient, type ScState } from "./sc";
import styles from "./chat.module.css";

type Lang = "en" | "ja" | "zh";

type ChatComp = {
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
    en: `No answer from the sc bridge at ${BRIDGE_URL}`,
    ja: `sc ブリッジ (${BRIDGE_URL}) が応答しません`,
    zh: `sc 桥接服务 (${BRIDGE_URL}) 无响应`,
  },
  unconfigured: {
    en: "VITE_SC_BRIDGE_URL is not set in this component's .env",
    ja: "このコンポーネントの .env に VITE_SC_BRIDGE_URL が設定されていません",
    zh: "本组件的 .env 中未设置 VITE_SC_BRIDGE_URL",
  },
};

function useLang(): Lang {
  const { i18n } = useTranslation();
  return (i18n.language as Lang) in STRINGS.starting ? (i18n.language as Lang) : "en";
}

// `:login <user> <password>` is forwarded to the CLI as typed, but the terminal is saved
// in the board's config, so the password never goes in it.
function forScrollback(line: string): string {
  const login = line.match(/^(:login\s+\S+\s+)(\S+)(.*)$/i);
  return login ? `${login[1]}${"*".repeat(login[2].length)}${login[3]}` : line;
}

export default function Chat({ config }: { config: Record<string, unknown> }) {
  const lang = useLang();
  const comp = config.comp as ChatComp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const cardId = typeof config._id === "string" ? config._id : "";

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
  // with a message instead, so the box only ever holds the session itself.
  const [phase, setPhase] = useState<"starting" | "live" | "unavailable" | "unconfigured">(
    BRIDGE_URL ? "starting" : "unconfigured",
  );
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

  const append = (text: string) => setLog((prev) => cap(prev + text));

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

  useEffect(() => {
    if (!BRIDGE_URL) return;
    attachedRef.current = false;

    const client = connectSc(bridgeSession, {
      // Straight into the scrollback, banner and prompt included, exactly as the CLI
      // printed it — the card is a view of the terminal, not a chat transcript. Notices
      // about the bridge itself stay out of it; they belong to the card, not the session.
      onChunk: (text) => {
        setPhase("live");
        append(text);
        const prompt = trailingPrompt(text);
        if (prompt) promptRef.current = prompt;
      },
      onReady: () => {
        generatingRef.current = false;
        setPhase("live");
      },
      // The CLI answered `:info`, which is proof it is up — and on a reconnect that answer is
      // the only proof coming, since the banner went to the page that has since been reloaded.
      onState: (next) => {
        setPhase("live");

        const wanted = wantedScSessionRef.current;
        if (wanted && next.scSession && next.scSession !== wanted && !attachedRef.current) {
          attachedRef.current = true;
          // attach() reports the state it ends up on, so this same handler runs again.
          void client.attach(wanted);
          return;
        }
        attachedRef.current = true;
        wantedScSessionRef.current = next.scSession;
        setState(next);
        // A card restored from config with nothing on screen still deserves a prompt to
        // type at — the one the CLI printed went to the page that has since been reloaded.
        if (next.model) setLog((prev) => prev || `${next.model}> `);
      },
      onUnavailable: () => setPhase("unavailable"),
    });
    clientRef.current = client;

    return () => {
      clientRef.current = null;
      client.close();
    };
    // `append` is re-made every render but only ever calls setLog, so re-subscribing the
    // stream on its identity would restart the CLI's output for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeSession]);

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

  // Keep the caret where a terminal keeps it: at the end, after the prompt. A reader who
  // has selected text to copy is left alone.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    if (el.selectionStart === el.selectionEnd) el.setSelectionRange(el.value.length, el.value.length);
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [log, draft]);

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
    // A pasted block would otherwise become several stdin lines.
    setDraft(next.slice(log.length).replace(/[\r\n]+/g, " "));
  }

  function submit() {
    const line = draft.trim();
    if (!line || generatingRef.current || phase !== "live") return;
    setDraft("");
    append(`${forScrollback(line)}\n`);
    generatingRef.current = true;
    stickRef.current = true;
    void clientRef.current?.send(line).then((res) => {
      if (res?.error) {
        generatingRef.current = false;
        append(`[${res.error}]\n${promptRef.current}`);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter runs the line. A live IME composition keeps it, so committing a candidate with
    // Enter does not submit half a sentence.
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  // What the card's Reset button does: a new simple-ai session, and a cleared screen with the
  // prompt back on it — the same as `:reset` in the CLI. Closing over the first render is safe:
  // everything it touches is a ref or a setter, so there is nothing stale to capture.
  async function newSession() {
    if (generatingRef.current) return;
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
          <span>{STRINGS[phase][lang]}</span>
        </div>
      )}
    </div>
  );
}
