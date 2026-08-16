import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import DatePicker from "@ui/DatePicker";
import Dropdown from "@ui/Dropdown";
import TextArea from "@ui/TextArea";
import { convert, fetchRates, readStoredRates, sameStoredRates, trimRates, type RatesData } from "./rates";
import styles from "./trip.module.css";

type Lang = "en" | "ja" | "zh";
type EntryType = "flight" | "train" | "car" | "hotel" | "event" | "expense";
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

// The order a drag is proposing for one day, which the day renders instead of its stored one
// until the drag is let go.
type EntryOrder = {
  date: string;
  id: string;
  order: string[];
};

type DragSession = EntryOrder & {
  pointerId: number;
  node: HTMLElement | null;
  container: HTMLElement;
  // Where the pointer was when the card was grabbed, and where the card sat then with no
  // transform on it — the two the card's offset is measured against for the whole drag
  grabY: number;
  restingTop: number;
  shift: number;
  pointerY: number;
  reordered: boolean;
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
  train: { en: "Train", ja: "列車", zh: "火车" },
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
  summaryNotePlaceholder: { en: "Trip overview", ja: "旅程の概要", zh: "行程概要" },
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
  dragLocation: { en: "Drag onto a map card", ja: "地図カードにドラッグ", zh: "拖到地图卡片上" },
  reorder: { en: "Drag to reorder", ja: "ドラッグして並べ替え", zh: "拖动调整顺序" },
};

const TITLE_PLACEHOLDER: Record<EntryType, Record<Lang, string>> = {
  flight: {
    en: "Airline / flight number",
    ja: "航空会社・便名",
    zh: "航空公司 / 航班号",
  },
  train: { en: "Line / train number", ja: "路線・列車名", zh: "线路 / 车次" },
  car: { en: "Rental company / car", ja: "レンタカー会社・車両", zh: "租车公司 / 车辆" },
  hotel: { en: "Hotel name", ja: "ホテル名", zh: "酒店名称" },
  event: { en: "Event name", ja: "イベント名", zh: "活动名称" },
  expense: { en: "Expense item", ja: "費用項目", zh: "费用项目" },
};

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
// Also the order the day header offers them in
const ENTRY_TYPES: EntryType[] = ["flight", "train", "car", "hotel", "event", "expense"];
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
  return ENTRY_TYPES.includes(value as EntryType);
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

function placeEntry(entries: TripEntry[], groupId: string, next: TripEntry): TripEntry[] {
  const index = entries.findIndex((entry) => (entry.groupId || entry.id) === groupId);
  if (index < 0) return [...entries, next];
  return entries.map((entry, position) => (position === index ? next : entry));
}

// Lays the day's entries out in the given order of ids. Entries the day is not showing — a
// stale check-out card from a board saved before those were dropped — keep the index they
// already had, so a reorder never shuffles something invisible.
function reorderEntries(entries: TripEntry[], order: string[]): TripEntry[] {
  const rank = new Map(order.map((id, index): [string, number] => [id, index]));
  const position = (entry: TripEntry) => rank.get(entry.id) ?? -1;
  const ordered = entries.filter((entry) => rank.has(entry.id)).sort((a, b) => position(a) - position(b));
  let taken = 0;
  return entries.map((entry) => (rank.has(entry.id) ? ordered[taken++] : entry));
}

// Looked up rather than held onto: reordering the list can hand the entry a different DOM node,
// and the offset already applied belongs to whichever node is on screen now — a fresh one starts
// from nothing.
function dragNode(session: DragSession): HTMLElement | null {
  const nodes = Array.from(session.container.children) as HTMLElement[];
  const node = nodes.find((candidate) => candidate.dataset.entry === session.id) ?? null;
  if (node !== session.node) {
    session.node = node;
    session.shift = 0;
  }
  return node;
}

// The card follows the pointer while the list reflows around it, and those two movements would
// otherwise add up twice. Taking the transform already applied back off the measurement gives
// where the card would sit without one, and the offset is measured from there every time.
// Everything is measured against the list rather than the viewport, so scrolling the day mid-drag
// carries the pointer and the cards along together instead of tearing one away from the other.
function trackDrag(session: DragSession, pointerY: number) {
  session.pointerY = pointerY;
  const node = dragNode(session);
  if (!node) return;
  const origin = session.container.getBoundingClientRect().top;
  const top = node.getBoundingClientRect().top - origin - session.shift;
  session.shift = pointerY - origin - session.grabY - (top - session.restingTop);
  node.style.transform = `translateY(${session.shift}px)`;
}

// The slot the pointer has reached: crossing a neighbour's midline hands that neighbour's slot
// over. Returns null while the card is still over its own slot.
function orderAtPointer(session: DragSession, pointerY: number): string[] | null {
  const nodes = Array.from(session.container.children) as HTMLElement[];
  const node = dragNode(session);
  const from = node ? nodes.indexOf(node) : -1;
  if (from < 0) return null;
  let to = from;
  for (let index = 0; index < nodes.length; index += 1) {
    // The dragged card is the one carrying a transform, so it is the one measurement to skip
    if (index === from) continue;
    const rect = nodes[index].getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    if (index < from && pointerY < middle) {
      to = index;
      break;
    }
    if (index > from && pointerY > middle) to = index;
  }
  if (to === from) return null;
  const order = [...session.order];
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
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

// Check-out is a morning, not a night: the last night slept is the day before stayTo.
// A same-day stay has no night at all, so it keeps its one day to stay visible and editable.
function hotelStayDates(dates: string[], stayFrom: string, stayTo: string): string[] {
  const nights = dates.filter((date) => date >= stayFrom && date < stayTo);
  return nights.length > 0 ? nights : dates.filter((date) => date === stayFrom);
}

function isCheckedOut(date: string, entry: TripEntry): boolean {
  return entry.type === "hotel" && entry.stayTo > entry.stayFrom && date >= entry.stayTo;
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

function pastedAmount(text: string): string | null {
  const cleaned = text.replace(/[,，\s]/g, "");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(cleaned)) return null;
  return cleaned;
}

function piePoint(angle: number, radius = 44): [number, number] {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians)];
}

function pieSlicePath(startAngle: number, endAngle: number): string {
  if (endAngle - startAngle >= 359.999) {
    // Two half turns between opposite points. Arcing between two all but
    // coincident points instead leaves the second arc free to pick the circle
    // sitting above the pie, which shows up as a stray crescent at the top.
    return "M50 6A44 44 0 1 1 50 94A44 44 0 1 1 50 6Z";
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
  if (type === "train") {
    // Wheels, and the ground under them, exactly where the car beside it puts its own, so the
    // two sit at the same ride height in the row of buttons
    return (
      <svg className={styles.trainIcon} viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3.7 10.6V5q0-1.3 1.3-1.3h8q1.3 0 1.3 1.3v5.6" />
        <path d="M6.7 10.6h4.6" />
        <path d="M3.7 7.4h10.6M9 3.7V7.4" />
        <circle cx="5.2" cy="10.6" r="1.5" />
        <circle cx="12.8" cy="10.6" r="1.5" />
        <path d="M1.5 13.9h15" />
      </svg>
    );
  }
  if (type === "car") {
    // The body line stops either side of each wheel and picks up again between them, so the
    // wheels sit in the silhouette rather than hanging under it
    return (
      <svg className={styles.carIcon} viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3.2 10.6H2.2q-.7 0-.7-.7V8.7q0-.6.6-.8L4.4 7.3l1.9-2.5q.5-.6 1.3-.6h3q.8 0 1.3.6l1.9 2.5 2.1.6q.6.2.6.8v1.2q0 .7-.7.7h-1" />
        <path d="M6.2 10.6h5.6" />
        <circle cx="4.7" cy="10.6" r="1.5" />
        <circle cx="13.3" cy="10.6" r="1.5" />
        {/* The ground. Its round caps reach 0.625 past each end, which is exactly how far the
            car's own stroke spills over 1.5 and 16.5 — so the two line up flush. */}
        <path d="M1.5 13.9h15" />
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

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // An iPad on iPadOS 13+ calls itself a Macintosh; the touch points give it away
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function openLocationSearch(location: string) {
  const query = location.trim();
  if (!query) return;
  const encoded = encodeURIComponent(query);
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  // A new tab keeps the phone's app handoff out of the loop — the browser just renders the page
  // itself — so on mobile the address leaves through the current tab instead.
  if (/Android/.test(navigator.userAgent)) {
    // Names the Maps app outright, and carries the web page along as its own fallback
    window.location.href = `intent://maps.google.com/maps?q=${encoded}`
      + "#Intent;scheme=https;package=com.google.android.apps.maps"
      + `;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
    return;
  }
  if (isIOS()) {
    // google.com/maps is a universal link: iOS hands it to the app when installed and renders
    // the page when not, with none of the "cannot open page" alert a comgooglemaps:// URL raises
    // when the app is missing.
    window.location.href = webUrl;
    return;
  }
  window.open(webUrl, "_blank", "noopener,noreferrer");
}

// The marker carries its address as plain text, so the Map card's search box takes it — and so
// does anything else that accepts dropped text
function startLocationDrag(event: DragEvent<HTMLElement>, location: string) {
  const address = location.trim();
  if (!address) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData("text/plain", address);
  event.dataTransfer.effectAllowed = "copy";
  // What follows the cursor is the address itself, not the marker button it came from
  const ghost = document.createElement("div");
  ghost.className = styles.dragGhost;
  ghost.textContent = address;
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 12);
  // The browser snapshots the node as the drag starts; it has no job after this frame
  window.setTimeout(() => ghost.remove(), 0);
}

function formatTimeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 2 && Number(digits.slice(0, 2)) > 23) return null;
  if (digits.length === 4 && Number(digits.slice(2)) > 59) return null;
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

// Hours 13-23 and 00 only exist on a 24-hour clock, so they pick the meridiem themselves;
// 1-12 is ambiguous and keeps whatever the dropdown already says.
function readClockInput(clock: string, current: Meridiem): { clock: string; meridiem: Meridiem } {
  const match = clock.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return { clock, meridiem: current };
  const hour = Number(match[1]);
  if (hour > 23) return { clock, meridiem: current };
  const minute = match[2] === undefined ? "" : `:${match[2].padEnd(2, "0")}`;
  if (hour >= 1 && hour <= 12) return { clock: `${hour}${minute}`, meridiem: current };
  return { clock: `${hour % 12 || 12}${minute}`, meridiem: hour >= 12 ? "PM" : "AM" };
}

function readTimeInput(value: string): { clock: string; meridiem: Meridiem } {
  const trimmed = value.trim();
  const periodMatch = trimmed.match(/\s*(AM|PM|上午|下午|午前|午後)$/i);
  const explicitPeriod = periodMatch?.[1];
  const clock = periodMatch ? trimmed.slice(0, periodMatch.index).trim() : trimmed;
  const meridiem: Meridiem = explicitPeriod === "PM" || explicitPeriod === "下午" || explicitPeriod === "午後" ? "PM" : "AM";
  if (explicitPeriod) return { clock, meridiem };
  return readClockInput(clock, meridiem);
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
  // Typed digits stay on screen as typed until the field is left, so a half-finished "14"
  // is not rewritten to "2" under the caret while the next digits are still coming.
  const [draft, setDraft] = useState<string | null>(null);
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
        value={draft ?? parsed.clock}
        placeholder="12:00"
        inputMode="numeric"
        maxLength={5}
        aria-label={ariaLabel}
        onChange={(event) => {
          const next = formatTimeInput(event.target.value);
          if (next === null) return;
          setDraft(next);
          const read = readClockInput(next, parsed.meridiem);
          commit(read.clock, read.meridiem);
        }}
        onBlur={() => setDraft(null)}
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
            draggable={Boolean(value.trim())}
            onDragStart={(event) => startLocationDrag(event, value)}
            aria-label={`${label} ${TEXT.searchLocation[lang]}`}
            title={`${TEXT.searchLocation[lang]} / ${TEXT.dragLocation[lang]}`}
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
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!/[,，\s]/.test(text)) return;
            event.preventDefault();
            const cleaned = pastedAmount(text);
            if (cleaned !== null) onChange(cleaned);
          }}
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
  // What the day renders during a drag; the session behind it stays in a ref because the
  // pointer moves far more often than the order it is proposing changes.
  const [entryDrag, setEntryDrag] = useState<EntryOrder | null>(null);
  const dragRef = useRef<DragSession | null>(null);
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
    const coveredDates = new Set(hotelStayDates(range.dates, hotel.stayFrom, hotel.stayTo));
    const nextDays: Record<string, unknown> = { ...storedDays };
    for (const date of new Set([...Object.keys(storedDays), ...coveredDates])) {
      const day = readDay(nextDays[date], currency);
      nextDays[date] = {
        ...day,
        entries: coveredDates.has(date)
          ? placeEntry(day.entries, groupId, { ...hotel, id: `${groupId}:${date}`, groupId })
          : day.entries.filter((entry) => (entry.groupId || entry.id) !== groupId),
      };
    }
    commitDays(nextDays);
  }

  function syncRoundTripFlight(flight: TripEntry, currentDate: string) {
    const groupId = flight.groupId || flight.id;
    const originDate = flight.roundTripOriginDate || currentDate;
    const syncedFlight = { ...flight, groupId, roundTrip: true, roundTripOriginDate: originDate };
    const displayDates = new Set([originDate]);
    if (range.dates.includes(flight.returnDepartureDate)) displayDates.add(flight.returnDepartureDate);
    const nextDays: Record<string, unknown> = { ...storedDays };
    for (const date of new Set([...Object.keys(storedDays), ...displayDates])) {
      const day = readDay(nextDays[date], currency);
      nextDays[date] = {
        ...day,
        entries: displayDates.has(date)
          ? placeEntry(day.entries, groupId, { ...syncedFlight, id: `${groupId}:${date}` })
          : day.entries.filter((entry) => (
            entry.type !== "flight" || (entry.groupId || entry.id) !== groupId
          )),
      };
    }
    commitDays(nextDays);
  }

  function detachRoundTripFlight(flight: TripEntry, currentDate: string) {
    const groupId = flight.groupId || flight.id;
    const originDate = flight.roundTripOriginDate || currentDate;
    const detached = {
      ...flight,
      id: groupId,
      groupId: "",
      roundTrip: false,
      roundTripOriginDate: "",
      returnDepartureDate: "",
      returnDepartureTime: "",
      returnArrivalDate: "",
      returnArrivalTime: "",
    };
    const nextDays: Record<string, unknown> = { ...storedDays };
    for (const date of new Set([...Object.keys(storedDays), originDate])) {
      const day = readDay(nextDays[date], currency);
      nextDays[date] = {
        ...day,
        entries: date === originDate
          ? placeEntry(day.entries, groupId, detached)
          : day.entries.filter((entry) => (
            entry.type !== "flight" || (entry.groupId || entry.id) !== groupId
          )),
      };
    }
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
    if (type === "flight" || type === "train" || type === "car") {
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

  // A hotel is one entry per night, each stored in its own day, so an order is a day's own
  // business: moving a hotel below the day's events leaves the other nights where they are.
  // syncHotel puts an edited hotel back at the index it already held, so the order survives.
  function commitEntryOrder(date: string, order: string[]) {
    updateDay(date, (day) => ({ ...day, entries: reorderEntries(day.entries, order) }));
  }

  function startEntryDrag(event: ReactPointerEvent<HTMLElement>, date: string, order: string[], id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const node = event.currentTarget.closest<HTMLElement>("[data-entry]");
    const container = node?.parentElement;
    if (!node || !container) return;
    // Stops the press from selecting the text of every card it is dragged across
    event.preventDefault();
    const origin = container.getBoundingClientRect().top;
    dragRef.current = {
      date,
      id,
      order,
      pointerId: event.pointerId,
      node,
      container,
      grabY: event.clientY - origin,
      restingTop: node.getBoundingClientRect().top - origin,
      shift: 0,
      pointerY: event.clientY,
      reordered: false,
    };
    setEntryDrag({ date, id, order });
  }

  // The list reflows around the dragged card as the order changes under it, so the card's own
  // offset is only right again once that reflow has landed.
  useLayoutEffect(() => {
    if (dragRef.current) trackDrag(dragRef.current, dragRef.current.pointerY);
  }, [entryDrag]);

  // A drag is followed from the window rather than by capturing the pointer on the title bar:
  // every reorder moves that bar's own DOM node, and the browser drops a capture the moment
  // that happens, which would strand the card halfway through. No dependency list, so the
  // handlers that end a drag always close over the day as it stands right now — the guard below
  // is what keeps a render that isn't dragging from touching the window at all.
  useEffect(() => {
    if (!entryDrag) return;
    const move = (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const next = orderAtPointer(session, event.clientY);
      if (next) {
        session.order = next;
        session.reordered = true;
        setEntryDrag({ date: session.date, id: session.id, order: next });
      }
      trackDrag(session, event.clientY);
    };
    const end = (keep: boolean) => (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      dragRef.current = null;
      const node = dragNode(session);
      if (node) node.style.transform = "";
      setEntryDrag(null);
      // A title bar pressed and let go without ever crossing a midline is a click, and a click
      // is not worth a save
      if (keep && session.reordered) commitEntryOrder(session.date, session.order);
    };
    const drop = end(true);
    const cancel = end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
    };
  });

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
                minHeight={52}
                rows={2}
                value={textValue(comp.summaryNote)}
                placeholder={TEXT.summaryNotePlaceholder[lang]}
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
              // Boards saved before check-out days were dropped still carry that stale card
              const shown = day.entries.filter((entry) => !isCheckedOut(date, entry));
              // A drag in progress shows the order it is proposing; nothing is saved until it ends
              const entries = entryDrag?.date === date ? reorderEntries(shown, entryDrag.order) : shown;
              const entryIds = entries.map((entry) => entry.id);
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
                    {entries.length > 0 && (
                      <div className={styles.entries}>
                        {entries.map((entry) => (
                          <div
                            key={entry.id}
                            data-entry={entry.id}
                            data-type={entry.type}
                            className={`${styles.entry} ${
                              entryDrag?.date === date && entryDrag.id === entry.id ? styles.entryDragging : ""
                            }`}
                          >
                            {/* The entry's own title bar is what drags it, the same way the board
                                card above it is dragged by its header */}
                            <div
                              className={styles.entryTop}
                              data-drag={entries.length > 1 ? "" : undefined}
                              title={entries.length > 1 ? TEXT.reorder[lang] : undefined}
                              onPointerDown={(event) => {
                                if (entries.length < 2) return;
                                startEntryDrag(event, date, entryIds, entry.id);
                              }}
                            >
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
                                // Sits in the title bar, so without this a press on it is a drag
                                onPointerDown={(event) => event.stopPropagation()}
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
                              hideLabel
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
                                    <div className={styles.fieldRow}>
                                      <InputField label={TEXT.from[lang]} lang={lang} mapSearch value={entry.fromLocation} onChange={(value) => updateEntry(date, entry.id, { fromLocation: value })} />
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
                                    </div>
                                    <div className={styles.fieldRow}>
                                      <InputField label={TEXT.to[lang]} lang={lang} mapSearch value={entry.toLocation} onChange={(value) => updateEntry(date, entry.id, { toLocation: value })} />
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
                                    </div>
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
                            {/* A train ride and a rental car are the same leg from A to B — only
                                the words over the two clocks differ */}
                            {(entry.type === "train" || entry.type === "car") && (
                              <>
                                <div className={styles.fieldRow}>
                                  <InputField label={TEXT.from[lang]} lang={lang} mapSearch value={entry.fromLocation} onChange={(value) => updateEntry(date, entry.id, { fromLocation: value })} />
                                  <DateTimeField
                                    label={TEXT[entry.type === "car" ? "pickupTime" : "departure"][lang]}
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
                                </div>
                                <div className={styles.fieldRow}>
                                  <InputField label={TEXT.to[lang]} lang={lang} mapSearch value={entry.toLocation} onChange={(value) => updateEntry(date, entry.id, { toLocation: value })} />
                                  <DateTimeField
                                    label={TEXT[entry.type === "car" ? "returnTime" : "arrival"][lang]}
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
                                <div className={styles.fieldRow}>
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
                        minHeight={52}
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
