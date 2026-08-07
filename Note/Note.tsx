import { useState, useRef, useEffect, useLayoutEffect } from "react";
import TextArea from "@ui/TextArea";
import { useFollowBottom } from "@hooks/useFollowBottom";
import styles from "./note.module.css";

/* One indent level = two spaces, i.e. exactly one background grid cell. */
const INDENT = "  ";

export default function Note({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { content?: string; createdAt?: number; updatedAt?: number } | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;

  const [value, setValue] = useState(() => comp?.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { mark, follow } = useFollowBottom(textareaRef);

  // Sync when content changes from outside (e.g. import/restore)
  const lastSavedRef = useRef(comp?.content ?? "");
  useEffect(() => {
    const incoming = comp?.content ?? "";
    if (incoming !== lastSavedRef.current) {
      lastSavedRef.current = incoming;
      // The textarea still holds the old text until the render below lands, so
      // this is the last moment the reader's place in it can be read
      mark();
      setValue(incoming);
    }
  }, [comp?.content, mark]);

  // Text generated into the note arrives a chunk at a time; keep the newest line
  // in view for a reader who was already at the end of it
  useLayoutEffect(() => {
    follow();
  }, [value, follow]);

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

  // Re-assert the caret after a keyboard edit: React rewrites the textarea's value
  // on the following render, which would otherwise drop the selection to the end.
  const pendingSelectionRef = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current;
    if (!selection || !textareaRef.current) return;
    pendingSelectionRef.current = null;
    textareaRef.current.setSelectionRange(selection[0], selection[1]);
  });

  // Every shortcut edits through here: execCommand keeps the browser's native undo
  // stack, and the resulting input event flows into handleChange as usual.
  function replaceRange(
    el: HTMLTextAreaElement,
    start: number,
    end: number,
    replacement: string,
    selection: [number, number],
  ) {
    const text = el.value;
    // A no-op edit renders nothing, so the pending selection would leak into a
    // later render — just move the caret and stop.
    if (replacement === text.slice(start, end)) {
      el.setSelectionRange(selection[0], selection[1]);
      return;
    }

    pendingSelectionRef.current = selection;
    el.setSelectionRange(start, end);
    const ok = replacement
      ? document.execCommand("insertText", false, replacement)
      : document.execCommand("delete");
    if (!ok) {
      const next = text.slice(0, start) + replacement + text.slice(end);
      setValue(next);
      persist(next);
    }
  }

  // lastIndexOf clamps a negative fromIndex to 0 instead of reporting no match, so
  // column 0 needs answering up front — otherwise a leading newline is found.
  function lineStartAt(text: string, pos: number) {
    return pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;
  }

  // The whole-line block the selection touches, always starting at column 0. A
  // selection dragged onto the start of the next line stops at the newline, so
  // that untouched line is left alone.
  function lineBlock(text: string, selectionStart: number, selectionEnd: number) {
    const rangeEnd =
      selectionEnd > selectionStart && text[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
    const newlineAfter = text.indexOf("\n", rangeEnd);
    return {
      start: lineStartAt(text, selectionStart),
      end: newlineAfter === -1 ? text.length : newlineAfter,
    };
  }

  // Tab indents every line the selection touches, Shift+Tab unindents them.
  function indentLines(el: HTMLTextAreaElement, unindent: boolean) {
    const text = el.value;
    const { selectionStart, selectionEnd } = el;
    const { start, end } = lineBlock(text, selectionStart, selectionEnd);

    let firstDelta = 0;
    let totalDelta = 0;
    const nextLines = text
      .slice(start, end)
      .split("\n")
      .map((line, i) => {
        // Unindent only strips a full two-space level, matching what Tab added.
        const delta = unindent ? (line.startsWith(INDENT) ? -INDENT.length : 0) : INDENT.length;
        if (i === 0) firstDelta = delta;
        totalDelta += delta;
        return delta < 0 ? line.slice(INDENT.length) : delta > 0 ? INDENT + line : line;
      });
    if (totalDelta === 0) return;

    const nextStart = Math.max(start, selectionStart + firstDelta);
    const nextEnd = Math.max(nextStart, selectionEnd + totalDelta);
    replaceRange(el, start, end, nextLines.join("\n"), [nextStart, nextEnd]);
  }

  // Ctrl+X cuts the selection, or the whole line when the caret is collapsed — the
  // way an editor does. Both halves are handled here rather than left to the browser:
  // macOS binds cut to Cmd+X, so a plain Ctrl+X would otherwise be a dead key.
  function cut(el: HTMLTextAreaElement) {
    const text = el.value;

    if (el.selectionStart !== el.selectionEnd) {
      const { selectionStart, selectionEnd } = el;
      navigator.clipboard?.writeText(text.slice(selectionStart, selectionEnd)).catch(() => {});
      replaceRange(el, selectionStart, selectionEnd, "", [selectionStart, selectionStart]);
      return;
    }

    const { start, end } = lineBlock(text, el.selectionStart, el.selectionEnd);
    // Take the line's trailing newline with it; on the last line take the leading
    // one instead, so cutting never leaves a blank row behind.
    const cutEnd = end < text.length ? end + 1 : end;
    const cutStart = cutEnd === end && start > 0 ? start - 1 : start;
    navigator.clipboard?.writeText(text.slice(start, end) + "\n").catch(() => {});

    // Keep the column: the caret lands on whichever line moved into this slot.
    const column = el.selectionStart - start;
    const next = text.slice(0, cutStart) + text.slice(cutEnd);
    const lineStart = lineStartAt(next, cutStart);
    const newlineAfter = next.indexOf("\n", lineStart);
    const lineEnd = newlineAfter === -1 ? next.length : newlineAfter;
    const caret = Math.min(lineStart + column, lineEnd);

    replaceRange(el, cutStart, cutEnd, "", [caret, caret]);
  }

  // Option/Alt + Up/Down swaps the selected line block with its neighbour.
  function moveLines(el: HTMLTextAreaElement, direction: -1 | 1) {
    const text = el.value;
    const { selectionStart, selectionEnd } = el;
    const { start, end } = lineBlock(text, selectionStart, selectionEnd);
    const block = text.slice(start, end);

    if (direction < 0) {
      if (start === 0) return;
      const aboveStart = lineStartAt(text, start - 1);
      const above = text.slice(aboveStart, start - 1);
      const shift = -(above.length + 1);
      replaceRange(el, aboveStart, end, `${block}\n${above}`, [selectionStart + shift, selectionEnd + shift]);
    } else {
      if (end === text.length) return;
      const newlineAfter = text.indexOf("\n", end + 1);
      const belowEnd = newlineAfter === -1 ? text.length : newlineAfter;
      const below = text.slice(end + 1, belowEnd);
      const shift = below.length + 1;
      replaceRange(el, start, belowEnd, `${below}\n${block}`, [selectionStart + shift, selectionEnd + shift]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;

    if (e.key === "x" && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      cut(el);
      return;
    }

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      moveLines(el, e.key === "ArrowUp" ? -1 : 1);
      return;
    }

    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      indentLines(el, e.shiftKey);
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
