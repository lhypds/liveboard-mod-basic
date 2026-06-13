import { useCallback } from "react";
import styles from "./website.module.css";

const STORAGE_KEY = "iframe.settings";

function loadUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? ((JSON.parse(raw) as { url?: string }).url ?? "") : "";
  } catch {
    return "";
  }
}

type CropComp = {
  x?: number;
  y?: number;
  renderW?: number;
  renderH?: number;
};

export default function Website({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { url?: string; crop?: CropComp } | undefined;
  const url = typeof comp?.url === "string" ? comp.url : loadUrl();
  const crop = comp?.crop;

  const cropX = crop?.x ?? 0;
  const cropY = crop?.y ?? 0;
  const renderW = crop?.renderW ?? 1920;
  const renderH = crop?.renderH ?? 1080;
  const hasCrop = cropX !== 0 || cropY !== 0;

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      if (!hasCrop) return;
      try {
        const doc = e.currentTarget.contentDocument;
        if (doc?.body) doc.body.style.overflow = "hidden";
      } catch {
        // cross-origin: cannot access contentDocument
      }
    },
    [hasCrop],
  );

  if (!url) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.hint}>No URL configured.</span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <iframe
        src={url}
        style={
          hasCrop
            ? {
                position: "absolute",
                top: -cropY,
                left: -cropX,
                width: renderW,
                height: renderH,
                border: "none",
              }
            : undefined
        }
        className={hasCrop ? undefined : styles.iframe}
        onLoad={handleLoad}
        title="Embedded content"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
