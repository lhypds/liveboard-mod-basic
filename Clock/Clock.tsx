import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./clock.module.css";

type Lang = "en" | "ja" | "zh";

const LOCALES: Record<Lang, string> = {
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return undefined;
  }
}

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
  const comp = config.comp as { timeZone?: string; hour12?: boolean; showSeconds?: boolean } | undefined;
  const timeZone = validTimeZone(comp?.timeZone);
  const timeZoneLabel = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hour12 = comp?.hour12 === true;
  const showSeconds = comp?.showSeconds !== false;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

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

  return (
    <div className={styles.container}>
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
          <div className={styles.zone}>{timeZoneLabel}</div>
        </div>
      </div>
    </div>
  );
}
