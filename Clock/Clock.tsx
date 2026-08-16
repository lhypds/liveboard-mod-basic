import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { resolveTimeZone } from "./geocode";
import {
  buildZoneOptions,
  formatOffset,
  localTimeZone,
  validTimeZone,
  zoneOffsetMinutes,
  type ZoneOption,
} from "./timeZones";
import styles from "./clock.module.css";

type Lang = "en" | "ja" | "zh";

const LOCALES: Record<Lang, string> = {
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

type Strings = {
  change: string;
  search: string;
  system: string;
  empty: string;
  close: string;
  dropHint: string;
  resolving: string;
  notFound: string;
  error: string;
};

const STRINGS: Record<Lang, Strings> = {
  en: {
    change: "Change time zone",
    search: "Search time zone...",
    system: "System time zone",
    empty: "No matching time zone",
    close: "Close",
    dropHint: "Drop an address to set the time zone",
    resolving: "Finding time zone...",
    notFound: "No time zone found for that address",
    error: "Time zone lookup failed",
  },
  ja: {
    change: "タイムゾーンを変更",
    search: "タイムゾーンを検索...",
    system: "システムのタイムゾーン",
    empty: "該当するタイムゾーンがありません",
    close: "閉じる",
    dropHint: "住所をドロップしてタイムゾーンを設定",
    resolving: "タイムゾーンを検索中...",
    notFound: "その住所のタイムゾーンが見つかりません",
    error: "タイムゾーンの取得に失敗しました",
  },
  zh: {
    change: "更改时区",
    search: "搜索时区...",
    system: "系统时区",
    empty: "未找到匹配的时区",
    close: "关闭",
    dropHint: "拖入地址即可设置时区",
    resolving: "正在查找时区...",
    notFound: "未找到该地址对应的时区",
    error: "时区查询失败",
  },
};

const TEXT_DRAG_TYPES = ["text/plain", "text/uri-list"];

function carriesText(transfer: DataTransfer): boolean {
  return TEXT_DRAG_TYPES.some((type) => transfer.types.includes(type));
}

// A dragged selection arrives with whatever line breaks and padding it had on the page it came
// from; the geocoder wants one line, and a runaway paragraph is not an address anyway
function droppedAddress(transfer: DataTransfer): string {
  const raw = transfer.getData("text/plain") || transfer.getData("text/uri-list");
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

// What the card says about a drop it cannot answer with the zone caption alone: that a lookup is
// running, or that it came back with nothing. A lookup that worked says so by changing the clock.
type DropStatus = { kind: "pending" | "error"; text: string };

const STATUS_VISIBLE_MS = 5_000;

function timeParts(date: Date, timeZone: string | undefined): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: read("hour") % 24, minute: read("minute"), second: read("second") };
}

export default function Clock({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = (i18n.language in LOCALES ? i18n.language : "en") as Lang;
  const locale = LOCALES[lang];
  const strings = STRINGS[lang];
  const comp = config.comp as { timeZone?: string; hour12?: boolean; showSeconds?: boolean } | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const timeZone = validTimeZone(comp?.timeZone);
  const timeZoneLabel = timeZone ?? localTimeZone();
  const hour12 = comp?.hour12 === true;
  const showSeconds = comp?.showSeconds !== false;
  const [now, setNow] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [status, setStatus] = useState<DropStatus | null>(null);
  // A lookup takes a couple of seconds, and the picker is still usable throughout — so what it
  // writes back merges onto the newest comp rather than the one the drop started on.
  const compRef = useRef(comp);
  const saveRef = useRef(save);
  useEffect(() => {
    compRef.current = comp;
    saveRef.current = save;
  }, [comp, save]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // A drop that found nothing has to say so, but it is not a state the card stays in — the line
  // clears itself rather than sitting under the clock for the rest of the day.
  useEffect(() => {
    if (status?.kind !== "error") return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const parts = timeParts(now, timeZone);
  const hourAngle = (parts.hour % 12) * 30 + parts.minute * 0.5;
  const minuteAngle = parts.minute * 6 + parts.second * 0.1;
  const secondAngle = parts.second * 6;

  const digitalOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
    hour12,
    timeZone,
  };
  const digitalTime = new Intl.DateTimeFormat(locale, digitalOptions).format(now);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);

  function pickZone(zone: string) {
    // The empty id is the "follow the device" row; dropping the key rather than storing a name is
    // what keeps the card correct when the same board is opened somewhere else.
    save?.({ ...comp, timeZone: zone || undefined });
    setStatus(null);
    setPicking(false);
  }

  async function applyAddress(address: string) {
    setStatus({ kind: "pending", text: address });
    try {
      const found = await resolveTimeZone(address, lang);
      if (!found) {
        setStatus({ kind: "error", text: strings.notFound });
        return;
      }
      saveRef.current?.({ ...compRef.current, timeZone: found.zone });
      setStatus(null);
    } catch (error) {
      console.error("Time zone lookup failed:", error);
      setStatus({ kind: "error", text: strings.error });
    }
  }

  // Two moments when the card is already answering the same question: the picker sits over the
  // whole card, so a drop landing on it would move the zone behind a list still being read, and a
  // second drop mid-lookup would race the first one to the save.
  const canDrop = !picking && status?.kind !== "pending";

  function handleDragOver(event: DragEvent) {
    // Only claiming the drop — preventDefault here is what lets a drop event fire at all, and
    // skipping it leaves file drags to whatever the browser would normally do with them
    if (!canDrop || !carriesText(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  }

  function handleDragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropping(false);
  }

  function handleDrop(event: DragEvent) {
    if (!canDrop || !carriesText(event.dataTransfer)) return;
    event.preventDefault();
    setDropping(false);
    const address = droppedAddress(event.dataTransfer);
    if (!address) return;
    void applyAddress(address);
  }

  return (
    <div
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.clock}>
        <svg className={styles.face} viewBox="0 0 200 200" role="img" aria-label={digitalTime}>
          <circle className={styles.rim} cx="100" cy="100" r="96" />
          {Array.from({ length: 60 }, (_, index) => {
            const angle = (index * Math.PI) / 30;
            const major = index % 5 === 0;
            const inner = major ? 84 : 88;
            return (
              <line
                key={index}
                className={major ? styles.majorTick : styles.tick}
                x1={100 + Math.sin(angle) * inner}
                y1={100 - Math.cos(angle) * inner}
                x2={100 + Math.sin(angle) * 91}
                y2={100 - Math.cos(angle) * 91}
              />
            );
          })}
          {[12, 3, 6, 9].map((number) => {
            const angle = ((number % 12) * Math.PI) / 6;
            return (
              <text
                key={number}
                className={styles.numeral}
                x={100 + Math.sin(angle) * 68}
                y={100 - Math.cos(angle) * 68 + 4}
                textAnchor="middle"
              >
                {number}
              </text>
            );
          })}
          <line className={styles.hourHand} x1="100" y1="106" x2="100" y2="55" transform={`rotate(${hourAngle} 100 100)`} />
          <line className={styles.minuteHand} x1="100" y1="108" x2="100" y2="35" transform={`rotate(${minuteAngle} 100 100)`} />
          {showSeconds && (
            <line className={styles.secondHand} x1="100" y1="112" x2="100" y2="29" transform={`rotate(${secondAngle} 100 100)`} />
          )}
          <circle className={styles.pin} cx="100" cy="100" r="4" />
        </svg>

        <div className={styles.readout}>
          <div className={styles.digital}>{digitalTime}</div>
          <div className={styles.date}>{dateLabel}</div>
          <button type="button" className={styles.zone} title={strings.change} onClick={() => setPicking(true)}>
            {timeZoneLabel}
          </button>
        </div>
      </div>

      {dropping && <div className={styles.dropHint}>{strings.dropHint}</div>}

      {status && (
        <div
          className={`${styles.status} ${status.kind === "error" ? styles.statusError : ""}`}
          role="status"
          title={status.text}
        >
          {status.kind === "pending" ? `${strings.resolving} ${status.text}` : status.text}
        </div>
      )}

      {picking && (
        <ZonePicker
          selected={timeZone ?? ""}
          strings={strings}
          onPick={pickZone}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function ZonePicker({
  selected,
  strings,
  onPick,
  onClose,
}: {
  selected: string;
  strings: (typeof STRINGS)[Lang];
  onPick: (zone: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const opening = useRef(true);

  // Built once per opening: ~400 zones, each needing its own formatter, is too much to redo on
  // every keystroke, and the offsets can't drift in the seconds the picker is open.
  const options = useMemo(() => {
    const at = new Date();
    const local = localTimeZone();
    const system: ZoneOption = {
      zone: "",
      city: strings.system,
      region: local,
      offsetMinutes: zoneOffsetMinutes(local, at),
      offsetLabel: formatOffset(zoneOffsetMinutes(local, at)),
      search: `${strings.system} ${local.replace(/_/g, " ")}`.toLowerCase(),
    };
    return [system, ...buildZoneOptions(at)];
  }, [strings.system]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.search.includes(needle));
  }, [options, query]);

  // The picker opens on the zone the card is already set to rather than at the top of a 400-row list.
  const [highlight, setHighlight] = useState(() => Math.max(0, options.findIndex((o) => o.zone === selected)));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Typing narrows the list under the highlight, so it starts over at the best match.
  useEffect(() => {
    setHighlight(query.trim() ? 0 : Math.max(0, filtered.findIndex((option) => option.zone === selected)));
    // `filtered` is derived from `query`; keying on the query alone is what makes this run per edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    // The jump to the current zone lands mid-list, so the zones around it are visible too; every
    // later move is a step, and should scroll as little as it can.
    row?.scrollIntoView({ block: opening.current ? "center" : "nearest" });
    opening.current = false;
  }, [highlight, filtered]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!filtered.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((prev) => (prev + step + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[highlight];
      if (option) onPick(option.zone);
    }
  }

  return (
    <div
      className={styles.pickerOverlay}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.picker}>
        <div className={styles.pickerHeader}>
          <input
            ref={inputRef}
            className={styles.pickerSearch}
            value={query}
            placeholder={strings.search}
            aria-label={strings.change}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className={styles.pickerClose} aria-label={strings.close} onClick={onClose}>
            ✕
          </button>
        </div>
        <div ref={listRef} className={styles.pickerList} role="listbox" aria-label={strings.change}>
          {filtered.map((option, index) => (
            <button
              key={option.zone || "system"}
              type="button"
              role="option"
              aria-selected={option.zone === selected}
              className={`${styles.pickerOption} ${index === highlight ? styles.pickerOptionActive : ""} ${
                option.zone === selected ? styles.pickerOptionSelected : ""
              }`}
              // Movement, not entry: a list that appears under a resting cursor fires mouseenter on
              // its own, which would drag the highlight off the selected row the moment it opens.
              onMouseMove={() => setHighlight(index)}
              onClick={() => onPick(option.zone)}
            >
              <span className={styles.pickerCity}>{option.city}</span>
              <span className={styles.pickerRegion}>{option.region}</span>
              <span className={styles.pickerOffset}>{option.offsetLabel}</span>
            </button>
          ))}
          {!filtered.length && <div className={styles.pickerEmpty}>{strings.empty}</div>}
        </div>
      </div>
    </div>
  );
}
