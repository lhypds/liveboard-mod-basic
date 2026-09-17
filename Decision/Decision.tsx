import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmModal from "@components/ConfirmModal";
import styles from "./decision.module.css";

type Locale = "en" | "ja" | "zh";
const strings = {
  question: { en: "What is being decided?", ja: "何を決めますか？", zh: "要决定什么？" },
  dimension: { en: "Dimension", ja: "比較軸", zh: "维度" },
  option: { en: "Option", ja: "選択肢", zh: "选项" },
  conclusion: { en: "Conclusion", ja: "結論", zh: "结论" },
  overall: { en: "Overall conclusion", ja: "総合結論", zh: "总结论" },
  addOption: { en: "+ Option", ja: "+ 選択肢", zh: "+ 选项" },
  addDimension: { en: "+ Dimension", ja: "+ 比較軸", zh: "+ 维度" },
  removeOption: { en: "Remove option", ja: "選択肢を削除", zh: "删除选项" },
  removeDimension: { en: "Remove dimension", ja: "比較軸を削除", zh: "删除维度" },
  confirmOption: {
    en: "Remove this option and everything in its column?",
    ja: "この選択肢と列の内容をすべて削除しますか？",
    zh: "删除此选项及其整列内容？",
  },
  confirmDimension: {
    en: "Remove this dimension and everything in its row?",
    ja: "この比較軸と行の内容をすべて削除しますか？",
    zh: "删除此维度及其整行内容？",
  },
  remove: { en: "Remove", ja: "削除", zh: "删除" },
} satisfies Record<string, Record<Locale, string>>;
type Labels = { [K in keyof typeof strings]: string };

type Option = { id: string; name: string };
type Row = { id: string; dimension: string; cells: Record<string, string>; conclusion: string };
type Sheet = { question: string; options: Option[]; rows: Row[]; conclusion: string };
type Comp = Record<string, unknown> & { createdAt?: number; updatedAt?: number };
type Removal = { kind: "option" | "row"; id: string };

/* Column widths in px: the table never gets narrower than their sum, and shares out whatever
   width the card has beyond that in the same proportions. More options scroll sideways. */
const DIMENSION_PX = 120;
const OPTION_PX = 120;
const CONCLUSION_PX = 140;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function withId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && !!(value as { id: string }).id;
}

/** A repeated id would give two columns one key, and typing into either would write both. */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// comp is free-form and can be hand-edited in the Edit modal, so nothing read out of it is trusted
function readSheet(comp: Comp | undefined): Sheet {
  const options = uniqueById(
    (Array.isArray(comp?.options) ? comp.options : []).filter(withId).map((o) => ({ id: o.id, name: text(o.name) })),
  );
  const rows = uniqueById(
    (Array.isArray(comp?.rows) ? comp.rows : []).filter(withId).map((r) => {
      const cells = r.cells && typeof r.cells === "object" ? (r.cells as Record<string, unknown>) : {};
      return {
        id: r.id,
        dimension: text(r.dimension),
        // Only the cells of options still on the sheet, and only filled ones: an empty cell and a missing one read the same
        cells: Object.fromEntries(options.map((o) => [o.id, text(cells[o.id])]).filter(([, value]) => value)),
        conclusion: text(r.conclusion),
      };
    }),
  );
  return { question: text(comp?.question), options, rows, conclusion: text(comp?.conclusion) };
}

/**
 * What an edit saves: the sheet written back over comp, cleaned — whatever a hand edit left there
 * that readSheet dropped goes with it — and stamped with when it changed.
 */
function stamped(comp: Comp | undefined, sheet: Sheet): Comp {
  const now = Date.now();
  return { ...comp, ...sheet, createdAt: comp?.createdAt ?? now, updatedAt: now };
}

/** Ids are short and sequential rather than random: they ride along in every board save. */
function nextId(prefix: string, taken: string[]): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.includes(id)) return id;
  }
}

/**
 * A textarea that grows with what is typed into it. The hidden copy of the text under it is what
 * sizes the grid cell both share — `field-sizing` would do this alone, but not on the old iPad this
 * board is also read on.
 */
function Field({ field, value, placeholder, label, onChange }: {
  field?: string;
  value: string;
  placeholder?: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.field} data-value={value || placeholder}>
      <textarea
        data-field={field}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export default function Decision({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as Comp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const locale: Locale = language.startsWith("ja") ? "ja" : language.startsWith("zh") ? "zh" : "en";
  const labels = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[locale]])) as Labels;

  const sheet = useMemo(() => readSheet(comp), [comp]);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The field a button just added, which is typed into next
  const focusRef = useRef<string | null>(null);

  // A card stamps its creation time the first time it mounts, the way Note does — one added from the
  // Add menu arrives without one. The ref keeps StrictMode's double mount from stamping twice.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (stampedRef.current || comp?.createdAt) return;
    stampedRef.current = true;
    save?.({ ...comp, createdAt: Date.now() });
  }, [comp, save]);

  // The added field only exists once the save has come back round as a render
  useLayoutEffect(() => {
    if (!focusRef.current) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-field="${focusRef.current}"]`);
    if (!el) return;
    focusRef.current = null;
    el.focus();
  });

  function write(patch: Partial<Sheet>) {
    save?.(stamped(comp, { ...sheet, ...patch }));
  }

  function setRow(id: string, patch: (row: Row) => Partial<Row>) {
    write({ rows: sheet.rows.map((row) => (row.id === id ? { ...row, ...patch(row) } : row)) });
  }

  function addOption() {
    const id = nextId("o", sheet.options.map((o) => o.id));
    focusRef.current = `option:${id}`;
    write({ options: [...sheet.options, { id, name: "" }] });
  }

  function addRow() {
    const id = nextId("r", sheet.rows.map((r) => r.id));
    focusRef.current = `dimension:${id}`;
    write({ rows: [...sheet.rows, { id, dimension: "", cells: {}, conclusion: "" }] });
  }

  function remove({ kind, id }: Removal) {
    if (kind === "option") {
      write({
        options: sheet.options.filter((o) => o.id !== id),
        rows: sheet.rows.map((row) => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).filter(([key]) => key !== id)) })),
      });
    } else {
      write({ rows: sheet.rows.filter((row) => row.id !== id) });
    }
  }

  // There is no undo for a removed row or column, so one with anything typed in it asks first
  function requestRemove(target: Removal) {
    const row = sheet.rows.find((r) => r.id === target.id);
    const texts =
      target.kind === "option"
        ? [sheet.options.find((o) => o.id === target.id)?.name, ...sheet.rows.map((r) => r.cells[target.id])]
        : [row?.dimension, row?.conclusion, ...Object.values(row?.cells ?? {})];
    if (texts.some((value) => value?.trim())) setRemoval(target);
    else remove(target);
  }

  const widths = [DIMENSION_PX, ...sheet.options.map(() => OPTION_PX), CONCLUSION_PX];
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);

  return (
    <div ref={rootRef} className={styles.decision}>
      <div className={styles.bar}>
        <input
          className={styles.question}
          value={sheet.question}
          placeholder={labels.question}
          aria-label={labels.question}
          spellCheck={false}
          onChange={(event) => write({ question: event.target.value })}
        />
        <button type="button" onClick={addOption}>{labels.addOption}</button>
        <button type="button" onClick={addRow}>{labels.addDimension}</button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table} style={{ minWidth: tableWidth }}>
          <colgroup>
            {widths.map((width, index) => <col key={index} style={{ width: `${(width / tableWidth) * 100}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${styles.dimension} ${styles.label}`}>{labels.dimension}</th>
              {sheet.options.map((option, index) => (
                <th key={option.id} scope="col" className={styles.removable}>
                  <Field
                    field={`option:${option.id}`}
                    value={option.name}
                    placeholder={`${labels.option} ${index + 1}`}
                    label={`${labels.option} ${index + 1}`}
                    onChange={(name) => write({ options: sheet.options.map((o) => (o.id === option.id ? { ...o, name } : o)) })}
                  />
                  {/* One or more: the last option stays */}
                  {sheet.options.length > 1 && (
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={labels.removeOption}
                      title={labels.removeOption}
                      onClick={() => requestRemove({ kind: "option", id: option.id })}
                    >
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th scope="col" className={styles.label}>{labels.conclusion}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, index) => (
              <tr key={row.id}>
                <th scope="row" className={`${styles.dimension} ${styles.removable}`}>
                  <Field
                    field={`dimension:${row.id}`}
                    value={row.dimension}
                    placeholder={`${labels.dimension} ${index + 1}`}
                    label={`${labels.dimension} ${index + 1}`}
                    onChange={(dimension) => setRow(row.id, () => ({ dimension }))}
                  />
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={labels.removeDimension}
                    title={labels.removeDimension}
                    onClick={() => requestRemove({ kind: "row", id: row.id })}
                  >
                    ×
                  </button>
                </th>
                {sheet.options.map((option, column) => (
                  <td key={option.id}>
                    <Field
                      value={row.cells[option.id] ?? ""}
                      label={`${row.dimension || `${labels.dimension} ${index + 1}`} · ${option.name || `${labels.option} ${column + 1}`}`}
                      onChange={(value) => setRow(row.id, (current) => ({ cells: { ...current.cells, [option.id]: value } }))}
                    />
                  </td>
                ))}
                <td>
                  <Field
                    value={row.conclusion}
                    label={`${row.dimension || `${labels.dimension} ${index + 1}`} · ${labels.conclusion}`}
                    onChange={(conclusion) => setRow(row.id, () => ({ conclusion }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={styles.overall}>
        <span className={styles.label}>{labels.overall}</span>
        <Field
          value={sheet.conclusion}
          label={labels.overall}
          onChange={(conclusion) => write({ conclusion })}
        />
      </section>

      <ConfirmModal
        isOpen={!!removal}
        message={removal?.kind === "option" ? labels.confirmOption : labels.confirmDimension}
        confirmLabel={labels.remove}
        onCancel={() => setRemoval(null)}
        onConfirm={() => {
          if (removal) remove(removal);
          setRemoval(null);
        }}
      />
    </div>
  );
}
