// Client for the sc bridge — a small server that runs the `sc` (simple-ai-chat) CLI and
// exposes its stdin/stdout over HTTP, since a browser cannot spawn a CLI itself. The bridge
// is not part of this board: it runs elsewhere and this card only talks to it, at the URL in
// VITE_SC_BRIDGE_URL (see .env.example).
//
// The bridge's API is deliberately thin — an SSE stream of the CLI's output, and a POST that
// writes a line to its stdin:
//
//   GET  /api/sc/stream?session=<id>       `chunk` events, and `ready` at every prompt
//   POST /api/sc/send   { session, text }  write one line
//
// So everything else is said in the CLI's own language: reading the session id is `:info`,
// resuming a conversation is `:session attach <id>`, starting a new one is `:reset`. That
// output is not part of the session the card shows, so it is recognised and held back here
// rather than printed. `ready` marks where one block of output ends and the next begins,
// which is what makes telling them apart possible at all.

/**
 * Where the bridge lives, e.g. http://159.223.204.39:8787 — set VITE_SC_BRIDGE_URL in this
 * component's .env. Empty means the card has nowhere to talk to, and says so.
 */
export const BRIDGE_URL = (import.meta.env.VITE_SC_BRIDGE_URL ?? "").replace(/\/+$/, "");

/** What the CLI reports about itself — the session id is what makes a chat resumable. */
export type ScState = {
  scSession: string;
  model: string;
  online: boolean;
};

export type ScHandlers = {
  /** Output for the card: everything the CLI printed that belongs to the session. */
  onChunk: (text: string) => void;
  /** The CLI printed its prompt: it finished a reply and is idle again. */
  onReady: () => void;
  /** The CLI answered `:info` — so it is up, and this is what it says about itself. */
  onState: (state: ScState) => void;
  /** No bridge reachable (wrong URL, or the server is down). */
  onUnavailable: () => void;
};

export type ScClient = {
  send: (text: string) => Promise<{ error?: string }>;
  /** Put the CLI back on a saved conversation. */
  attach: (scSession: string) => Promise<{ attached?: boolean; state?: ScState }>;
  /** Start a fresh conversation (`:reset`), which gives the card a new session id. */
  reset: () => Promise<{ state?: ScState }>;
  close: () => void;
};

// The CLI prints this once, at the end of startup. Seeing it means the CLI has only now
// reached its prompt — and that anything written to its stdin before that was dropped on the
// floor, which is why the first `:info` has to be asked again here.
const BANNER = ":help for help.";

/** `:session attach <id>` worked. Its failures are left visible on purpose. */
const ATTACHED = /^Session \(id:\d+\) attached\./m;

// An answer that never comes must not hold the CLI's output back for good.
const ANSWER_TIMEOUT = 30000;
// After an answer arrives, keep holding for a moment: React mounts a component twice in dev,
// so the same question can be in flight twice and the second answer would otherwise be printed.
const DUPLICATE_GRACE = 1500;

export function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/** The `model> ` prompt at the end of the CLI's output, or "" if it isn't idle there. */
export function trailingPrompt(text: string): string {
  return text.match(/[A-Za-z0-9_.-]*>[ \t]$/)?.[0] ?? "";
}

/** A block that is nothing but a prompt — what a command with no output leaves behind. */
function isBare(text: string): boolean {
  return text.replace(/[A-Za-z0-9_.-]*>[ \t]$/, "").trim() === "";
}

/** Read `:info` output. Null if the text isn't `:info` output at all. */
function parseInfo(text: string): ScState | null {
  const field = (label: string) => text.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1]?.trim() ?? "";
  const scSession = field("Session");
  if (!/^\d+$/.test(scSession)) return null;
  return { scSession, model: field("Model"), online: field("Network status") === "online" };
}

export function connectSc(session: string, handlers: ScHandlers): ScClient {
  const source = new EventSource(`${BRIDGE_URL}/api/sc/stream?session=${encodeURIComponent(session)}`);

  // Set while we are waiting on an answer of our own. Output is collected per block instead
  // of streamed, so a block can be recognised as ours — and dropped — before it is shown.
  let waiting = false;
  let held = "";
  let timer = 0;
  let waiters: Array<(state: ScState | null) => void> = [];

  const flush = () => {
    if (!held) return;
    handlers.onChunk(held);
    held = "";
    handlers.onReady();
  };

  const stopWaiting = () => {
    clearTimeout(timer);
    waiting = false;
    flush();
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(null);
  };

  const post = async (path: string, body: Record<string, unknown> = {}) => {
    try {
      const res = await fetch(`${BRIDGE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, ...body }),
      });
      return res.ok ? {} : { error: `bridge answered ${res.status}` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  const send = (text: string) => post("/api/sc/send", { text });

  /** Ask who the CLI is, and wait for the answer. Doubles as the readiness check. */
  const readState = async (): Promise<ScState | null> => {
    waiting = true;
    clearTimeout(timer);
    timer = window.setTimeout(stopWaiting, ANSWER_TIMEOUT);
    const answer = new Promise<ScState | null>((resolve) => waiters.push(resolve));
    const res = await send(":info");
    if (res.error) {
      stopWaiting();
      return null;
    }
    return answer;
  };

  source.addEventListener("chunk", (e) => {
    const text = JSON.parse((e as MessageEvent).data) as string;
    if (waiting) held += text;
    else handlers.onChunk(text);
  });

  source.addEventListener("ready", () => {
    if (!waiting) return handlers.onReady();

    const text = held;
    held = "";

    const info = parseInfo(text);
    if (info) {
      handlers.onState(info);
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve(info);
      // Keep holding briefly in case the same question was asked twice.
      clearTimeout(timer);
      timer = window.setTimeout(stopWaiting, DUPLICATE_GRACE);
      return;
    }

    // The rest of our own commands' output: a successful attach, or the bare prompt a
    // command with no output leaves. Dropped — the card shows the session, not the plumbing.
    if (ATTACHED.test(text) || isBare(text)) return;

    // Somebody else's output — the startup banner, or a reply to whatever was typed. It goes
    // on screen, and we keep waiting for our own answer.
    handlers.onChunk(text);
    handlers.onReady();
    // The banner means the CLI has only just started reading stdin, so the `:info` sent
    // before it was lost. Ask again, now that there is something to read it.
    if (text.includes(BANNER)) void readState();
  });

  source.addEventListener("error", () => {
    // EventSource retries a dropped connection itself (readyState CONNECTING) and gives up
    // for good on a reply that is not an event stream (CLOSED) — a wrong URL, say. Neither
    // has a CLI behind it, and both have to be said out loud or the card waits forever.
    if (source.readyState !== EventSource.OPEN) handlers.onUnavailable();
  });

  // Ask straight away: that answers for a CLI that is already running, which is the case a
  // reconnecting card cannot learn any other way. A CLI still starting up drops the question,
  // and the banner above is the cue to ask it again.
  void readState();

  return {
    send,
    attach: async (scSession) => {
      // Awaited in turn: the bridge writes each line as it arrives, so this is what keeps
      // the attach ahead of the `:info` that reads the result.
      await send(`:session attach ${scSession}`);
      const state = await readState();
      return { attached: state?.scSession === scSession, state: state ?? undefined };
    },
    reset: async () => {
      await send(":reset");
      const state = await readState();
      return { state: state ?? undefined };
    },
    close: () => {
      clearTimeout(timer);
      source.close();
    },
  };
}
