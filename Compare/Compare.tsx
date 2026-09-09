import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { compareLines, MAX_LINES, MAX_TEXT_LENGTH } from "./diff";
import styles from "./compare.module.css";

type Source = { name: string; text: string };
type Locale = "en" | "ja" | "zh";
const strings = {
  left: { en: "Left · Original", ja: "左 · 元の内容", zh: "左侧 · 原文" },
  right: { en: "Right · Updated", ja: "右 · 変更後", zh: "右侧 · 修改后" },
  result: { en: "Result", ja: "比較結果", zh: "比较结果" },
  browse: { en: "Choose file", ja: "ファイルを選択", zh: "选择文件" },
  clear: { en: "Clear", ja: "クリア", zh: "清空" },
  drop: { en: "Drop file here", ja: "ここにドロップ", zh: "拖放文件到这里" },
  waiting: { en: "Add text or a file on both sides to compare.", ja: "両側にテキストかファイルを追加してください。", zh: "在两侧添加文本或文件以进行比较。" },
  identical: { en: "No differences", ja: "差分なし", zh: "没有差异" },
  added: { en: "added", ja: "追加", zh: "新增" },
  deleted: { en: "deleted", ja: "削除", zh: "删除" },
  noNewline: { en: "No newline at end of file", ja: "ファイル末尾に改行なし", zh: "文件末尾无换行符" },
  size: { en: "Use a file up to 512 KB and 5,000 lines.", ja: "512 KB・5,000行以下のファイルを使用してください。", zh: "请使用不超过 512 KB、5,000 行的文件。" },
  complexity: { en: "Too many changes to display. Compare smaller sections of these files.", ja: "変更が多すぎます。ファイルの一部を比較してください。", zh: "更改过多，请比较文件中较小的片段。" },
  invalid: { en: "Choose a UTF-8 code or text file.", ja: "UTF-8のコード・テキストファイルを選んでください。", zh: "请选择 UTF-8 代码或文本文件。" },
  failed: { en: "Could not read this file. Try again.", ja: "ファイルを読み込めません。再試行してください。", zh: "无法读取此文件，请重试。" },
  single: { en: "Drop one file at a time on each side.", ja: "各側に1ファイルずつドロップしてください。", zh: "每侧一次只能拖入一个文件。" },
  local: { en: "Files stay in this tab · CRLF and LF are treated equally", ja: "ファイルはこのタブ内のみ · CRLFとLFは同一扱い", zh: "文件仅保留在此标签页 · CRLF 与 LF 视为相同" },
} satisfies Record<string, Record<Locale, string>>;
type Labels = { [K in keyof typeof strings]: string };

function SourcePane({ side, source, onChange, labels }: {
  side: "left" | "right";
  source: Source | null;
  onChange: (source: Source | null) => void;
  labels: Labels;
}) {
  const input = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<"size" | "invalid" | "failed" | "single" | null>(null);
  const [loading, setLoading] = useState(false);

  async function readFiles(files: FileList) {
    const id = ++readId.current;
    setLoading(false);
    setError(null);
    if (files.length !== 1) { setError("single"); return; }
    const file = files[0];
    if (file.size > MAX_TEXT_LENGTH) { setError("size"); return; }
    setLoading(true);
    try {
      const bytes = await file.arrayBuffer();
      if (id !== readId.current) return;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        setError("invalid");
        return;
      }
      if (Array.from(text).some((character) => {
        const code = character.charCodeAt(0);
        return code < 9 || (code > 13 && code < 32);
      })) { setError("invalid"); return; }
      const lineCount = text ? text.split(/\r\n?|\n/).length - (/[\r\n]$/.test(text) ? 1 : 0) : 0;
      if (lineCount > MAX_LINES) { setError("size"); return; }
      onChange({ name: file.name, text });
    } catch {
      if (id === readId.current) setError("failed");
    } finally {
      if (id === readId.current) setLoading(false);
    }
  }

  function change(next: Source | null) {
    readId.current++;
    setLoading(false);
    setError(null);
    onChange(next);
  }

  return (
    <section
      className={`${styles.source} ${styles[side]} ${dragging ? styles.dragging : ""}`}
      aria-label={labels[side]}
      aria-busy={loading}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        void readFiles(event.dataTransfer.files);
      }}
    >
      <header className={styles.header}>
        <strong>{labels[side]}</strong>
        <button type="button" onClick={() => change(null)} disabled={!source && !loading && !error}>{labels.clear}</button>
      </header>
      <div className={styles.fileBar}>
        <button type="button" onClick={() => input.current?.click()}>{labels.browse}</button>
        <span title={source?.name}>{source?.name ?? "—"}</span>
        <input ref={input} type="file" hidden aria-label={`${labels.browse}: ${labels[side]}`} onChange={(event) => {
          if (event.target.files?.length) void readFiles(event.target.files);
          event.target.value = "";
        }} />
      </div>
      {error && <p className={styles.error} role="alert">{labels[error]}</p>}
      <textarea
        className={styles.editor}
        aria-label={labels[side]}
        value={source?.text ?? ""}
        maxLength={MAX_TEXT_LENGTH}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        onChange={(event) => change({ name: source?.name ?? "", text: event.target.value })}
      />
      {dragging && <div className={styles.dropOverlay}>{labels.drop}</div>}
    </section>
  );
}

export default function Compare() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const locale: Locale = language.startsWith("ja") ? "ja" : language.startsWith("zh") ? "zh" : "en";
  const labels = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[locale]])) as Labels;
  const [left, setLeft] = useState<Source | null>(null);
  const [right, setRight] = useState<Source | null>(null);
  const comparison = useMemo(() => {
    if (!left || !right) return null;
    try {
      const rows = compareLines(left.text, right.text);
      return { rows, added: rows.filter((row) => row.kind === "added").length, deleted: rows.filter((row) => row.kind === "deleted").length };
    } catch (error) {
      return { error: error instanceof Error && error.message === "size" ? "size" as const : "complexity" as const };
    }
  }, [left, right]);

  return (
    <div className={styles.compare}>
      <div className={styles.workspace}>
        <SourcePane side="left" source={left} onChange={setLeft} labels={labels} />
        <section className={styles.result} aria-label={labels.result}>
          <header className={styles.header}>
            <strong>{labels.result}</strong>
            <span className={styles.summary} role="status">
              {comparison && !comparison.error && <>
                <span className={styles.addCount}>+{comparison.added} {labels.added}</span>
                <span className={styles.deleteCount}>−{comparison.deleted} {labels.deleted}</span>
              </>}
            </span>
          </header>
          {!comparison ? <p className={styles.empty}>{labels.waiting}</p>
            : comparison.error ? <p className={styles.error} role="alert">{labels[comparison.error]}</p>
            : <>
              {comparison.added === 0 && comparison.deleted === 0 && <p className={styles.identical} role="status">{labels.identical}</p>}
              <div className={styles.diff} tabIndex={0} aria-label={labels.result}>
                <div className={styles.diffLines}>
                  {comparison.rows.map((row, index) => (
                    <div key={index} className={`${styles.line} ${styles[row.kind]}`}>
                      <span className={styles.lineNumber}>{row.left}</span>
                      <span className={styles.lineNumber}>{row.right}</span>
                      <span className={styles.sign}>{row.kind === "added" ? "+" : row.kind === "deleted" ? "−" : " "}</span>
                      <code>{row.text || " "}{row.noNewline && <span className={styles.noNewline}> ↵ {labels.noNewline}</span>}</code>
                    </div>
                  ))}
                </div>
              </div>
            </>}
        </section>
        <SourcePane side="right" source={right} onChange={setRight} labels={labels} />
      </div>
      <p className={styles.footer}>{labels.local}</p>
    </div>
  );
}
