import { useState, useRef, useEffect, useLayoutEffect } from "react";
import TextArea from "@ui/TextArea";
import styles from "./note.module.css";

/* One indent level = two spaces, i.e. exactly one background grid cell. */
const INDENT = "  ";

export default function Note({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { content?: string; createdAt?: number; updatedAt?: number } | undefined;
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

  // A note stamps its creation time the first time it mounts — a card added from the
  // Add menu starts with no `createdAt`, so this is the moment it was created. The ref
  // keeps the double-mount under StrictMode from stamping twice.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (stampedRef.current || comp?.createdAt) return;
    stampedRef.current = true;
    save?.({ ...comp, createdAt: Date.now() });
  }, [comp, save]);

  // Both times land in the comp config, which is what the Info modal reads.
  function persist(next: string) {
    lastSavedRef.current = next;
    save?.({ ...comp, content: next, createdAt: comp?.createdAt ?? Date.now(), updatedAt: Date.now() });
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    persist(next);
  }

  // Re-assert the caret after a Tab edit: React rewrites the textarea's value on
  // the following render, which would otherwise drop the selection to the end.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current;
    if (!selection || !textareaRef.current) return;
    pendingSelectionRef.current = null;
    textareaRef.current.setSelectionRange(selection[0], selection[1]);
  });

  // Tab indents every line the selection touches, Shift+Tab unindents them.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();

    const el = e.currentTarget;
    const text = el.value;
    const { selectionStart, selectionEnd } = el;

    // Grow the range to whole lines so the edit always starts at column 0. A
    // selection dragged onto the start of the next line stops at the newline,
    // so that untouched line is left alone.
    const rangeEnd =
      selectionEnd > selectionStart && text[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
    const blockStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const newlineAfter = text.indexOf("\n", rangeEnd);
    const blockEnd = newlineAfter === -1 ? text.length : newlineAfter;

    const lines = text.slice(blockStart, blockEnd).split("\n");
    let firstDelta = 0;
    let totalDelta = 0;
    const nextLines = lines.map((line, i) => {
      // Unindent only strips a full two-space level, matching what Tab added.
      const delta = e.shiftKey ? (line.startsWith(INDENT) ? -INDENT.length : 0) : INDENT.length;
      if (i === 0) firstDelta = delta;
      totalDelta += delta;
      return delta < 0 ? line.slice(INDENT.length) : delta > 0 ? INDENT + line : line;
    });
    if (totalDelta === 0) return;

    const nextStart = Math.max(blockStart, selectionStart + firstDelta);
    const nextEnd = Math.max(nextStart, selectionEnd + totalDelta);
    pendingSelectionRef.current = [nextStart, nextEnd];

    // Replace through execCommand so the browser's native undo stack keeps the
    // edit; the resulting input event flows into handleChange as usual.
    el.setSelectionRange(blockStart, blockEnd);
    const nextBlock = nextLines.join("\n");
    if (!document.execCommand("insertText", false, nextBlock)) {
      const next = text.slice(0, blockStart) + nextBlock + text.slice(blockEnd);
      setValue(next);
      persist(next);
    }
  }

  return (
    <div className={styles.container}>
      <TextArea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={`${styles.textarea} ${styles.textareaGrid}`}
      />
    </div>
  );
}
