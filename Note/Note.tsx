import { useState, useRef, useEffect } from "react";
import TextArea from "@ui/TextArea";
import styles from "./note.module.css";

export default function Note({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { content?: string } | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;

  const [value, setValue] = useState(() => comp?.content ?? "");

  // Sync when content changes from outside (e.g. import/restore)
  const lastSavedRef = useRef(comp?.content ?? "");
  useEffect(() => {
    const incoming = comp?.content ?? "";
    if (incoming !== lastSavedRef.current) {
      lastSavedRef.current = incoming;
      setValue(incoming);
    }
  }, [comp?.content]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    lastSavedRef.current = next;
    save?.({ ...comp, content: next });
  }

  return (
    <div className={styles.container}>
      <TextArea
        value={value}
        onChange={handleChange}
        placeholder="Type your notes here..."
        className={styles.textarea}
      />
    </div>
  );
}
