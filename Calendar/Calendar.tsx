import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./calendar.module.css";

type Lang = "en" | "ja" | "zh";

const LOCALES: Record<Lang, string> = {
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const LABELS: Record<string, Record<Lang, string>> = {
  previous: { en: "Previous month", ja: "前の月", zh: "上个月" },
  next: { en: "Next month", ja: "次の月", zh: "下个月" },
  today: { en: "Today", ja: "今日", zh: "今天" },
};

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarDays(month: Date, weekStartsOn: number): Date[] {
  const first = monthStart(month);
  const leading = (first.getDay() - weekStartsOn + 7) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - leading + index),
  );
}

export default function Calendar({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = (i18n.language in LOCALES ? i18n.language : "en") as Lang;
  const locale = LOCALES[lang];
  const comp = config.comp as { weekStartsOn?: number } | undefined;
  const weekStartsOn = comp?.weekStartsOn === 1 ? 1 : 0;

  const [now, setNow] = useState(() => new Date());
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selected, setSelected] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const days = useMemo(() => calendarDays(month, weekStartsOn), [month, weekStartsOn]);
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date(2024, 0, 7 + ((weekStartsOn + index) % 7));
        return new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(day);
      }),
    [locale, weekStartsOn],
  );

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
  const fullDate = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(selected);

  function changeMonth(offset: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function goToday() {
    const today = new Date();
    setNow(today);
    setSelected(today);
    setMonth(monthStart(today));
  }

  function chooseDay(day: Date) {
    setSelected(day);
    if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) {
      setMonth(monthStart(day));
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.calendar}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.arrow} onClick={() => changeMonth(-1)} aria-label={LABELS.previous[lang]}>
            ‹
          </button>
          <div className={styles.month}>{monthLabel}</div>
          <button type="button" className={styles.arrow} onClick={() => changeMonth(1)} aria-label={LABELS.next[lang]}>
            ›
          </button>
        </div>

        <div className={styles.grid}>
          {weekdays.map((weekday, index) => (
            <div key={`${weekday}-${index}`} className={styles.weekday}>
              {weekday}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.getMonth() === month.getMonth() && day.getFullYear() === month.getFullYear();
            const isToday = sameDay(day, now);
            const isSelected = sameDay(day, selected);
            const label = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day);
            return (
              <button
                key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                type="button"
                className={`${styles.day} ${inMonth ? "" : styles.outside} ${isToday ? styles.today : ""} ${
                  isSelected ? styles.selected : ""
                }`}
                onClick={() => chooseDay(day)}
                aria-label={label}
                aria-pressed={isSelected}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <span className={styles.fullDate}>{fullDate}</span>
          <button type="button" className={styles.todayButton} onClick={goToday}>
            {LABELS.today[lang]}
          </button>
        </div>
      </div>
    </div>
  );
}
