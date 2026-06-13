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
};

export default function Website({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { url?: string; allowInteract?: true | false | "no-scroll"; crop?: CropComp } | undefined;
  const url = typeof comp?.url === "string" ? comp.url : loadUrl();
  const allowInteract = comp?.allowInteract ?? true;
  const blockAll = allowInteract === false;
  const blockScroll = allowInteract === "no-scroll";
  const crop = comp?.crop;

  const cropX = crop?.x ?? 0;
  const cropY = crop?.y ?? 0;
  const renderW = crop?.renderW ?? 1920;
  const renderH = crop?.renderH ?? 1080;
  const hasCrop = cropX !== 0 || cropY !== 0;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      if (blockScroll) iframeRef.current.setAttribute("scrolling", "no");
      else iframeRef.current.removeAttribute("scrolling");
    }
  }, [blockScroll]);

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
