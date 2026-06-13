import styles from "./iframe.module.css";

const STORAGE_KEY = "iframe.settings";

function loadUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { url?: string }).url ?? "" : "";
  } catch {
    return "";
  }
}

export default function IFrame() {
  const url = loadUrl();

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
