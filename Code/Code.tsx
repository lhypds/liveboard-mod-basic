import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFollowBottom } from "@hooks/useFollowBottom";
import JavaScriptWorker from "./javascript.worker?worker";
import PythonWorker from "./python.worker?worker";
import { highlight, type Language } from "./highlight";
import { formatSource, INDENT_WIDTH } from "./format";
import styles from "./code.module.css";

type Locale = "en" | "ja" | "zh";
type Mode = "general" | "interpreter" | "preview" | "view";
type OutputKind = "log" | "warn" | "error" | "result" | "status" | "input";

type Sources = Record<Language, string>;
type CodeComp = {
  language?: Language;
  mode?: Mode;
  sources?: Partial<Sources>;
};
type OutputLine = { id: number; kind: OutputKind; text: string };
/* What the board's Generate button is pointed at; see the registration below. */
type GenerateTarget = { content: () => string; prompt: string; onGenerated: (next: string) => void };
type DropdownOption = { value: string; label: string };
type WorkerMessage = {
  id: number;
  type: "ready" | "progress" | "banner" | "stdout" | "stderr" | "log" | "warn" | "error" | "result" | "done";
  text?: string;
};

const DEFAULT_SOURCES: Sources = {
  html: `<!doctype html>
<html>
  <body>
    <h1>Hello, Liveboard!</h1>
  </body>
</html>`,
  javascript: `console.log("Hello, Liveboard!");`,
  json: `{
  "name": "Liveboard",
  "tags": ["code", "json"]
}`,
  python: `print("Hello, Liveboard!")`,
};

const STRINGS = {
  mode: { en: "Mode", ja: "モード", zh: "模式" },
  language: { en: "Language", ja: "言語", zh: "语言" },
  general: { en: "Console", ja: "コンソール", zh: "控制台" },
  interpreter: { en: "Interpreter", ja: "インタープリター", zh: "解释器" },
  preview: { en: "Preview", ja: "プレビュー", zh: "预览" },
  view: { en: "View", ja: "ビュー", zh: "查看" },
  run: { en: "Run", ja: "実行", zh: "执行" },
  edit: { en: "Edit", ja: "編集", zh: "编辑" },
  reset: { en: "Reset", ja: "リセット", zh: "重置" },
  format: { en: "Format code", ja: "コードを整形", zh: "格式化代码" },
  editor: { en: "Editor", ja: "エディター", zh: "编辑器" },
  console: { en: "Console", ja: "コンソール", zh: "控制台" },
  clearConsole: { en: "Clear console", ja: "コンソールをクリア", zh: "清空控制台" },
  search: { en: "Find and replace", ja: "検索と置換", zh: "查找替换" },
  find: { en: "Find", ja: "検索", zh: "查找" },
  replace: { en: "Replace", ja: "置換", zh: "替换" },
  replaceNext: { en: "Replace next", ja: "次を置換", zh: "替换下一个" },
  replaceAll: { en: "Replace all", ja: "すべて置換", zh: "替换全部" },
  empty: { en: "Run code to see the output.", ja: "コードを実行すると結果が表示されます。", zh: "执行代码后将在这里显示结果。" },
  completed: { en: "Completed.", ja: "完了しました。", zh: "执行完成。" },
  timedOut: { en: "Execution timed out.", ja: "実行がタイムアウトしました。", zh: "执行超时。" },
  htmlRendered: { en: "HTML rendered.", ja: "HTML を描画しました。", zh: "HTML 已渲染。" },
  previewTitle: { en: "HTML preview", ja: "HTML プレビュー", zh: "HTML 预览" },
} satisfies Record<string, Record<Locale, string>>;

/* The standing description sent with every Generate, so the model knows what it is
   being handed before it reads the instruction. Model-facing, so it stays in English
   whatever language the card is showing, and it describes the runtime rather than
   just the syntax — code that reaches for the network or the DOM won't run here. */
const GENERATE_PROMPT: Record<Language, string> = {
  html: "A self-contained HTML document rendered in a sandboxed iframe. Inline any CSS and JavaScript it needs and don't request anything over the network; console.log reaches the card's console.",
  javascript: "A JavaScript program run in a Web Worker: no DOM, no network. console.log is the only way it shows anything.",
  json: "A JSON document, shown as data rather than run. It has to parse.",
  python: "A Python program run under Pyodide in a Web Worker: the standard library and what Pyodide bundles, no network. print is the only way it shows anything.",
};

/* Matches .editor's padding in code.module.css; scrolling a match into view has to
   know how much of the textarea's height the text doesn't get. */
const EDITOR_PADDING = 7;

const GENERATE_RULE =
  "Answer with the source alone — no markdown fences, no commentary — keeping its existing style and indentation unless the instruction says otherwise.";

function getLocale(language: string): Locale {
  return language === "ja" || language === "zh" ? language : "en";
}

function isLanguage(value: unknown): value is Language {
  return value === "html" || value === "javascript" || value === "json" || value === "python";
}

function isMode(value: unknown): value is Mode {
  return value === "general" || value === "interpreter" || value === "preview" || value === "view";
}

function defaultMode(language: Language): Mode {
  if (language === "html") return "preview";
  if (language === "json") return "view";
  return "general";
}

function modeIsAvailable(mode: Mode, language: Language): boolean {
  if (language === "html") return mode === "preview";
  if (language === "json") return mode === "view";
  if (language === "javascript") return mode === "general";
  return mode === "general" || mode === "interpreter";
}

function normalizeComp(comp: CodeComp | undefined): { language: Language; mode: Mode; sources: Sources } {
  const language = isLanguage(comp?.language) ? comp.language : "html";
  const candidateMode = isMode(comp?.mode) ? comp.mode : "general";
  const mode = modeIsAvailable(candidateMode, language) ? candidateMode : defaultMode(language);
  return {
    language,
    mode,
    sources: {
      html: typeof comp?.sources?.html === "string" ? comp.sources.html : DEFAULT_SOURCES.html,
      javascript: typeof comp?.sources?.javascript === "string" ? comp.sources.javascript : DEFAULT_SOURCES.javascript,
      json: typeof comp?.sources?.json === "string" ? comp.sources.json : DEFAULT_SOURCES.json,
      python: typeof comp?.sources?.python === "string" ? comp.sources.python : DEFAULT_SOURCES.python,
    },
  };
}

/* How much leading whitespace one Shift+Tab peels off a line: a full indent
   level, a single tab from pasted code, or a lone stray space. */
function outdentWidth(line: string, indent: string): number {
  if (line.startsWith("\t")) return 1;
  if (line.startsWith(indent)) return indent.length;
  return line.startsWith(" ") ? 1 : 0;
}

/* Case-insensitive, and wrapping: a search that runs off the end starts again at
   the top rather than reporting nothing. -1 only ever means "not in the file". */
function findIn(text: string, query: string, from: number): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const at = haystack.indexOf(needle, from);
  return at === -1 ? haystack.indexOf(needle) : at;
}

function replaceAllIn(text: string, query: string, replacement: string): string {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let result = "";
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    result += text.slice(from, at) + replacement;
    // Resume past the replacement, so a replacement containing the query doesn't feed itself
    from = at + needle.length;
  }
  return from === 0 ? text : result + text.slice(from);
}

function formatInterpreterInput(code: string): string {
  return code
    .split("\n")
    .map((line, index) => `${index === 0 ? ">>>" : "..."} ${line}`)
    .join("\n");
}

function buildHtmlDocument(source: string, channel: string): string {
  const bridge = `<script>
(() => {
  const channel = ${JSON.stringify(channel)};
  const createMemoryStorage = () => {
    const values = new Map();
    return {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key) {
        key = String(key);
        return values.has(key) ? values.get(key) : null;
      },
      key(index) { return Array.from(values.keys())[Number(index)] ?? null; },
      removeItem(key) { values.delete(String(key)); },
      setItem(key, value) { values.set(String(key), String(value)); }
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      window[name].length;
    } catch (_error) {
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          value: createMemoryStorage()
        });
      } catch (_storageError) {
        // The runtime error bridge below will report access failures.
      }
    }
  }
  const seen = new WeakSet();
  const format = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "undefined") return "undefined";
    if (typeof value === "bigint") return String(value) + "n";
    if (value instanceof Error) return value.stack || value.message;
    try {
      const serialized = JSON.stringify(value, (_key, item) => {
        if (typeof item === "bigint") return String(item) + "n";
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      }, 2);
      return serialized === undefined ? String(value) : serialized;
    } catch (_error) {
      return String(value);
    }
  };
  const send = (type, values) => parent.postMessage({
    source: "liveboard-code",
    channel,
    type,
    text: values.map(format).join(" ")
  }, "*");
  for (const type of ["log", "info", "warn", "error"]) {
    const original = console[type].bind(console);
    console[type] = (...values) => {
      original(...values);
      send(type === "info" ? "log" : type, values);
    };
  }
  addEventListener("error", (event) => send("error", [event.error || event.message]));
  addEventListener("unhandledrejection", (event) => send("error", [event.reason]));
})();
</script>`;

  if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${bridge}`);
  if (/<html(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<html(?:\s[^>]*)?>/i, (html) => `${html}<head>${bridge}</head>`);
  }
  return `<!doctype html><html><head>${bridge}</head><body>${source}</body></html>`;
}

function CodeDropdown({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: DropdownOption[];
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function handleOutside(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, []);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={styles.dropdownWrapper} data-open={open}>
      <button
        type="button"
        className={styles.dropdownTrigger}
        disabled={disabled}
        aria-label={`${ariaLabel}: ${selected.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected.label}
      </button>
      <div className={styles.dropdown} role="listbox" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={`${styles.dropdownOption} ${option.value === value ? styles.dropdownActive : ""}`}
            onClick={() => pick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Code({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const locale = getLocale(i18n.language);
  const comp = config.comp as CodeComp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const { language, mode, sources } = normalizeComp(comp);
  const indent = " ".repeat(INDENT_WIDTH[language]);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [htmlDocument, setHtmlDocument] = useState("");
  const [interpreterDraft, setInterpreterDraft] = useState("");
  const [pythonReady, setPythonReady] = useState(false);
  const [pythonWorkerGeneration, setPythonWorkerGeneration] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  // Bumped on every Ctrl+F so the shortcut re-selects the field it already opened
  const [findFocusNonce, setFindFocusNonce] = useState(0);

  const outputIdRef = useRef(0);
  const runIdRef = useRef(0);
  const runTimerRef = useRef<number | null>(null);
  const runHadOutputRef = useRef(false);
  const javascriptWorkerRef = useRef<Worker | null>(null);
  const pythonWorkerRef = useRef<Worker | null>(null);
  const pythonReadyRef = useRef(false);
  const pythonRunInProgressRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlChannelRef = useRef("");
  const htmlRunPendingRef = useRef(false);
  const consoleBodyRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const interpreterInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const { mark, follow } = useFollowBottom(editorRef);

  /* The gutter and the highlighted copy underneath the editor don't scroll
     themselves; they're moved to wherever the editor is, whether the reader
     scrolled it or the code below did. */
  const syncEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = editor.scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = editor.scrollTop;
      highlightRef.current.scrollLeft = editor.scrollLeft;
    }
  }, []);

  const clearRunTimer = useCallback(() => {
    if (runTimerRef.current !== null) {
      window.clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
  }, []);

  const appendOutput = useCallback((kind: OutputKind, text: string) => {
    if (!text) return null;
    if (kind !== "status" && kind !== "input") runHadOutputRef.current = true;
    const line: OutputLine = {
      id: ++outputIdRef.current,
      kind,
      text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n…` : text,
    };
    setOutput((previous) => {
      const next = [...previous, line].slice(-300);
      let total = 0;
      let start = next.length;
      while (start > 0 && total < 50_000) {
        start -= 1;
        total += next[start].text.length;
      }
      return next.slice(start);
    });
    return line.id;
  }, [setOutput]);

  const stopWorkers = useCallback(() => {
    javascriptWorkerRef.current?.terminate();
    javascriptWorkerRef.current = null;
    pythonWorkerRef.current?.terminate();
    pythonWorkerRef.current = null;
    pythonReadyRef.current = false;
    setPythonReady(false);
    pythonRunInProgressRef.current = false;
    htmlRunPendingRef.current = false;
    clearRunTimer();
    setRunning(false);
  }, [clearRunTimer]);

  useEffect(() => () => stopWorkers(), [stopWorkers]);

  useEffect(() => {
    if (language !== "python" || pythonWorkerRef.current) return;

    const worker = new PythonWorker();
    const id = ++runIdRef.current;
    pythonWorkerRef.current = worker;

    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };
    const discardWorker = () => {
      cleanup();
      if (pythonRunInProgressRef.current) return;
      if (pythonWorkerRef.current === worker) {
        worker.terminate();
        pythonWorkerRef.current = null;
        pythonReadyRef.current = false;
        setPythonReady(false);
      }
    };
    const handleMessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.id !== id) return;
      if (data.type === "progress") appendOutput("status", data.text ?? "");
      if (data.type === "banner") appendOutput("log", data.text ?? "");
      if (data.type === "ready") {
        pythonReadyRef.current = true;
        setPythonReady(true);
      }
      if (data.type === "error") {
        if (!pythonRunInProgressRef.current) appendOutput("error", data.text ?? "");
        discardWorker();
      }
      if (data.type === "done") cleanup();
    };
    const handleError = () => discardWorker();
    const timeout = window.setTimeout(discardWorker, 20_000);

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({ id, code: "", interpreter: mode === "interpreter", warmup: true });

    return cleanup;
  }, [appendOutput, language, mode, pythonWorkerGeneration]);

  useEffect(() => {
    const body = consoleBodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (!findOpen) return;
    // After the commit, so a query seeded from the editor's selection is the text
    // that gets selected here — typing straight over it replaces the whole thing
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen, findFocusNonce]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; channel?: string; type?: OutputKind; text?: string } | null;
      if (
        !data ||
        data.source !== "liveboard-code" ||
        data.channel !== htmlChannelRef.current ||
        event.source !== iframeRef.current?.contentWindow ||
        !data.type ||
        typeof data.text !== "string"
      ) return;
      appendOutput(data.type, data.text);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [appendOutput]);

  /* A rewrite lands in the source of whichever language the card is showing, not in
     one fixed field, so the board can't reach it the way it reaches a note's text:
     the card says what to read and where to put it, and registering that is also
     what puts the Generate button in its header. The target below outlives the
     render that made it — a whole run streams through it — so it reads what it
     needs from this ref rather than from that render's closure. */
  const liveRef = useRef({ source: sources[language], update: updateSource });
  useEffect(() => {
    liveRef.current = { source: sources[language], update: updateSource };
  });

  useEffect(() => {
    const setGenerate = config._setGenerate as ((target: GenerateTarget | null) => void) | undefined;
    // The interpreter shows no editor, so a rewrite would land somewhere off screen
    if (mode === "interpreter") return;
    setGenerate?.({
      content: () => liveRef.current.source,
      prompt: `${GENERATE_PROMPT[language]} ${GENERATE_RULE}`,
      onGenerated: (next) => {
        // The editor still shows the source this chunk is about to replace, so
        // read the reader's place in it before handing the new one over
        mark();
        liveRef.current.update(next);
      },
    });
    return () => setGenerate?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, mode]);

  // A rewrite arrives a chunk at a time; keep the newest line in view for a reader
  // who was already at the end of the file. The source is named here so the effect
  // can be checked against it.
  const editorSource = sources[language];
  useLayoutEffect(() => {
    if (follow()) syncEditorScroll();
  }, [editorSource, follow, syncEditorScroll]);

  function persist(nextLanguage: Language, nextMode: Mode, nextSources: Sources) {
    save?.({ ...comp, language: nextLanguage, mode: nextMode, sources: nextSources });
  }

  function armTimeout(milliseconds: number, onTimeout: () => void) {
    clearRunTimer();
    runTimerRef.current = window.setTimeout(onTimeout, milliseconds);
  }

  function handleWorkerFailure(worker: Worker, text: string, resetPython: boolean) {
    worker.terminate();
    if (resetPython) {
      pythonWorkerRef.current = null;
      pythonReadyRef.current = false;
      setPythonReady(false);
    } else {
      javascriptWorkerRef.current = null;
    }
    clearRunTimer();
    setRunning(false);
    appendOutput("error", text);
  }

  function runJavaScript(source: string) {
    javascriptWorkerRef.current?.terminate();
    const worker = new JavaScriptWorker();
    const id = ++runIdRef.current;
    javascriptWorkerRef.current = worker;
    runHadOutputRef.current = false;
    setOutput([]);
    setRunning(true);

    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.id !== id) return;
      if (data.type === "done") {
        clearRunTimer();
        worker.terminate();
        javascriptWorkerRef.current = null;
        setRunning(false);
        if (!runHadOutputRef.current) appendOutput("status", STRINGS.completed[locale]);
        return;
      }
      const kind: OutputKind = data.type === "warn" ? "warn" : data.type === "error" ? "error" : data.type === "result" ? "result" : "log";
      appendOutput(kind, data.text ?? "");
    };
    worker.onerror = (event) => handleWorkerFailure(worker, event.message, false);
    armTimeout(5_000, () => handleWorkerFailure(worker, STRINGS.timedOut[locale], false));
    worker.postMessage({ id, code: source });
  }

  function runPython(source: string, interpreter: boolean) {
    if (!source.trim()) return;
    if (!interpreter) setOutput([]);
    else appendOutput("input", formatInterpreterInput(source));
    runHadOutputRef.current = false;
    pythonRunInProgressRef.current = true;
    setRunning(true);

    const worker = pythonWorkerRef.current ?? new PythonWorker();
    pythonWorkerRef.current = worker;
    const id = ++runIdRef.current;

    const removeListeners = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };
    const fail = (text: string) => {
      removeListeners();
      pythonRunInProgressRef.current = false;
      handleWorkerFailure(worker, text, true);
    };
    const handleMessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.id !== id) return;
      if (data.type === "ready") {
        armTimeout(5_000, () => fail(STRINGS.timedOut[locale]));
        pythonReadyRef.current = true;
        setPythonReady(true);
        return;
      }
      if (data.type === "done") {
        removeListeners();
        pythonRunInProgressRef.current = false;
        clearRunTimer();
        setRunning(false);
        if (!interpreter && !runHadOutputRef.current) appendOutput("status", STRINGS.completed[locale]);
        return;
      }
      const kind: OutputKind = data.type === "stderr" || data.type === "error" ? "error" : data.type === "result" ? "result" : data.type === "progress" ? "status" : "log";
      appendOutput(kind, data.text ?? "");
    };
    const handleError = (event: ErrorEvent) => fail(event.message);
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    armTimeout(pythonReadyRef.current ? 5_000 : 30_000, () => fail(STRINGS.timedOut[locale]));
    worker.postMessage({ id, code: source, interpreter });
  }

  function runHtml(source: string) {
    const channel = `html-${++runIdRef.current}`;
    htmlChannelRef.current = channel;
    htmlRunPendingRef.current = true;
    runHadOutputRef.current = false;
    setOutput([]);
    setHtmlDocument(buildHtmlDocument(source, channel));
    setPreviewVisible(mode === "preview");
    setRunning(true);
  }

  function handleHtmlLoad() {
    if (!htmlRunPendingRef.current) return;
    htmlRunPendingRef.current = false;
    setRunning(false);
    if (mode === "general" && !runHadOutputRef.current) appendOutput("status", STRINGS.htmlRendered[locale]);
  }

  function handleRun() {
    if (mode === "preview" && previewVisible) {
      setPreviewVisible(false);
      return;
    }
    if (language === "html") runHtml(sources.html);
    else if (language === "javascript") runJavaScript(sources.javascript);
    else runPython(mode === "interpreter" ? interpreterDraft : sources.python, mode === "interpreter");
    if (mode === "interpreter") setInterpreterDraft("");
  }

  function handleFormat() {
    const next = formatSource(sources[language], language);
    if (next !== sources[language]) updateSource(next);
  }

  function handleLanguageChange(next: Language) {
    stopWorkers();
    const nextMode = defaultMode(next);
    setPreviewVisible(false);
    setOutput([]);
    setInterpreterDraft("");
    persist(next, nextMode, sources);
  }

  function handleModeChange(next: Mode) {
    if (!modeIsAvailable(next, language)) return;
    stopWorkers();
    setPreviewVisible(false);
    setOutput([]);
    setInterpreterDraft("");
    persist(language, next, sources);
  }

  function updateSource(value: string) {
    const next = { ...sources, [language]: value };
    setPreviewVisible(false);
    persist(language, mode, next);
  }

  function openFind() {
    const editor = editorRef.current;
    const selected = editor ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : "";
    // What the reader had highlighted is almost always what they're looking for
    if (selected && !selected.includes("\n")) setFindText(selected);
    setFindOpen(true);
    setFindFocusNonce((current) => current + 1);
  }

  function closeFind() {
    setFindOpen(false);
    editorRef.current?.focus();
  }

  /* Put a match on screen and select it. The editor takes focus so the selection
     is actually painted, and the scroll is done by hand because a browser only
     keeps the caret in view for edits the reader typed themselves. */
  function selectMatch(start: number, end: number) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(start, end);
    const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight) || 18;
    const top = (editor.value.slice(0, start).split("\n").length - 1) * lineHeight;
    const visible = editor.clientHeight - EDITOR_PADDING * 2;
    if (top < editor.scrollTop) editor.scrollTop = top;
    else if (top + lineHeight > editor.scrollTop + visible) editor.scrollTop = top + lineHeight - visible;
    syncEditorScroll();
  }

  /* A replacement goes in through the browser's own editing command rather than
     straight into state, so it lands on the textarea's undo stack and Ctrl+Z takes
     it back the way it takes back typing. The command needs the editor focused and
     the range selected; the input event it fires is what reaches updateSource. */
  function applyEdit(start: number, end: number, text: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(start, end);
    const applied = text ? document.execCommand("insertText", false, text) : document.execCommand("delete");
    // Nothing on the undo stack if the engine refused the command, but the edit still happens
    if (!applied) updateSource(`${editor.value.slice(0, start)}${text}${editor.value.slice(end)}`);
  }

  function handleFindNext() {
    const editor = editorRef.current;
    if (!editor || !findText) return;
    // Start one character past the match the reader is standing on, so repeated
    // finds walk forward instead of landing on it again
    const from = editor.selectionEnd > editor.selectionStart ? editor.selectionStart + 1 : editor.selectionEnd;
    const at = findIn(sources[language], findText, from);
    if (at === -1) return;
    selectMatch(at, at + findText.length);
  }

  function handleReplaceNext() {
    const editor = editorRef.current;
    if (!editor || !findText) return;
    const text = sources[language];
    const { selectionStart, selectionEnd } = editor;
    /* Only what is already selected as a match gets overwritten; from anywhere
       else this button just walks to the next match, so nothing is rewritten
       before the reader has seen it. */
    if (text.slice(selectionStart, selectionEnd).toLowerCase() !== findText.toLowerCase() || selectionEnd === selectionStart) {
      handleFindNext();
      return;
    }
    const next = `${text.slice(0, selectionStart)}${replaceText}${text.slice(selectionEnd)}`;
    const resumeAt = selectionStart + replaceText.length;
    applyEdit(selectionStart, selectionEnd, replaceText);
    // Walk on to the next match, from the source the replacement just made
    const at = findIn(next, findText, resumeAt);
    if (at !== -1) selectMatch(at, at + findText.length);
  }

  function handleReplaceAll() {
    if (!findText) return;
    const text = sources[language];
    const next = replaceAllIn(text, findText, replaceText);
    // One edit rather than one per match, so a single Ctrl+Z puts the file back
    if (next !== text) applyEdit(0, text.length, next);
  }

  function handleFindFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>, onEnter: () => void) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    onEnter();
  }

  /* Ctrl/Cmd+F is caught here rather than on the window because focus is already
     inside this card by the time it fires — on the window every Code card on the
     board would open its own box. */
  function handleContainerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key !== "f" && event.key !== "F" && event.code !== "KeyF") return;
    if (!showEditor) return;
    event.preventDefault();
    openFind();
  }

  /* Cut with an empty selection takes the whole line. Widening the selection
     and letting the browser run its own cut keeps the clipboard and the native
     undo stack intact — the resulting input event flows through onChange. */
  function selectLineForCut(input: HTMLTextAreaElement) {
    const text = input.value;
    const caret = input.selectionStart;
    const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
    const newlineAfter = text.indexOf("\n", caret);
    // Swallow the trailing newline, or on the last line the leading one, so
    // cutting never leaves a blank line where the line used to be.
    if (newlineAfter === -1) input.setSelectionRange(Math.max(0, lineStart - 1), text.length);
    else input.setSelectionRange(lineStart, newlineAfter + 1);
  }

  /* Swap the caret's line — or every line the selection touches — with its
     neighbour above or below, carrying the selection along with it. */
  function moveLines(input: HTMLTextAreaElement, direction: -1 | 1) {
    const text = input.value;
    const { selectionStart, selectionEnd } = input;
    const rangeEnd = selectionEnd > selectionStart && text[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
    const blockStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const newlineAfter = text.indexOf("\n", rangeEnd);
    const blockEnd = newlineAfter === -1 ? text.length : newlineAfter;
    const block = text.slice(blockStart, blockEnd);

    let next: string;
    let delta: number;
    if (direction < 0) {
      if (blockStart === 0) return;
      const aboveStart = blockStart >= 2 ? text.lastIndexOf("\n", blockStart - 2) + 1 : 0;
      const above = text.slice(aboveStart, blockStart - 1);
      next = `${text.slice(0, aboveStart)}${block}\n${above}${text.slice(blockEnd)}`;
      delta = aboveStart - blockStart;
    } else {
      if (blockEnd === text.length) return;
      const belowStart = blockEnd + 1;
      const belowNewline = text.indexOf("\n", belowStart);
      const belowEnd = belowNewline === -1 ? text.length : belowNewline;
      const below = text.slice(belowStart, belowEnd);
      next = `${text.slice(0, blockStart)}${below}\n${block}${text.slice(belowEnd)}`;
      delta = below.length + 1;
    }

    updateSource(next);
    window.requestAnimationFrame(() => input.setSelectionRange(selectionStart + delta, selectionEnd + delta));
  }

  /* Pasted code arrives indented for wherever it was copied from, so it is laid
     out again for where it lands. The whole document is formatted — a block needs
     the nesting around it to know its own level — but only the lines the paste
     itself brought in are taken from that pass, so nothing the reader wrote
     elsewhere moves. */
  function formatPastedBlock(input: HTMLTextAreaElement, pasted: string) {
    if (editorRef.current !== input) return;
    const text = input.value;
    const end = input.selectionStart;
    const start = end - pasted.length;
    // Only lay out what can be seen to be the block the browser just inserted
    if (start < 0 || text.slice(start, end) !== pasted) return;

    const before = text.slice(0, start);
    const after = text.slice(end);
    const formatted = formatSource(text, language);
    const textLines = text.split("\n");
    const formattedLines = formatted.split("\n");

    /* A reprint rather than a re-indent — JSON, once the whole document parses —
       has no line-for-line mapping to splice, so it replaces the document. */
    if (formattedLines.length !== textLines.length) {
      if (formatted !== text) applyEdit(0, text.length, formatted);
      return;
    }

    const firstLine = before.split("\n").length - 1;
    const lastLine = firstLine + pasted.split("\n").length - 1;
    /* The line the caret started on and the line the paste runs into are shared
       with code that was already there, so they keep the bytes they were written
       with and only the lines that are purely pasted get re-indented. */
    const runsOn = after !== "" && !after.startsWith("\n");
    const from = !before || before.endsWith("\n") ? firstLine : firstLine + 1;
    const to = pasted.endsWith("\n") || runsOn ? lastLine - 1 : lastLine;
    if (from > to) return;

    const lines = [...textLines];
    for (let index = from; index <= to; index += 1) lines[index] = formattedLines[index];
    const next = lines.join("\n");
    if (next === text) return;

    // Neither end is touched by the splice, so what sits between them is the
    // block the paste turned into.
    applyEdit(start, end, next.slice(start, next.length - after.length));
  }

  /* The paste itself is left to the browser and the formatting follows as an edit
     of its own, so the first Ctrl+Z gives back the code exactly as it was pasted
     and the next one takes the paste away. The layout can only be worked out once
     the text has landed, so it waits for the frame after the paste. */
  function handleEditorPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    // A fragment with no line break has no indentation to fix
    if (!pasted.includes("\n")) return;
    const input = event.currentTarget;
    window.requestAnimationFrame(() => formatPastedBlock(input, pasted));
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && findOpen) {
      event.preventDefault();
      setFindOpen(false);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && (event.key === "x" || event.code === "KeyX")) {
      const input = event.currentTarget;
      // A real selection cuts natively; only an empty one grows to a line.
      if (input.selectionStart === input.selectionEnd) selectLineForCut(input);
      return;
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveLines(event.currentTarget, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === "F" || event.key === "f" || event.code === "KeyF")) {
      event.preventDefault();
      handleFormat();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (language === "json") handleFormat();
      else handleRun();
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const input = event.currentTarget;
    const text = input.value;
    const { selectionStart, selectionEnd } = input;

    // Plain Tab inside a single line stays a literal indent insert; only a
    // multi-line selection (and any Shift+Tab) shifts whole lines.
    const spansLines = text.slice(selectionStart, selectionEnd).includes("\n");
    if (!event.shiftKey && !spansLines) {
      const next = `${text.slice(0, selectionStart)}${indent}${text.slice(selectionEnd)}`;
      const cursor = selectionStart + indent.length;
      updateSource(next);
      window.requestAnimationFrame(() => input.setSelectionRange(cursor, cursor));
      return;
    }

    // Grow the range to whole lines so the edit always starts at column 0. A
    // selection dragged onto the start of the next line stops at the newline,
    // so that untouched line is left alone.
    const rangeEnd = selectionEnd > selectionStart && text[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
    const blockStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const newlineAfter = text.indexOf("\n", rangeEnd);
    const blockEnd = newlineAfter === -1 ? text.length : newlineAfter;

    let firstDelta = 0;
    let totalDelta = 0;
    const lines = text.slice(blockStart, blockEnd).split("\n").map((line, index) => {
      const delta = event.shiftKey ? -outdentWidth(line, indent) : indent.length;
      if (index === 0) firstDelta = delta;
      totalDelta += delta;
      return delta < 0 ? line.slice(-delta) : delta > 0 ? indent + line : line;
    });
    if (totalDelta === 0) return;

    const next = text.slice(0, blockStart) + lines.join("\n") + text.slice(blockEnd);
    const nextStart = Math.max(blockStart, selectionStart + firstDelta);
    const nextEnd = Math.max(nextStart, selectionEnd + totalDelta);
    updateSource(next);
    window.requestAnimationFrame(() => input.setSelectionRange(nextStart, nextEnd));
  }

  function handleInterpreterKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (running) return;
    if (!interpreterDraft.trim()) {
      appendOutput("input", ">>>");
      return;
    }
    handleRun();
  }

  function handleReset() {
    stopWorkers();
    if (language === "python") setPythonWorkerGeneration((current) => current + 1);
    const next = { ...sources, [language]: DEFAULT_SOURCES[language] };
    setOutput([]);
    setInterpreterDraft("");
    setPreviewVisible(false);
    setHtmlDocument("");
    persist(language, mode, next);
  }

  const availableModes: Mode[] =
    language === "html" ? ["preview"] : language === "json" ? ["view"] : language === "python" ? ["general", "interpreter"] : ["general"];
  const showEditor = mode !== "interpreter" && !(mode === "preview" && previewVisible);
  /* JSON is inert: nothing to execute and nothing to reset back to, so the
     format icon is the only action it offers. */
  const showRunButton = mode !== "interpreter" && language !== "json";
  const showConsole = mode === "general" || mode === "interpreter";
  const showPreview = mode === "preview" && previewVisible;
  const lineNumbers = Array.from({ length: sources[language].split("\n").length }, (_value, index) => index + 1).join("\n");

  return (
    <div className={styles.container} onKeyDown={handleContainerKeyDown}>
      <div className={styles.toolbar}>
        <div className={styles.field}>
          <span>{STRINGS.language[locale]}</span>
          <CodeDropdown
            value={language}
            options={[
              { value: "html", label: "HTML" },
              { value: "javascript", label: "JavaScript" },
              { value: "json", label: "JSON" },
              { value: "python", label: "Python" },
            ]}
            disabled={running}
            ariaLabel={STRINGS.language[locale]}
            onChange={(value) => handleLanguageChange(value as Language)}
          />
        </div>
        <div className={styles.field}>
          <span>{STRINGS.mode[locale]}</span>
          <CodeDropdown
            value={mode}
            options={availableModes.map((value) => ({ value, label: STRINGS[value][locale] }))}
            disabled={running}
            ariaLabel={STRINGS.mode[locale]}
            onChange={(value) => handleModeChange(value as Mode)}
          />
        </div>
        <div className={styles.toolbarSpacer} />
        {showRunButton && (
          <button type="button" className={styles.runButton} onClick={handleRun} disabled={running}>
            {mode === "preview" ? (previewVisible ? STRINGS.edit[locale] : STRINGS.preview[locale]) : STRINGS.run[locale]}
          </button>
        )}
        {language !== "json" && (
          <button type="button" className={styles.resetButton} onClick={handleReset} disabled={running}>
            {STRINGS.reset[locale]}
          </button>
        )}
        {mode !== "interpreter" && (
          <button
            type="button"
            className={styles.formatButton}
            onClick={handleFormat}
            disabled={running || !showEditor}
            aria-label={STRINGS.format[locale]}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <g stroke="currentColor" strokeWidth="1" strokeLinecap="square">
                <line x1="1" y1="1.5" x2="13" y2="1.5" />
                <line x1="5" y1="5.5" x2="13" y2="5.5" />
                <line x1="5" y1="9.5" x2="13" y2="9.5" />
                <line x1="1" y1="13.5" x2="13" y2="13.5" />
              </g>
            </svg>
          </button>
        )}
        {mode !== "interpreter" && (
          <button
            type="button"
            className={styles.searchButton}
            data-open={findOpen}
            onClick={() => (findOpen ? closeFind() : openFind())}
            disabled={!showEditor}
            aria-label={STRINGS.search[locale]}
            aria-pressed={findOpen}
            title={STRINGS.search[locale]}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <g stroke="currentColor" strokeWidth="1" fill="none">
                <circle cx="5.5" cy="5.5" r="4" />
                <line x1="8.5" y1="8.5" x2="12.5" y2="12.5" strokeLinecap="square" />
              </g>
            </svg>
          </button>
        )}
      </div>

      <div className={`${styles.workspace} ${mode === "general" ? styles.generalWorkspace : ""}`}>
        {/* Floats over the top-right corner of the content rather than pushing it
            down, so the line the reader is on doesn't move when the box opens */}
        {showEditor && findOpen && (
          <div className={styles.findPanel} role="search" aria-label={STRINGS.search[locale]}>
            <input
              ref={findInputRef}
              className={styles.findInput}
              value={findText}
              placeholder={STRINGS.find[locale]}
              aria-label={STRINGS.find[locale]}
              spellCheck={false}
              onChange={(event) => setFindText(event.target.value)}
              onKeyDown={(event) => handleFindFieldKeyDown(event, handleFindNext)}
            />
            <input
              className={styles.findInput}
              value={replaceText}
              placeholder={STRINGS.replace[locale]}
              aria-label={STRINGS.replace[locale]}
              spellCheck={false}
              onChange={(event) => setReplaceText(event.target.value)}
              onKeyDown={(event) => handleFindFieldKeyDown(event, handleReplaceNext)}
            />
            <div className={styles.findButtons}>
              <button type="button" className={styles.findButton} onClick={handleFindNext} disabled={!findText}>
                {STRINGS.find[locale]}
              </button>
              <button type="button" className={styles.findButton} onClick={handleReplaceNext} disabled={!findText}>
                {STRINGS.replaceNext[locale]}
              </button>
              <button type="button" className={styles.findButton} onClick={handleReplaceAll} disabled={!findText}>
                {STRINGS.replaceAll[locale]}
              </button>
            </div>
          </div>
        )}
        {showEditor && (
          <section className={styles.editorPane}>
            <div className={styles.editorBody}>
              <pre ref={lineNumbersRef} className={styles.lineNumbers} aria-hidden="true">{lineNumbers}</pre>
              <div className={styles.editorSurface}>
                <pre ref={highlightRef} className={styles.highlight} aria-hidden="true">
                  <code dangerouslySetInnerHTML={{ __html: highlight(sources[language], language) }} />
                </pre>
                <textarea
                  ref={editorRef}
                  className={`${styles.editor} ${styles.editorGrid}`}
                  value={sources[language]}
                  onChange={(event) => updateSource(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  onPaste={handleEditorPaste}
                  onScroll={syncEditorScroll}
                  wrap="off"
                  spellCheck={false}
                  aria-label={`${language} ${STRINGS.editor[locale]}`}
                />
              </div>
            </div>
          </section>
        )}

        {showConsole && (
          <section
            className={`${styles.consolePane} ${mode === "interpreter" ? styles.interpreterPane : ""}`}
            onClick={() => {
              if (mode === "interpreter") interpreterInputRef.current?.focus();
            }}
          >
            <div className={styles.paneHeader}>
              <span className={styles.paneHeaderTitle}>{mode === "interpreter" ? `Python ${STRINGS.interpreter[locale]}` : STRINGS.console[locale]}</span>
              <button
                type="button"
                className={styles.consoleClearButton}
                aria-label={STRINGS.clearConsole[locale]}
                title={STRINGS.clearConsole[locale]}
                onClick={() => setOutput([])}
              >
                clear
              </button>
            </div>
            <div className={styles.consoleBody} ref={consoleBodyRef}>
              {output.length === 0 && mode !== "interpreter" && <div className={styles.emptyOutput}>{STRINGS.empty[locale]}</div>}
              {output.map((line) => (
                <pre key={line.id} className={`${styles.outputLine} ${styles[line.kind]}`}>{line.text}</pre>
              ))}
              {mode === "interpreter" && pythonReady && (
                <label className={styles.promptRow}>
                  <span className={styles.prompt}>&gt;&gt;&gt;</span>
                  <textarea
                    ref={interpreterInputRef}
                    value={interpreterDraft}
                    onChange={(event) => setInterpreterDraft(event.target.value)}
                    onKeyDown={handleInterpreterKeyDown}
                    disabled={running}
                    rows={1}
                    spellCheck={false}
                    aria-label="Python interpreter input"
                    autoFocus
                  />
                </label>
              )}
            </div>
          </section>
        )}

        {showPreview && (
          <iframe
            ref={iframeRef}
            className={styles.preview}
            srcDoc={htmlDocument}
            onLoad={handleHtmlLoad}
            title={STRINGS.previewTitle[locale]}
            sandbox="allow-scripts"
          />
        )}

        {mode === "general" && language === "html" && htmlDocument && (
          <iframe
            ref={iframeRef}
            className={styles.hiddenPreview}
            srcDoc={htmlDocument}
            onLoad={handleHtmlLoad}
            title={STRINGS.previewTitle[locale]}
            sandbox="allow-scripts"
          />
        )}
      </div>
    </div>
  );
}
