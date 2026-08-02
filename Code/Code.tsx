import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import JavaScriptWorker from "./javascript.worker?worker";
import PythonWorker from "./python.worker?worker";
import styles from "./code.module.css";

type Locale = "en" | "ja" | "zh";
type Language = "html" | "javascript" | "python";
type Mode = "general" | "interpreter" | "preview";
type OutputKind = "log" | "warn" | "error" | "result" | "status" | "input";

type Sources = Record<Language, string>;
type CodeComp = {
  language?: Language;
  mode?: Mode;
  sources?: Partial<Sources>;
};
type OutputLine = { id: number; kind: OutputKind; text: string };
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
  python: `print("Hello, Liveboard!")`,
};

const STRINGS = {
  mode: { en: "Mode", ja: "モード", zh: "模式" },
  language: { en: "Language", ja: "言語", zh: "语言" },
  general: { en: "Console", ja: "コンソール", zh: "控制台" },
  interpreter: { en: "Interpreter", ja: "インタープリター", zh: "解释器" },
  preview: { en: "Preview", ja: "プレビュー", zh: "预览" },
  run: { en: "Run", ja: "実行", zh: "执行" },
  edit: { en: "Edit", ja: "編集", zh: "编辑" },
  reset: { en: "Reset", ja: "リセット", zh: "重置" },
  editor: { en: "Editor", ja: "エディター", zh: "编辑器" },
  console: { en: "Console", ja: "コンソール", zh: "控制台" },
  clearConsole: { en: "Clear console", ja: "コンソールをクリア", zh: "清空控制台" },
  empty: { en: "Run code to see the output.", ja: "コードを実行すると結果が表示されます。", zh: "执行代码后将在这里显示结果。" },
  completed: { en: "Completed.", ja: "完了しました。", zh: "执行完成。" },
  timedOut: { en: "Execution timed out.", ja: "実行がタイムアウトしました。", zh: "执行超时。" },
  htmlRendered: { en: "HTML rendered.", ja: "HTML を描画しました。", zh: "HTML 已渲染。" },
  previewTitle: { en: "HTML preview", ja: "HTML プレビュー", zh: "HTML 预览" },
} satisfies Record<string, Record<Locale, string>>;

function getLocale(language: string): Locale {
  return language === "ja" || language === "zh" ? language : "en";
}

function isLanguage(value: unknown): value is Language {
  return value === "html" || value === "javascript" || value === "python";
}

function isMode(value: unknown): value is Mode {
  return value === "general" || value === "interpreter" || value === "preview";
}

function modeIsAvailable(mode: Mode, language: Language): boolean {
  if (language === "html") return mode === "preview";
  if (language === "javascript") return mode === "general";
  return mode === "general" || mode === "interpreter";
}

function normalizeComp(comp: CodeComp | undefined): { language: Language; mode: Mode; sources: Sources } {
  const language = isLanguage(comp?.language) ? comp.language : "html";
  const candidateMode = isMode(comp?.mode) ? comp.mode : "general";
  const fallbackMode: Mode = language === "html" ? "preview" : "general";
  const mode = modeIsAvailable(candidateMode, language) ? candidateMode : fallbackMode;
  return {
    language,
    mode,
    sources: {
      html: typeof comp?.sources?.html === "string" ? comp.sources.html : DEFAULT_SOURCES.html,
      javascript: typeof comp?.sources?.javascript === "string" ? comp.sources.javascript : DEFAULT_SOURCES.javascript,
      python: typeof comp?.sources?.python === "string" ? comp.sources.python : DEFAULT_SOURCES.python,
    },
  };
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
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [htmlDocument, setHtmlDocument] = useState("");
  const [interpreterDraft, setInterpreterDraft] = useState("");
  const [pythonReady, setPythonReady] = useState(false);
  const [pythonWorkerGeneration, setPythonWorkerGeneration] = useState(0);

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
  const interpreterInputRef = useRef<HTMLTextAreaElement>(null);

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

  function handleLanguageChange(next: Language) {
    stopWorkers();
    const nextMode: Mode = next === "html" ? "preview" : "general";
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

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleRun();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const input = event.currentTarget;
    const next = `${input.value.slice(0, input.selectionStart)}  ${input.value.slice(input.selectionEnd)}`;
    const cursor = input.selectionStart + 2;
    updateSource(next);
    window.requestAnimationFrame(() => input.setSelectionRange(cursor, cursor));
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

  const availableModes: Mode[] = language === "html" ? ["preview"] : language === "python" ? ["general", "interpreter"] : ["general"];
  const showEditor = mode !== "interpreter" && !(mode === "preview" && previewVisible);
  const showConsole = mode === "general" || mode === "interpreter";
  const showPreview = mode === "preview" && previewVisible;
  const lineNumbers = Array.from({ length: sources[language].split("\n").length }, (_value, index) => index + 1).join("\n");

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.field}>
          <span>{STRINGS.language[locale]}</span>
          <CodeDropdown
            value={language}
            options={[
              { value: "html", label: "HTML" },
              { value: "javascript", label: "JavaScript" },
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
        {mode !== "interpreter" && (
          <button type="button" className={styles.runButton} onClick={handleRun} disabled={running}>
            {mode === "preview" && previewVisible ? STRINGS.edit[locale] : STRINGS.run[locale]}
          </button>
        )}
        <button type="button" className={styles.resetButton} onClick={handleReset} disabled={running}>
          {STRINGS.reset[locale]}
        </button>
      </div>

      <div className={`${styles.workspace} ${mode === "general" ? styles.generalWorkspace : ""}`}>
        {showEditor && (
          <section className={styles.editorPane}>
            <div className={styles.editorBody}>
              <pre ref={lineNumbersRef} className={styles.lineNumbers} aria-hidden="true">{lineNumbers}</pre>
              <textarea
                className={`${styles.editor} ${styles.editorGrid}`}
                value={sources[language]}
                onChange={(event) => updateSource(event.target.value)}
                onKeyDown={handleEditorKeyDown}
                onScroll={(event) => {
                  if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
                }}
                wrap="off"
                spellCheck={false}
                aria-label={`${language} ${STRINGS.editor[locale]}`}
              />
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
