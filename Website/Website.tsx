import { useCallback, useEffect, useRef } from "react";
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
  renderSizeControl?: boolean;
};

export default function Website({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { url?: string; allowInteract?: true | false | "no-scroll"; refreshRate?: number; crop?: CropComp; zoom?: number } | undefined;
  const url = typeof comp?.url === "string" ? comp.url : loadUrl();
  const allowInteract = comp?.allowInteract ?? true;
  const blockAll = allowInteract === false;
  const blockScroll = allowInteract === "no-scroll";
  const refreshRate = typeof comp?.refreshRate === "number" ? comp.refreshRate : 0;
  const crop = comp?.crop;
  const zoom = typeof comp?.zoom === "number" && comp.zoom > 0 ? comp.zoom : 1;

  const cropX = crop?.x ?? 0;
  const cropY = crop?.y ?? 0;
  const renderSizeControl = crop?.renderSizeControl ?? false;
  const renderW = renderSizeControl ? (crop?.renderW ?? 1920) : undefined;
  const renderH = renderSizeControl ? (crop?.renderH ?? 1080) : undefined;
  const hasCrop = cropX !== 0 || cropY !== 0;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      if (blockScroll) iframeRef.current.setAttribute("scrolling", "no");
      else iframeRef.current.removeAttribute("scrolling");
    }
  }, [blockScroll]);

  useEffect(() => {
    if (!refreshRate || refreshRate <= 0) return;
    const id = setInterval(() => {
      if (iframeRef.current) iframeRef.current.src = iframeRef.current.src;
    }, refreshRate * 1000);
    return () => clearInterval(id);
  }, [refreshRate]);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      if (!hasCrop && !blockScroll) return;
      try {
        const doc = e.currentTarget.contentDocument;
        if (doc?.body) doc.body.style.overflow = "hidden";
      } catch {
        // cross-origin: cannot access contentDocument
      }
    },
    [hasCrop, blockScroll],
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
      {blockAll && <div className={styles.blocker} />}
      <iframe
        ref={iframeRef}
        src={url}
        style={
          hasCrop
            ? {
                position: "absolute",
                top: -cropY,
                left: -cropX,
                width: renderW ?? "100%",
                height: renderH ?? "100%",
                border: "none",
                transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                transformOrigin: zoom !== 1 ? "top left" : undefined,
              }
            : zoom !== 1
              ? {
                  width: `${100 / zoom}%`,
                  height: `${100 / zoom}%`,
                  border: "none",
                  display: "block",
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }
              : undefined
        }
        className={hasCrop || zoom !== 1 ? undefined : styles.iframe}
        onLoad={handleLoad}
        title="Embedded content"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
