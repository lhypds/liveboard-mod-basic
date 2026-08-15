import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { compressToWebp, formatBytes, uploadImage } from "@services/images";
import styles from "./image.module.css";

type Lang = "en" | "ja" | "zh";

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    drop: "Drop a image here",
    browse: "or click to choose a file",
    replace: "Drop to replace",
    compressing: "Compressing...",
    uploading: "Uploading...",
    notImage: "That file is not an image",
    failed: "Upload failed",
    remove: "Remove",
    choose: "Select",
  },
  ja: {
    drop: "ここに画像をドロップ",
    browse: "またはクリックしてファイルを選択",
    replace: "ドロップして差し替え",
    compressing: "圧縮中...",
    uploading: "アップロード中...",
    notImage: "画像ファイルではありません",
    failed: "アップロードに失敗しました",
    remove: "削除",
    choose: "選択",
  },
  zh: {
    drop: "拖放图片到此处",
    browse: "或点击选择文件",
    replace: "拖放以替换",
    compressing: "压缩中...",
    uploading: "上传中...",
    notImage: "该文件不是图片",
    failed: "上传失败",
    remove: "移除",
    choose: "选择",
  },
};

type Comp = {
  url?: string;
  name?: string;
  width?: number;
  height?: number;
  bytes?: number;
  fit?: string;
  quality?: number;
  maxSize?: number;
};

export default function ImageCard({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = (i18n.language in STRINGS ? i18n.language : "en") as Lang;
  const strings = STRINGS[lang];
  const comp = config.comp as Comp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;

  const url = comp?.url ?? "";
  const fit = comp?.fit === "cover" ? "cover" : "contain";

  const [stage, setStage] = useState<"" | "compressing" | "uploading">("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // A second drop while the first is still going would race it to the save, and whichever landed
  // last would be the picture the card kept
  const busy = stage !== "";

  async function accept(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(strings.notImage);
      return;
    }

    setError("");
    setStage("compressing");
    try {
      // Compressing before the upload is what keeps the layout holding a URL rather than the
      // picture: a board is saved as JSON, so a data URL would ride along in every save and export.
      const { blob, width, height } = await compressToWebp(file, { quality: comp?.quality, maxSize: comp?.maxSize });
      setStage("uploading");
      const uploaded = await uploadImage(blob);
      save?.({
        ...comp,
        url: uploaded.url,
        name: uploaded.name,
        width,
        height,
        bytes: uploaded.bytes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.failed);
    } finally {
      setStage("");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    void accept(e.dataTransfer.files[0]);
  }

  function handleDragOver(e: React.DragEvent) {
    // Without this the browser navigates away to the dropped file instead of handing it over
    e.preventDefault();
    if (!busy) setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Moving over a child fires leave on the parent; only the pointer actually going out counts
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    void accept(e.target.files?.[0]);
    // Same file picked twice in a row still fires a change event
    e.target.value = "";
  }

  function remove() {
    // The file stays on the board — it is named after its own bytes, so dropping it again costs
    // nothing and another card may be pointing at the same one.
    save?.({ ...comp, url: "", name: "", width: 0, height: 0, bytes: 0 });
    setError("");
  }

  const caption = [comp?.width && comp?.height ? `${comp.width}x${comp.height}` : "", comp?.bytes ? formatBytes(comp.bytes) : ""]
    .filter(Boolean)
    .join("  ");

  return (
    <div
      className={`${styles.container}${dragging ? ` ${styles.dragging}` : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input ref={inputRef} type="file" accept="image/*" className={styles.input} onChange={handleChange} />

      {url ? (
        <div className={styles.frame}>
          {/* The stored name is the bytes' digest, which is nothing to read out — the picture is
              the card's whole content, so it is left to speak for itself. */}
          <img className={styles.image} style={{ objectFit: fit }} src={url} alt="" draggable={false} />
          <div className={styles.overlay}>
            {caption && <span className={styles.caption}>{caption}</span>}
            <button type="button" className={styles.action} onClick={() => inputRef.current?.click()} disabled={busy}>
              {strings.choose}
            </button>
            <button type="button" className={styles.action} onClick={remove} disabled={busy}>
              {strings.remove}
            </button>
          </div>
          {dragging && <div className={styles.replace}>{strings.replace}</div>}
        </div>
      ) : (
        <button type="button" className={styles.dropzone} onClick={() => inputRef.current?.click()} disabled={busy}>
          <span className={styles.dropText}>{strings.drop}</span>
          <span className={styles.dropHint}>{strings.browse}</span>
        </button>
      )}

      {busy && <div className={styles.status}>{stage === "uploading" ? strings.uploading : strings.compressing}</div>}
      {error && !busy && <div className={`${styles.status} ${styles.statusError}`}>{error}</div>}
    </div>
  );
}
