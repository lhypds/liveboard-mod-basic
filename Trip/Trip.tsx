import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DatePicker from "@ui/DatePicker";
import Dropdown from "@ui/Dropdown";
import TextArea from "@ui/TextArea";
import { convert, fetchRates, readStoredRates, sameStoredRates, trimRates, type RatesData } from "./rates";
import styles from "./trip.module.css";

type Lang = "en" | "ja" | "zh";
type EntryType = "flight" | "car" | "hotel" | "event" | "expense";
type Meridiem = "AM" | "PM";

type TripEntry = {
  id: string;
  groupId: string;
  type: EntryType;
  title: string;
  cost: string;
  currency: string;
  time: string;
  location: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  roundTrip: boolean;
  roundTripOriginDate: string;
  returnDepartureDate: string;
  returnDepartureTime: string;
  returnArrivalDate: string;
  returnArrivalTime: string;
  fromLocation: string;
  toLocation: string;
  stayFrom: string;
  stayTo: string;
};

type DayPlan = {
  note: string;
  entries: TripEntry[];
};

type TripComp = {
  destination?: string;
  startDate?: string;
  endDate?: string;
  currency?: string;
  summaryNote?: string;
  rates?: unknown;
  days?: Record<string, unknown>;
};

type BillItem = {
  date: string;
  label: string;
  amount: number;
  currency: string;
  convertedAmount: number | null;
};

const LOCALES: Record<Lang, string> = {
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const TEXT: Record<string, Record<Lang, string>> = {
  startDate: { en: "Start date", ja: "開始日", zh: "开始日期" },
  endDate: { en: "End date", ja: "終了日", zh: "结束日期" },
  chooseDate: { en: "Choose date", ja: "日付を選択", zh: "选择日期" },
  previousMonth: { en: "Previous month", ja: "前の月", zh: "上个月" },
  nextMonth: { en: "Next month", ja: "次の月", zh: "下个月" },
  selectDates: {
    en: "Select a start and end date to create your trip.",
    ja: "開始日と終了日を選ぶと旅程が作成されます。",
    zh: "选择开始和结束日期以创建行程。",
  },
  invalidRange: {
    en: "The end date must be on or after the start date.",
    ja: "終了日は開始日以降にしてください。",
    zh: "结束日期必须晚于或等于开始日期。",
  },
  rangeTooLong: {
    en: "A trip can contain up to 366 days.",
    ja: "旅行期間は最大366日です。",
    zh: "一次行程最多可包含366天。",
  },
  day: { en: "Day", ja: "日目", zh: "第" },
  date: { en: "Date", ja: "日付", zh: "日期" },
  daySuffix: { en: "", ja: "", zh: "天" },
  days: { en: "days", ja: "日間", zh: "天" },
  flight: { en: "Flight", ja: "フライト", zh: "航班" },
  car: { en: "Rental car", ja: "レンタカー", zh: "租车" },
  hotel: { en: "Hotel", ja: "ホテル", zh: "酒店" },
  event: { en: "Event", ja: "イベント", zh: "活动" },
  expense: { en: "Expense", ja: "費用", zh: "费用" },
  departure: { en: "Departure time", ja: "出発時刻", zh: "出发时间" },
  roundTrip: { en: "Round trip", ja: "往復", zh: "往返" },
  returnDeparture: { en: "Return departure", ja: "帰路出発時刻", zh: "返程出发时间" },
  returnArrival: { en: "Return arrival", ja: "帰路到着時刻", zh: "返程到达时间" },
  pickupTime: { en: "Pickup time", ja: "受取時刻", zh: "取车时间" },
  arrival: { en: "Arrival time", ja: "到着時刻", zh: "到达时间" },
  returnTime: { en: "Return time", ja: "返却時刻", zh: "还车时间" },
  from: { en: "From", ja: "出発地", zh: "出发地" },
  to: { en: "To", ja: "到着地", zh: "目的地" },
  time: { en: "Time", ja: "時刻", zh: "时间" },
  meridiem: { en: "AM or PM", ja: "午前・午後", zh: "上午或下午" },
  location: { en: "Location", ja: "場所", zh: "地点" },
  stayFrom: { en: "Stay from", ja: "宿泊開始", zh: "入住日期" },
  stayTo: { en: "Stay to", ja: "宿泊終了", zh: "退房日期" },
  cost: { en: "Cost", ja: "費用", zh: "费用" },
  fee: { en: "Fee", ja: "宿泊費", zh: "住宿费" },
  remove: { en: "Remove", ja: "削除", zh: "删除" },
  destination: { en: "Destination", ja: "目的地", zh: "目的地" },
  destinationPlaceholder: {
    en: "Where are you going?",
    ja: "どこへ行きますか？",
    zh: "要去哪里？",
  },
  summaryNote: { en: "Trip summary note", ja: "旅行サマリーのノート", zh: "行程摘要备注" },
  totalCost: { en: "Total cost", ja: "合計費用", zh: "总费用" },
  costBreakdown: { en: "Cost breakdown", ja: "費用明細", zh: "费用明细" },
  showChart: { en: "Show pie chart", ja: "円グラフを表示", zh: "显示饼图" },
  closeChart: { en: "Close pie chart", ja: "円グラフを閉じる", zh: "关闭饼图" },
  item: { en: "Item", ja: "項目", zh: "项目" },
  amount: { en: "Amount", ja: "金額", zh: "金额" },
  noCosts: { en: "No costs added", ja: "費用はまだありません", zh: "尚未添加费用" },
  currency: { en: "Currency", ja: "通貨", zh: "币种" },
  fxLoading: { en: "Loading exchange rates…", ja: "為替レート取得中…", zh: "汇率加载中…" },
  fxError: { en: "Exchange rates unavailable", ja: "為替レートを取得できません", zh: "汇率获取失败" },
  fxUpdated: { en: "Exchange rates", ja: "為替レート", zh: "汇率更新" },
  retry: { en: "Retry", ja: "再試行", zh: "重试" },
  add: { en: "Add", ja: "追加", zh: "添加" },
  searchLocation: { en: "Search on Google Maps", ja: "Googleマップで検索", zh: "用谷歌地图搜索" },
};

const TITLE_PLACEHOLDER: Record<EntryType, Record<Lang, string>> = {
  flight: {
    en: "Airline / flight number",
    ja: "航空会社・便名",
    zh: "航空公司 / 航班号",
  },
  car: { en: "Rental company / car", ja: "レンタカー会社・車両", zh: "租车公司 / 车辆" },
  hotel: { en: "Hotel name", ja: "ホテル名", zh: "酒店名称" },
  event: { en: "Event name", ja: "イベント名", zh: "活动名称" },
  expense: { en: "Expense item", ja: "費用項目", zh: "费用项目" },
};

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const ENTRY_TYPES: EntryType[] = ["flight", "car", "hotel", "event", "expense"];
const CURRENCIES = [
  "JPY", "USD", "CNY", "AUD", "EUR", "GBP", "KRW", "HKD", "SGD", "CAD", "CHF", "BGN", "BRL", "CZK",
  "DKK", "HUF", "IDR", "ILS", "INR", "ISK", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK",
  "THB", "TRY", "ZAR",
];
const CURRENCY_OPTIONS = CURRENCIES.map((code) => ({ value: code, label: code }));
const MERIDIEM_LABELS: Record<Lang, Record<Meridiem, string>> = {
  en: { AM: "AM", PM: "PM" },
  ja: { AM: "午前", PM: "午後" },
  zh: { AM: "上午", PM: "下午" },
};
const PIE_COLORS = ["#f6caca", "#f7d9b8", "#f5edb8", "#cfe8cc", "#cbe8e8", "#ccdef4", "#d9d0f3", "#f1cee4"];
const EMPTY_DAYS: Record<string, unknown> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntryType(value: unknown): value is EntryType {
  return value === "flight" || value === "car" || value === "hotel" || value === "event" || value === "expense";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function emptyEntry(type: EntryType, id = entryId(), currency = "JPY"): TripEntry {
  return {
    id,
    groupId: type === "hotel" ? id : "",
    type,
    title: "",
    cost: "",
    currency,
    time: "",
    location: "",
    departureDate: "",
    departureTime: "",
    arrivalDate: "",
    arrivalTime: "",
    roundTrip: false,
    roundTripOriginDate: "",
    returnDepartureDate: "",
    returnDepartureTime: "",
    returnArrivalDate: "",
    returnArrivalTime: "",
    fromLocation: "",
    toLocation: "",
    stayFrom: "",
    stayTo: "",
  };
}

function readDay(value: unknown, fallbackCurrency = "JPY"): DayPlan {
  if (!isRecord(value)) return { note: "", entries: [] };
  const entries = Array.isArray(value.entries)
    ? value.entries.flatMap((entry): TripEntry[] => {
        if (!isRecord(entry) || typeof entry.id !== "string" || !isEntryType(entry.type)) return [];
        return [
          {
            ...emptyEntry(entry.type, entry.id, fallbackCurrency),
            groupId: textValue(entry.groupId) || (entry.type === "hotel" ? entry.id : ""),
            title: textValue(entry.title),
            cost: textValue(entry.cost ?? entry.fee),
            currency: validCurrency(entry.currency, fallbackCurrency),
            time: textValue(entry.time),
            location: textValue(entry.location),
            departureDate: textValue(entry.departureDate),
            departureTime: textValue(entry.departureTime ?? entry.time),
            arrivalDate: textValue(entry.arrivalDate),
            arrivalTime: textValue(entry.arrivalTime),
            roundTrip: entry.roundTrip === true,
            roundTripOriginDate: textValue(entry.roundTripOriginDate),
            returnDepartureDate: textValue(entry.returnDepartureDate),
            returnDepartureTime: textValue(entry.returnDepartureTime),
            returnArrivalDate: textValue(entry.returnArrivalDate),
            returnArrivalTime: textValue(entry.returnArrivalTime),
            fromLocation: textValue(entry.fromLocation ?? entry.location),
            toLocation: textValue(entry.toLocation),
            stayFrom: textValue(entry.stayFrom),
            stayTo: textValue(entry.stayTo),
          },
        ];
      })
    : [];
  return { note: textValue(value.note), entries };
}

function parseDate(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return time;
}

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function dateRange(start: string, end: string): { dates: string[]; error?: "invalid" | "tooLong" } {
  const startTime = parseDate(start);
  const endTime = parseDate(end);
  if (startTime === null || endTime === null) return { dates: [] };
  if (endTime < startTime) return { dates: [], error: "invalid" };
  const count = Math.round((endTime - startTime) / DAY_MS) + 1;
  if (count > MAX_DAYS) return { dates: [], error: "tooLong" };
  return { dates: Array.from({ length: count }, (_, index) => isoDate(startTime + index * DAY_MS)) };
}

function entryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function dayNumberLabel(number: number, lang: Lang): string {
  if (lang === "ja") return `${number}${TEXT.day[lang]}`;
  if (lang === "zh") return `${TEXT.day[lang]}${number}${TEXT.daySuffix[lang]}`;
  return `${TEXT.day[lang]} ${number}`;
}

function nightNumberLabel(number: number, lang: Lang): string {
  if (lang === "ja") return `${number}泊目`;
  if (lang === "zh") return `第${number}晚`;
  return `Night ${number}`;
}

function hotelNightNumber(date: string, stayFrom: string): number {
  const currentTime = parseDate(date);
  const checkInTime = parseDate(stayFrom);
  if (currentTime === null || checkInTime === null || currentTime < checkInTime) return 1;
  return Math.floor((currentTime - checkInTime) / DAY_MS) + 1;
}

function isReturnFlightDay(date: string, entry: TripEntry): boolean {
  return entry.type === "flight"
    && entry.roundTrip
    && date === entry.returnDepartureDate
    && date !== entry.roundTripOriginDate;
}

function dateLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const time = parseDate(value);
  if (time === null) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(time));
}

function amount(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function piePoint(angle: number, radius = 44): [number, number] {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians)];
}

function pieSlicePath(startAngle: number, endAngle: number): string {
  if (endAngle - startAngle >= 359.999) {
    return "M50 6A44 44 0 1 1 49.999 6A44 44 0 1 1 50 6Z";
  }
  const [startX, startY] = piePoint(startAngle);
  const [endX, endY] = piePoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M50 50L${startX} ${startY}A44 44 0 ${largeArc} 1 ${endX} ${endY}Z`;
}

function validCurrency(value: unknown, fallback = "JPY"): string {
  const currency = textValue(value).toUpperCase();
  return CURRENCIES.includes(currency) ? currency : fallback;
}

function EntryIcon({ type }: { type: EntryType }) {
  if (type === "flight") {
    return (
      <svg className={styles.flightIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 19h19v2h-19v-2Zm19.57-9.36a1.5 1.5 0 0 0-1.84-1.06l-5.59 1.5-7.25-6.76-1.93.52 4.35 7.53-5.23 1.4-2.07-1.62-1.45.39 2.55 4.41 16.89-4.52a1.5 1.5 0 0 0 1.06-1.86l-.49-1.93Z" />
      </svg>
    );
  }
  if (type === "car") {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M2.5 12.5v-3l2-4h9l2 4v3M3 9.5h12M5.5 5.5l-1 4M12.5 5.5l1 4" />
        <circle cx="5" cy="13.5" r="1.5" />
        <circle cx="13" cy="13.5" r="1.5" />
      </svg>
    );
  }
  if (type === "hotel") {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 16V3h12v13M1.5 16h15M6 3V1.5h6V3" />
        <path d="M6 6h1M11 6h1M6 9h1M11 9h1M7.5 16v-4h3v4" />
      </svg>
    );
  }
  if (type === "expense") {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M4 2h10v14l-2-1.5L10 16l-2-1.5L6 16l-2-1.5V2Z" />
        <path d="M7 6h4M7 9h4M7 12h2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2.5" y="3.5" width="13" height="12" />
      <path d="M5.5 1.5v4M12.5 1.5v4M2.5 7h13M5.5 10h1M8.5 10h1M11.5 10h1M5.5 13h1M8.5 13h1" />
    </svg>
  );
}

function MarkerIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 16.5c3.4-3.9 5.2-6.7 5.2-8.7a5.2 5.2 0 1 0-10.4 0c0 2 1.8 4.8 5.2 8.7Z" />
      <circle cx="9" cy="7.6" r="1.9" />
    </svg>
  );
}

function openLocationSearch(location: string) {
  const query = location.trim();
  if (!query) return;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatTimeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 2 && (Number(digits.slice(0, 2)) < 1 || Number(digits.slice(0, 2)) > 12)) return null;
  if (digits.length === 4 && Number(digits.slice(2)) > 59) return null;
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function readTimeInput(value: string): { clock: string; meridiem: Meridiem } {
  const trimmed = value.trim();
  const periodMatch = trimmed.match(/\s*(AM|PM|上午|下午|午前|午後)$/i);
  const explicitPeriod = periodMatch?.[1];
  const clock = periodMatch ? trimmed.slice(0, periodMatch.index).trim() : trimmed;
  const meridiem: Meridiem = explicitPeriod === "PM" || explicitPeriod === "下午" || explicitPeriod === "午後" ? "PM" : "AM";
  const match = clock.match(/^(\d{1,2})(?::(\d{1,2}))?$/);

  if (explicitPeriod || !match) return { clock, meridiem };

  const hour = Number(match[1]);
  if (hour > 23) return { clock, meridiem };
  const minute = match[2] === undefined ? "" : `:${match[2]}`;
  return {
    clock: `${hour % 12 || 12}${minute}`,
    meridiem: hour >= 12 ? "PM" : "AM",
  };
}

function TimeInput({
  value,
  onChange,
  ariaLabel,
  lang,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  lang: Lang;
}) {
  const parsed = readTimeInput(value);
  const options = (Object.keys(MERIDIEM_LABELS[lang]) as Meridiem[]).map((period) => ({
    value: period,
    label: MERIDIEM_LABELS[lang][period],
  }));

  function commit(clock: string, meridiem: Meridiem) {
    onChange(clock ? `${clock} ${meridiem}` : "");
  }

  return (
    <div className={styles.timeControl}>
      <input
        type="text"
        className={styles.timeInput}
        value={parsed.clock}
        placeholder="12:00"
        inputMode="numeric"
        maxLength={5}
        aria-label={ariaLabel}
        onChange={(event) => {
          const next = formatTimeInput(event.target.value);
          if (next !== null) commit(next, parsed.meridiem);
        }}
      />
      <div className={styles.timeMeridiem}>
        <Dropdown
          value={parsed.meridiem}
          options={options}
          ariaLabel={`${ariaLabel} ${TEXT.meridiem[lang]}`}
          onChange={(next) => commit(parsed.clock, next)}
        />
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hideLabel = false,
  lang = "en",
  mapSearch = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "time" | "number";
  placeholder?: string;
  hideLabel?: boolean;
  lang?: Lang;
  mapSearch?: boolean;
}) {
  const field = (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={hideLabel ? label : undefined}
      min={type === "number" ? "0" : undefined}
      step={type === "number" ? "0.01" : undefined}
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  return (
    <label className={styles.inputField}>
      {!hideLabel && <span>{label}</span>}
      {type === "time" ? (
        <TimeInput value={value} ariaLabel={label} lang={lang} onChange={onChange} />
      ) : mapSearch ? (
        <div className={styles.locationControl}>
          {field}
          <button
            type="button"
            className={styles.mapButton}
            disabled={!value.trim()}
            aria-label={`${label} ${TEXT.searchLocation[lang]}`}
            title={TEXT.searchLocation[lang]}
            onClick={() => openLocationSearch(value)}
          >
            <MarkerIcon />
          </button>
        </div>
      ) : (
        field
      )}
    </label>
  );
}

function DateTimeField({
  label,
  date,
  time,
  locale,
  datePickerLabels,
  min,
  max,
  lang,
  onDateChange,
  onTimeChange,
}: {
  label: string;
  date: string;
  time: string;
  locale: string;
  datePickerLabels: { placeholder: string; previousMonth: string; nextMonth: string };
  min?: string;
  max?: string;
  lang: Lang;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <div className={styles.inputField}>
      <span>{label}</span>
      <div className={styles.dateTimeControls}>
        <DatePicker
          value={date}
          ariaLabel={`${label} ${datePickerLabels.placeholder}`}
          locale={locale}
          labels={datePickerLabels}
          min={min}
          max={max}
          variant="subtle"
          onChange={onDateChange}
        />
        <TimeInput value={time} ariaLabel={label} lang={lang} onChange={onTimeChange} />
      </div>
    </div>
  );
}

function CostField({
  label,
  value,
  onChange,
  currency,
  currencyLabel,
  onCurrencyChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  currencyLabel: string;
  onCurrencyChange: (value: string) => void;
}) {
  return (
    <div className={styles.inputField}>
      <span>{label}</span>
      <div className={styles.costControl}>
        <input
          type="number"
          value={value}
          min="0"
          step="0.01"
          inputMode="decimal"
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className={styles.costCurrency}>
          <Dropdown
            value={currency}
            options={CURRENCY_OPTIONS}
            ariaLabel={currencyLabel}
            onChange={onCurrencyChange}
          />
        </div>
      </div>
    </div>
  );
}

export default function Trip({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = (i18n.language in LOCALES ? i18n.language : "en") as Lang;
  const locale = LOCALES[lang];
  const comp = (isRecord(config.comp) ? config.comp : {}) as TripComp;
  const save = config._save as ((next: Record<string, unknown>) => void) | undefined;
  const startDate = textValue(comp.startDate);
  const endDate = textValue(comp.endDate);
  const currency = validCurrency(comp.currency);
  const storedDays = isRecord(comp.days) ? comp.days : EMPTY_DAYS;
  const range = useMemo(() => dateRange(startDate, endDate), [startDate, endDate]);
  const neededCurrencies = useMemo(() => {
    const codes = new Set([currency]);
    for (const value of Object.values(storedDays)) {
      for (const entry of readDay(value, currency).entries) codes.add(entry.currency);
    }
    return Array.from(codes).sort();
  }, [currency, storedDays]);
  const currencyKey = neededCurrencies.join(",");
  const restoredRates = readStoredRates(comp.rates, neededCurrencies);
  const [rates, setRates] = useState<RatesData | null>(restoredRates);
  const [endPickerOpen, setEndPickerOpen] = useState(false);
  const [hotelCheckoutPicker, setHotelCheckoutPicker] = useState<{ groupId: string; checkIn: string } | null>(null);
  const [showCostChart, setShowCostChart] = useState(false);
  const costChartRef = useRef<HTMLDivElement>(null);
  const needsConversion = neededCurrencies.some((code) => code !== currency);
  const haveNeededRates = neededCurrencies.every((code) => typeof rates?.rates[code] === "number");
  const [ratesError, setRatesError] = useState<string | null>(null);
  const ratesLoading = needsConversion && !haveNeededRates && !ratesError;

  useEffect(() => {
    if (!showCostChart) return;
    function closeOnOutside(event: PointerEvent) {
      if (costChartRef.current && !costChartRef.current.contains(event.target as Node)) setShowCostChart(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setShowCostChart(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showCostChart]);

  function loadRates() {
    setRatesError(null);
    fetchRates()
      .then((data) => {
        setRates(data);
        setRatesError(null);
      })
      .catch((error) => setRatesError(error instanceof Error ? error.message : String(error)));
  }

  useEffect(() => {
    if (!needsConversion || haveNeededRates) return;
    let alive = true;
    fetchRates()
      .then((data) => {
        if (alive) {
          setRates(data);
          setRatesError(null);
        }
      })
      .catch((error) => {
        if (alive) setRatesError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [currencyKey, haveNeededRates, needsConversion]);

  useEffect(() => {
    if (!rates) return;
    const nextRates = trimRates(rates, neededCurrencies);
    if (!sameStoredRates(comp.rates, nextRates)) save?.({ ...comp, rates: nextRates });
    // `comp` is intentionally omitted: this effect is the only writer of comp.rates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyKey, rates]);

  function commit(next: TripComp) {
    save?.({ ...comp, ...next });
  }

  function commitDays(days: Record<string, unknown>) {
    commit({ days });
  }

  function changeSummaryCurrency(nextCurrency: string) {
    const next = validCurrency(nextCurrency, currency);
    const migratedDays = Object.fromEntries(
      Object.entries(storedDays).map(([date, value]) => {
        const day = readDay(value, currency);
        return [
          date,
          {
            ...day,
            entries: day.entries.map((entry) => (
              entry.cost.trim() === "" ? { ...entry, currency: next } : entry
            )),
          },
        ];
      }),
    );
    commit({ currency: next, days: migratedDays });
  }

  function updateDay(date: string, update: (current: DayPlan) => DayPlan) {
    commitDays({ ...storedDays, [date]: update(readDay(storedDays[date], currency)) });
  }

  function syncHotel(hotel: TripEntry) {
    const groupId = hotel.groupId || hotel.id;
    const nextDays: Record<string, unknown> = Object.fromEntries(
      Object.entries(storedDays).map(([date, value]) => {
        const day = readDay(value, currency);
        return [date, { ...day, entries: day.entries.filter((entry) => entry.groupId !== groupId) }];
      }),
    );
    const coveredDates = range.dates.filter((date) => date >= hotel.stayFrom && date <= hotel.stayTo);
    for (const date of coveredDates) {
      const day = readDay(nextDays[date], currency);
      nextDays[date] = { ...day, entries: [...day.entries, { ...hotel, id: `${groupId}:${date}`, groupId }] };
    }
    commitDays(nextDays);
  }

  function syncRoundTripFlight(flight: TripEntry, currentDate: string) {
    const groupId = flight.groupId || flight.id;
    const originDate = flight.roundTripOriginDate || currentDate;
    const syncedFlight = { ...flight, groupId, roundTrip: true, roundTripOriginDate: originDate };
    const nextDays: Record<string, unknown> = Object.fromEntries(
      Object.entries(storedDays).map(([date, value]) => {
        const day = readDay(value, currency);
        return [date, {
          ...day,
          entries: day.entries.filter((entry) => (
            entry.type !== "flight" || (entry.groupId || entry.id) !== groupId
          )),
        }];
      }),
    );
    const displayDates = new Set([originDate]);
    if (range.dates.includes(flight.returnDepartureDate)) displayDates.add(flight.returnDepartureDate);
    for (const displayDate of displayDates) {
      const day = readDay(nextDays[displayDate], currency);
      nextDays[displayDate] = {
        ...day,
        entries: [...day.entries, { ...syncedFlight, id: `${groupId}:${displayDate}` }],
      };
    }
    commitDays(nextDays);
  }

  function detachRoundTripFlight(flight: TripEntry, currentDate: string) {
    const groupId = flight.groupId || flight.id;
    const originDate = flight.roundTripOriginDate || currentDate;
    const nextDays: Record<string, unknown> = Object.fromEntries(
      Object.entries(storedDays).map(([date, value]) => {
        const day = readDay(value, currency);
        return [date, {
          ...day,
          entries: day.entries.filter((entry) => (
            entry.type !== "flight" || (entry.groupId || entry.id) !== groupId
          )),
        }];
      }),
    );
    const day = readDay(nextDays[originDate], currency);
    nextDays[originDate] = {
      ...day,
      entries: [...day.entries, {
        ...flight,
        id: groupId,
        groupId: "",
        roundTrip: false,
        roundTripOriginDate: "",
        returnDepartureDate: "",
        returnDepartureTime: "",
        returnArrivalDate: "",
        returnArrivalTime: "",
      }],
    };
    commitDays(nextDays);
  }

  function addEntry(date: string, type: EntryType) {
    const entry = emptyEntry(type, entryId(), currency);
    if (type === "hotel") {
      const index = range.dates.indexOf(date);
      const checkOutDate = range.dates[Math.min(index + 1, range.dates.length - 1)] ?? date;
      syncHotel({ ...entry, stayFrom: date, stayTo: checkOutDate });
      return;
    }
    if (type === "flight" || type === "car") {
      entry.departureDate = date;
      entry.arrivalDate = date;
    }
    updateDay(date, (day) => ({ ...day, entries: [...day.entries, entry] }));
  }

  function updateEntry(date: string, id: string, patch: Partial<TripEntry>) {
    const entry = readDay(storedDays[date], currency).entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    if (entry.type === "hotel") {
      const next = { ...entry, ...patch };
      if ("stayFrom" in patch && next.stayFrom > next.stayTo) next.stayTo = next.stayFrom;
      if ("stayTo" in patch && next.stayTo < next.stayFrom) next.stayFrom = next.stayTo;
      syncHotel(next);
      return;
    }
    if (entry.type === "flight" && (entry.roundTrip || patch.roundTrip !== undefined)) {
      const next = { ...entry, ...patch };
      if (patch.roundTrip === true && !entry.roundTrip) next.roundTripOriginDate = date;
      if (
        "returnDepartureDate" in patch
        && (!next.returnArrivalDate || next.returnDepartureDate > next.returnArrivalDate)
      ) {
        next.returnArrivalDate = next.returnDepartureDate;
      }
      if (next.roundTrip) syncRoundTripFlight(next, date);
      else detachRoundTripFlight(next, date);
      return;
    }
    updateDay(date, (day) => ({
      ...day,
      entries: day.entries.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)),
    }));
  }

  function removeEntry(date: string, entry: TripEntry) {
    if (entry.type === "hotel" || (entry.type === "flight" && entry.roundTrip)) {
      const groupId = entry.groupId || entry.id;
      commitDays(
        Object.fromEntries(
          Object.entries(storedDays).map(([dayDate, value]) => {
            const day = readDay(value, currency);
            return [dayDate, {
              ...day,
              entries: day.entries.filter((candidate) => (
                candidate.type !== entry.type || (candidate.groupId || candidate.id) !== groupId
              )),
            }];
          }),
        ),
      );
      return;
    }
    updateDay(date, (day) => ({ ...day, entries: day.entries.filter((candidate) => candidate.id !== entry.id) }));
  }

  function isContinuedHotel(date: string, entry: TripEntry) {
    if (entry.type !== "hotel") return false;
    const dayIndex = range.dates.indexOf(date);
    if (dayIndex <= 0) return false;
    const previousDate = range.dates[dayIndex - 1];
    const groupId = entry.groupId || entry.id;
    return readDay(storedDays[previousDate], currency).entries.some(
      (candidate) => candidate.type === "hotel" && (candidate.groupId || candidate.id) === groupId,
    );
  }

  const bill = useMemo<BillItem[]>(() => {
    const items: BillItem[] = [];
    const billedGroups = new Set<string>();
    for (const date of range.dates) {
      for (const entry of readDay(storedDays[date], currency).entries) {
        const entryAmount = amount(entry.cost);
        if (!entryAmount) continue;
        if (entry.type === "hotel" || (entry.type === "flight" && entry.roundTrip)) {
          const groupId = entry.groupId || entry.id;
          if (billedGroups.has(groupId)) continue;
          billedGroups.add(groupId);
        }
        const route = [entry.fromLocation, entry.toLocation].filter(Boolean).join(" → ");
        items.push({
          date,
          label: entry.title.trim() || route || TEXT[entry.type][lang],
          amount: entryAmount,
          currency: entry.currency,
          convertedAmount: convert(entryAmount, entry.currency, currency, rates?.rates ?? {}),
        });
      }
    }
    return items;
  }, [currency, lang, range.dates, rates, storedDays]);
  const hasUnconvertedCosts = bill.some((item) => item.convertedAmount === null);
  const totalCost = hasUnconvertedCosts
    ? null
    : bill.reduce((sum, item) => sum + (item.convertedAmount ?? 0), 0);
  const pieSlices = useMemo(() => {
    if (totalCost === null || totalCost <= 0) return [];
    let angle = 0;
    return bill.flatMap((item, index) => {
      const value = item.convertedAmount ?? 0;
      if (value <= 0) return [];
      const startAngle = angle;
      angle += (value / totalCost) * 360;
      return [{
        ...item,
        value,
        share: value / totalCost,
        color: PIE_COLORS[index % PIE_COLORS.length],
        path: pieSlicePath(startAngle, angle),
      }];
    });
  }, [bill, totalCost]);
  const money = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2 }),
    [currency, locale],
  );
  const percentage = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    [locale],
  );

  function formatMoney(value: number, code: string) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "JPY" || code === "KRW" || code === "ISK" ? 0 : 2,
    }).format(value);
  }

  const datePickerLabels = {
    placeholder: TEXT.chooseDate[lang],
    previousMonth: TEXT.previousMonth[lang],
    nextMonth: TEXT.nextMonth[lang],
  };

  const message = range.error
    ? TEXT[range.error === "invalid" ? "invalidRange" : "rangeTooLong"][lang]
    : !range.dates.length
      ? TEXT.selectDates[lang]
      : null;

  return (
    <div className={styles.container}>
      <section className={styles.dateSection}>
        <div className={styles.destinationBar}>
          <span>{TEXT.destination[lang]}</span>
          <input
            type="text"
            value={textValue(comp.destination)}
            placeholder={TEXT.destinationPlaceholder[lang]}
            aria-label={TEXT.destination[lang]}
            onChange={(event) => commit({ destination: event.target.value })}
          />
        </div>
        <div className={styles.rangeBar}>
          <div className={styles.dateField}>
            <span>{TEXT.startDate[lang]}</span>
            <DatePicker
              value={startDate}
              ariaLabel={TEXT.startDate[lang]}
              locale={locale}
              labels={datePickerLabels}
              onChange={(nextStart) => {
                commit({
                  startDate: nextStart,
                  ...(endDate && nextStart > endDate ? { endDate: nextStart } : {}),
                });
                setEndPickerOpen(true);
              }}
            />
          </div>
          <span className={styles.rangeArrow} aria-hidden="true">→</span>
          <div className={styles.dateField}>
            <span>{TEXT.endDate[lang]}</span>
            <DatePicker
              value={endDate}
              ariaLabel={TEXT.endDate[lang]}
              locale={locale}
              labels={datePickerLabels}
              min={startDate || undefined}
              align="end"
              openAt={startDate}
              open={endPickerOpen}
              onOpenChange={setEndPickerOpen}
              onChange={(nextEnd) => commit({ endDate: nextEnd })}
            />
          </div>
          {range.dates.length > 0 && (
            <span className={styles.rangeDays}>{range.dates.length} {TEXT.days[lang]}</span>
          )}
        </div>
        {range.dates.length > 0 && (
          <div className={styles.tripSummary}>
            <div className={styles.summaryBody}>
              <div className={styles.currencyField}>
                <span>{TEXT.currency[lang]}</span>
                <div className={styles.summaryCurrencyDropdown}>
                  <Dropdown
                    value={currency}
                    options={CURRENCY_OPTIONS}
                    ariaLabel={TEXT.currency[lang]}
                    onChange={changeSummaryCurrency}
                  />
                </div>
              </div>
              <span className={styles.summaryTotal}>
                <small>{TEXT.totalCost[lang]}</small>
                {totalCost === null ? "—" : money.format(totalCost)}
              </span>
            </div>
            {needsConversion && (
              <div className={`${styles.fxStatus} ${ratesError ? styles.fxError : ""}`} role="status">
                <span>
                  {ratesLoading
                    ? TEXT.fxLoading[lang]
                    : ratesError
                      ? TEXT.fxError[lang]
                      : `${TEXT.fxUpdated[lang]} ${rates?.date ?? ""}`}
                </span>
                {ratesError && (
                  <button type="button" onClick={loadRates} disabled={ratesLoading}>{TEXT.retry[lang]}</button>
                )}
              </div>
            )}
            <div className={styles.summaryNoteWrap}>
              <TextArea
                className={styles.noteArea}
                minHeight={45}
                rows={2}
                value={textValue(comp.summaryNote)}
                aria-label={TEXT.summaryNote[lang]}
                onChange={(event) => commit({ summaryNote: event.target.value })}
              />
            </div>
          </div>
        )}
      </section>

      {message ? (
        <div className={`${styles.empty} ${range.error ? styles.error : ""}`} role="status">{message}</div>
      ) : (
        <>
          <div className={styles.days}>
            {range.dates.map((date, dayIndex) => {
              const day = readDay(storedDays[date], currency);
              const calendarDate = dateLabel(date, locale, { year: "numeric", month: "short", day: "numeric" });
              const weekday = dateLabel(date, locale, { weekday: "short" });
              const fullDate = `${calendarDate}\u2009${weekday}`;
              return (
                <section key={date} className={styles.dayCard}>
                  <header className={styles.dayHeader}>
                    <time dateTime={date}>{fullDate}</time>
                    <span className={styles.dayNumber}>{dayNumberLabel(dayIndex + 1, lang)}</span>
                    <div className={styles.dayActions}>
                      {ENTRY_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={styles.addButton}
                          onClick={() => addEntry(date, type)}
                          aria-label={`${TEXT.add[lang]} ${TEXT[type][lang]}`}
                          title={`${TEXT.add[lang]} ${TEXT[type][lang]}`}
                        >
                          <EntryIcon type={type} />
                        </button>
                      ))}
                    </div>
                  </header>
                  <div className={styles.dayBody}>
                    {day.entries.length > 0 && (
                      <div className={styles.entries}>
                        {day.entries.map((entry) => (
                          <div key={entry.id} className={styles.entry} data-type={entry.type}>
                            <div className={styles.entryTop}>
                              <span className={styles.entryType}>
                                {TEXT[entry.type][lang]}
                                {entry.type === "hotel" && (
                                  <span className={styles.hotelNight}> {nightNumberLabel(hotelNightNumber(date, entry.stayFrom), lang)}</span>
                                )}
                              </span>
                              <button
                                type="button"
                                className={styles.removeButton}
                                onClick={() => removeEntry(date, entry)}
                                aria-label={`${TEXT.remove[lang]} ${TEXT[entry.type][lang]}`}
                                title={TEXT.remove[lang]}
                              >
                                ×
                              </button>
                            </div>
                            <InputField
                              label={TEXT[entry.type][lang]}
                              value={entry.title}
                              placeholder={TITLE_PLACEHOLDER[entry.type][lang]}
                              hideLabel={entry.type !== "event"}
                              onChange={(value) => updateEntry(date, entry.id, { title: value })}
                            />
                            {entry.type === "flight" && !isReturnFlightDay(date, entry) && (
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={entry.roundTrip}
                                className={styles.roundTripToggle}
                                onClick={() => updateEntry(date, entry.id, { roundTrip: !entry.roundTrip })}
                              >
                                <span className={styles.roundTripCheckbox} aria-hidden="true">
                                  {entry.roundTrip ? "✓" : ""}
                                </span>
                                <span>{TEXT.roundTrip[lang]}</span>
                              </button>
                            )}
                            {entry.type === "flight" && (
                              <>
                                {!isReturnFlightDay(date, entry) && (
                                  <>
                                    <DateTimeField
                                      label={TEXT.departure[lang]}
                                      date={entry.departureDate}
                                      time={entry.departureTime}
                                      locale={locale}
                                      lang={lang}
                                      datePickerLabels={datePickerLabels}
                                      min={startDate}
                                      max={endDate}
                                      onDateChange={(value) => updateEntry(date, entry.id, {
                                        departureDate: value,
                                        ...(entry.arrivalDate && value > entry.arrivalDate ? { arrivalDate: value } : {}),
                                      })}
                                      onTimeChange={(value) => updateEntry(date, entry.id, { departureTime: value })}
                                    />
                                    <InputField label={TEXT.from[lang]} lang={lang} mapSearch value={entry.fromLocation} onChange={(value) => updateEntry(date, entry.id, { fromLocation: value })} />
                                    <DateTimeField
                                      label={TEXT.arrival[lang]}
                                      date={entry.arrivalDate}
                                      time={entry.arrivalTime}
                                      locale={locale}
                                      lang={lang}
                                      datePickerLabels={datePickerLabels}
                                      min={entry.departureDate || startDate}
                                      max={endDate}
                                      onDateChange={(value) => updateEntry(date, entry.id, { arrivalDate: value })}
                                      onTimeChange={(value) => updateEntry(date, entry.id, { arrivalTime: value })}
                                    />
                                    <InputField label={TEXT.to[lang]} lang={lang} mapSearch value={entry.toLocation} onChange={(value) => updateEntry(date, entry.id, { toLocation: value })} />
                                  </>
                                )}
                                {entry.roundTrip && (
                                  <>
                                    <DateTimeField
                                      label={TEXT.returnDeparture[lang]}
                                      date={entry.returnDepartureDate}
                                      time={entry.returnDepartureTime}
                                      locale={locale}
                                      lang={lang}
                                      datePickerLabels={datePickerLabels}
                                      min={entry.arrivalDate || entry.departureDate || startDate}
                                      max={endDate}
                                      onDateChange={(value) => updateEntry(date, entry.id, { returnDepartureDate: value })}
                                      onTimeChange={(value) => updateEntry(date, entry.id, { returnDepartureTime: value })}
                                    />
                                    <DateTimeField
                                      label={TEXT.returnArrival[lang]}
                                      date={entry.returnArrivalDate}
                                      time={entry.returnArrivalTime}
                                      locale={locale}
                                      lang={lang}
                                      datePickerLabels={datePickerLabels}
                                      min={entry.returnDepartureDate || entry.arrivalDate || entry.departureDate || startDate}
                                      max={endDate}
                                      onDateChange={(value) => updateEntry(date, entry.id, { returnArrivalDate: value })}
                                      onTimeChange={(value) => updateEntry(date, entry.id, { returnArrivalTime: value })}
                                    />
                                  </>
                                )}
                                {!isReturnFlightDay(date, entry) && (
                                  <CostField
                                    label={TEXT.cost[lang]}
                                    value={entry.cost}
                                    currency={entry.currency}
                                    currencyLabel={TEXT.currency[lang]}
                                    onChange={(value) => updateEntry(date, entry.id, { cost: value })}
                                    onCurrencyChange={(value) => updateEntry(date, entry.id, { currency: value })}
                                  />
                                )}
                              </>
                            )}
                            {entry.type === "car" && (
                              <>
                                <DateTimeField
                                  label={TEXT.pickupTime[lang]}
                                  date={entry.departureDate}
                                  time={entry.departureTime}
                                  locale={locale}
                                  lang={lang}
                                  datePickerLabels={datePickerLabels}
                                  min={startDate}
                                  max={endDate}
                                  onDateChange={(value) => updateEntry(date, entry.id, {
                                    departureDate: value,
                                    ...(entry.arrivalDate && value > entry.arrivalDate ? { arrivalDate: value } : {}),
                                  })}
                                  onTimeChange={(value) => updateEntry(date, entry.id, { departureTime: value })}
                                />
                                <InputField label={TEXT.from[lang]} lang={lang} mapSearch value={entry.fromLocation} onChange={(value) => updateEntry(date, entry.id, { fromLocation: value })} />
                                <DateTimeField
                                  label={TEXT.returnTime[lang]}
                                  date={entry.arrivalDate}
                                  time={entry.arrivalTime}
                                  locale={locale}
                                  lang={lang}
                                  datePickerLabels={datePickerLabels}
                                  min={entry.departureDate || startDate}
                                  max={endDate}
                                  onDateChange={(value) => updateEntry(date, entry.id, { arrivalDate: value })}
                                  onTimeChange={(value) => updateEntry(date, entry.id, { arrivalTime: value })}
                                />
                                <InputField label={TEXT.to[lang]} lang={lang} mapSearch value={entry.toLocation} onChange={(value) => updateEntry(date, entry.id, { toLocation: value })} />
                                <CostField
                                  label={TEXT.cost[lang]}
                                  value={entry.cost}
                                  currency={entry.currency}
                                  currencyLabel={TEXT.currency[lang]}
                                  onChange={(value) => updateEntry(date, entry.id, { cost: value })}
                                  onCurrencyChange={(value) => updateEntry(date, entry.id, { currency: value })}
                                />
                              </>
                            )}
                            {entry.type === "hotel" && !isContinuedHotel(date, entry) && (
                              <>
                                <InputField label={TEXT.location[lang]} lang={lang} mapSearch value={entry.location} onChange={(value) => updateEntry(date, entry.id, { location: value })} />
                                <div className={styles.stayGrid}>
                                  <div className={styles.stayField}>
                                    <span>{TEXT.stayFrom[lang]}</span>
                                    <DatePicker
                                      value={entry.stayFrom}
                                      ariaLabel={TEXT.stayFrom[lang]}
                                      locale={locale}
                                      labels={datePickerLabels}
                                      min={startDate}
                                      max={endDate}
                                      variant="subtle"
                                      onChange={(value) => {
                                        updateEntry(date, entry.id, { stayFrom: value });
                                        setHotelCheckoutPicker({ groupId: entry.groupId || entry.id, checkIn: value });
                                      }}
                                    />
                                  </div>
                                  <div className={styles.stayField}>
                                    <span>{TEXT.stayTo[lang]}</span>
                                    <DatePicker
                                      value={entry.stayTo}
                                      ariaLabel={TEXT.stayTo[lang]}
                                      locale={locale}
                                      labels={datePickerLabels}
                                      min={entry.stayFrom || startDate}
                                      max={endDate}
                                      align="end"
                                      variant="subtle"
                                      openAt={hotelCheckoutPicker?.groupId === (entry.groupId || entry.id)
                                        ? hotelCheckoutPicker.checkIn
                                        : entry.stayFrom}
                                      open={hotelCheckoutPicker?.groupId === (entry.groupId || entry.id)}
                                      onOpenChange={(open) => setHotelCheckoutPicker(open
                                        ? { groupId: entry.groupId || entry.id, checkIn: entry.stayFrom }
                                        : null)}
                                      onChange={(value) => updateEntry(date, entry.id, { stayTo: value })}
                                    />
                                  </div>
                                </div>
                                <CostField
                                  label={TEXT.fee[lang]}
                                  value={entry.cost}
                                  currency={entry.currency}
                                  currencyLabel={TEXT.currency[lang]}
                                  onChange={(value) => updateEntry(date, entry.id, { cost: value })}
                                  onCurrencyChange={(value) => updateEntry(date, entry.id, { currency: value })}
                                />
                              </>
                            )}
                            {entry.type === "event" && (
                              <>
                                <div className={styles.fieldGrid}>
                                  <InputField label={TEXT.time[lang]} type="time" lang={lang} value={entry.time} onChange={(value) => updateEntry(date, entry.id, { time: value })} />
                                  <InputField label={TEXT.location[lang]} lang={lang} mapSearch value={entry.location} onChange={(value) => updateEntry(date, entry.id, { location: value })} />
                                </div>
                                <CostField
                                  label={TEXT.cost[lang]}
                                  value={entry.cost}
                                  currency={entry.currency}
                                  currencyLabel={TEXT.currency[lang]}
                                  onChange={(value) => updateEntry(date, entry.id, { cost: value })}
                                  onCurrencyChange={(value) => updateEntry(date, entry.id, { currency: value })}
                                />
                              </>
                            )}
                            {entry.type === "expense" && (
                              <CostField
                                label={TEXT.cost[lang]}
                                value={entry.cost}
                                currency={entry.currency}
                                currencyLabel={TEXT.currency[lang]}
                                onChange={(value) => updateEntry(date, entry.id, { cost: value })}
                                onCurrencyChange={(value) => updateEntry(date, entry.id, { currency: value })}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.noteWrap}>
                      <TextArea
                        className={styles.noteArea}
                        minHeight={45}
                        rows={2}
                        value={day.note}
                        aria-label={`${dayNumberLabel(dayIndex + 1, lang)} note`}
                        onChange={(event) => updateDay(date, (current) => ({ ...current, note: event.target.value }))}
                      />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <section className={styles.costSection}>
            <header>
              <span>{TEXT.costBreakdown[lang]}</span>
              <div ref={costChartRef} className={styles.costChartControl}>
                <button
                  type="button"
                  className={`${styles.costViewButton} ${showCostChart ? styles.costViewButtonActive : ""}`}
                  aria-label={TEXT[showCostChart ? "closeChart" : "showChart"][lang]}
                  aria-expanded={showCostChart}
                  title={TEXT[showCostChart ? "closeChart" : "showChart"][lang]}
                  disabled={!bill.length}
                  onClick={() => setShowCostChart((current) => !current)}
                >
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <circle cx="9" cy="9" r="6.5" />
                    <path d="M9 2.5V9h6.5A6.5 6.5 0 0 0 9 2.5Z" />
                  </svg>
                </button>
                {showCostChart && (
                  <div className={styles.costChartPopover} role="dialog" aria-label={TEXT.showChart[lang]}>
                    {pieSlices.length ? (
                      <div className={styles.costChart}>
                        <svg
                          className={styles.pieChart}
                          viewBox="0 0 100 100"
                          role="img"
                          aria-label={`${TEXT.costBreakdown[lang]} ${TEXT.showChart[lang]}`}
                        >
                          {pieSlices.map((slice, index) => (
                            <path
                              key={`${slice.date}-${slice.label}-${index}`}
                              d={slice.path}
                              fill={slice.color}
                              stroke="#000"
                              strokeWidth="0.9"
                            >
                              <title>{`${slice.label}: ${money.format(slice.value)} · ${percentage.format(slice.share)}`}</title>
                            </path>
                          ))}
                          <circle cx="50" cy="50" r="44" fill="none" stroke="#000" strokeWidth="1.2" />
                        </svg>
                        <div className={styles.pieLegend}>
                          {pieSlices.map((slice, index) => (
                            <div key={`${slice.date}-${slice.label}-legend-${index}`} className={styles.pieLegendRow}>
                              <span className={styles.pieSwatch} style={{ backgroundColor: slice.color }} aria-hidden="true" />
                              <span className={styles.pieLegendLabel}>
                                <strong title={slice.label}>{slice.label}</strong>
                                <small>
                                  {dayNumberLabel(range.dates.indexOf(slice.date) + 1, lang)} ·{" "}
                                  {dateLabel(slice.date, locale, { month: "short", day: "numeric" })}
                                </small>
                              </span>
                              <span className={styles.pieLegendAmount}>
                                <span>{money.format(slice.value)}</span>
                                <small>{percentage.format(slice.share)}</small>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.noCosts}>
                        {bill.length ? (ratesError ? TEXT.fxError[lang] : TEXT.fxLoading[lang]) : TEXT.noCosts[lang]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </header>
            <div className={styles.billHeader}>
              <span>{TEXT.date[lang]}</span>
              <span>{TEXT.item[lang]}</span>
              <span>{TEXT.amount[lang]}</span>
            </div>
            {bill.length ? bill.map((item, index) => (
              <div key={`${item.date}-${item.label}-${index}`} className={styles.billRow}>
                <span>
                  {dayNumberLabel(range.dates.indexOf(item.date) + 1, lang)} ·{" "}
                  {dateLabel(item.date, locale, { month: "short", day: "numeric" })}
                </span>
                <span>{item.label}</span>
                <span>
                  {item.currency === currency
                    ? money.format(item.amount)
                    : `${formatMoney(item.amount, item.currency)} → ${item.convertedAmount === null ? "—" : money.format(item.convertedAmount)}`}
                </span>
              </div>
            )) : <div className={styles.noCosts}>{TEXT.noCosts[lang]}</div>}
            <div className={styles.billTotal}>
              <strong>{TEXT.totalCost[lang]}</strong>
              <strong>{totalCost === null ? "—" : money.format(totalCost)}</strong>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
