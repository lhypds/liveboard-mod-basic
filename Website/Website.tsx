import styles from "./website.module.css";

const STORAGE_KEY = "iframe.settings";

function loadUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { url?: string }).url ?? "" : "";
  } catch {
    return "";
  }
}

export default function Website({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { url?: string } | undefined;
  const url = typeof comp?.url === "string" ? comp.url : loadUrl();

  if (!url) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.hint}>No URL configured.</span>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      className={styles.iframe}
      title="Embedded content"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
