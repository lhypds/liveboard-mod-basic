import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  geocodeLocation,
  searchLocations,
  primeGeocodeCache,
  LocationNotFoundError,
  fetchCurrentWeather,
  fetchMonthlyNormals,
  monthlyNormalsFromFile,
  type GeocodeResult,
  type CurrentWeather,
  type MonthlyNormals,
} from "./api";
import { describeWeatherCode, type WeatherIcon, type Lang } from "./weatherCodes";
import styles from "./weather.module.css";

const LOCALE: Record<Lang, string> = { en: "en-US", ja: "ja-JP", zh: "zh-CN" };

function formatWeekday(dateStr: string, lang: Lang): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE[lang], { weekday: "short" });
}

// "July" in English, "7月" in Japanese/Chinese — the numeric form reads better in CJK than
// zh-CN's long form ("七月"), and ja/zh render "7月" for numeric anyway.
function formatMonth(monthIndex: number, lang: Lang): string {
  return new Date(2000, monthIndex, 1).toLocaleDateString(LOCALE[lang], {
    month: lang === "en" ? "long" : "numeric",
  });
}

// How often the current conditions are re-fetched, when the config doesn't say (comp.refreshMinutes).
const DEFAULT_REFRESH_MINUTES = 15;

// Location box: how many candidates the dropdown lists, how long typing has to settle before
// asking the geocoder, and the shortest query worth asking about at all.
const SUGGESTION_COUNT = 6;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const STRINGS: Record<string, Record<Lang, string>> = {
  noLocation: { en: "No location configured.", ja: "地点が設定されていません。", zh: "尚未设置地点。" },
  loading: { en: "Loading weather…", ja: "天気を読み込み中…", zh: "正在加载天气…" },
  error: { en: "Failed to load weather.", ja: "天気の取得に失敗しました。", zh: "天气加载失败。" },
  locationLabel: { en: "Location", ja: "地点", zh: "地点" },
  locationPlaceholder: { en: "Enter a city…", ja: "都市名を入力…", zh: "输入城市…" },
  searching: { en: "Searching…", ja: "検索中…", zh: "搜索中…" },
  noMatches: { en: "No matching place", ja: "候補が見つかりません", zh: "没有匹配的地点" },
  notFound: { en: "Location not found.", ja: "地点が見つかりません。", zh: "未找到该地点。" },
  feelsLike: { en: "Feels like", ja: "体感", zh: "体感" },
  humidity: { en: "Humidity", ja: "湿度", zh: "湿度" },
  wind: { en: "Wind", ja: "風速", zh: "风速" },
  high: { en: "High", ja: "最高", zh: "最高" },
  low: { en: "Low", ja: "最低", zh: "最低" },
  next24h: { en: "Next 24 hours", ja: "今後24時間", zh: "未来24小时" },
  now: { en: "Now", ja: "現在", zh: "现在" },
  upcomingDays: { en: "Next 2 days", ja: "今後2日間", zh: "未来2天" },
  vsMonthAverage: { en: "vs. {month} average", ja: "{month}平均比", zh: "较{month}平均" },
  monthAverage: { en: "{month} average", ja: "{month}平均気温", zh: "{month}平均气温" },
  todayMean: { en: "Today's mean", ja: "本日の平均気温", zh: "今日日均温" },
  vsYesterday: { en: "vs. yesterday", ja: "前日比", zh: "较昨日" },
  yesterdayMean: { en: "Yesterday's mean", ja: "前日の平均気温", zh: "昨日日均温" },
  warmer: { en: "warmer", ja: "高い", zh: "偏暖" },
  colder: { en: "colder", ja: "低い", zh: "偏冷" },
};

function useLang(): Lang {
  const { i18n } = useTranslation();
  return (i18n.language as Lang) in STRINGS.noLocation ? (i18n.language as Lang) : "en";
}

function WeatherIconGlyph({ icon }: { icon: WeatherIcon }) {
  switch (icon) {
    case "clear":
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
      );
    case "partly-cloudy":
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <circle cx="9" cy="8" r="3" />
          <path d="M9 2v2M13.8 4.2l-1.4 1.4M3 8h2" />
          <path d="M8 20h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-2A4.5 4.5 0 0 0 8 20z" />
        </svg>
      );
    case "fog":
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <path d="M6 16h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-2A4.5 4.5 0 0 0 6 15" />
          <path d="M4 19h16M4 22h16" />
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <path d="M7 14h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-2A4.5 4.5 0 0 0 7 13" />
          <path d="M8 18l-1.5 3M12 18l-1.5 3M16 18l-1.5 3" />
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <path d="M7 14h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-2A4.5 4.5 0 0 0 7 13" />
          <path d="M9 18v4M7 19.5l4 1M11 19.5l-4 1M15 18v4M13 19.5l4 1M17 19.5l-4 1" />
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <path d="M7 13h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-2A4.5 4.5 0 0 0 7 12" />
          <path d="M12 15l-3 5h3l-1 4 4-6h-3l1-3z" />
        </svg>
      );
    case "cloudy":
    default:
      return (
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <path d="M6 18h10a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4-1.5A4.5 4.5 0 0 0 6 18z" />
        </svg>
      );
  }
}

export default function Weather({ config }: { config: Record<string, unknown> }) {
  const comp = config.comp as { location?: string; refreshMinutes?: number } | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const configuredLocation = (comp?.location ?? "").trim();
  // A non-positive or nonsensical value turns auto refresh off rather than spinning a runaway timer.
  const refreshMinutes =
    typeof comp?.refreshMinutes === "number" && Number.isFinite(comp.refreshMinutes)
      ? Math.max(0, comp.refreshMinutes)
      : DEFAULT_REFRESH_MINUTES;
  const lang = useLang();

  // `location` is what the weather is fetched for; `query` is what is currently typed in the box.
  // Keeping them apart means a half-typed city name never triggers a fetch — only committing does.
  const [location, setLocation] = useState(configuredLocation);
  const [query, setQuery] = useState(configuredLocation);
  // Candidates are stored together with the query they answer, so results arriving for a query the
  // user has already typed past are simply ignored instead of briefly replacing the current list.
  const [suggested, setSuggested] = useState<{ query: string; results: GeocodeResult[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = query.trim();
  const suggestions = suggested?.query === trimmedQuery ? suggested.results : null;
  const showDropdown = open && trimmedQuery.length >= MIN_QUERY_LENGTH;
  // A shrinking result list must not leave the highlight pointing past its end.
  const activeIndex = suggestions && highlight < suggestions.length ? highlight : -1;

  const [placeName, setPlaceName] = useState("");
  // Bumped to force a reload when the location name stayed the same but the place behind it changed.
  const [reloadKey, setReloadKey] = useState(0);
  const geoRef = useRef<GeocodeResult | null>(null);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [normals, setNormals] = useState<MonthlyNormals | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error" | "notFound">("idle");

  // Mirrors `location`, for the two reads that can't use it: recognising a change that came from
  // outside this card, and the blur handler, which runs before React re-renders after a commit and
  // would otherwise put the previous location back into the box.
  const locationRef = useRef(configuredLocation);

  // Follow the location when it changes from outside the card (config editor, layout import),
  // without clobbering what the user is typing here.
  useEffect(() => {
    if (configuredLocation !== locationRef.current) {
      locationRef.current = configuredLocation;
      setLocation(configuredLocation);
      setQuery(configuredLocation);
    }
  }, [configuredLocation]);

  function commitLocation(next: string, picked?: GeocodeResult) {
    const trimmed = next.trim();
    setQuery(trimmed);
    setOpen(false);
    setHighlight(-1);
    if (picked) primeGeocodeCache(trimmed, picked);
    if (trimmed === location) {
      // Same name, different place — two "Springfield"s, say. The name in the config doesn't change,
      // so nothing above triggers a reload; this does.
      if (picked && geoRef.current && (picked.lat !== geoRef.current.lat || picked.lon !== geoRef.current.lon)) {
        setReloadKey((n) => n + 1);
      }
      return;
    }
    locationRef.current = trimmed;
    setLocation(trimmed);
    save?.({ ...comp, location: trimmed });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const count = suggestions?.length ?? 0;
      if (!count) return;
      e.preventDefault();
      setOpen(true);
      const down = e.key === "ArrowDown";
      setHighlight((prev) => (prev < 0 ? (down ? 0 : count - 1) : (prev + (down ? 1 : -1) + count) % count));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = activeIndex >= 0 ? suggestions?.[activeIndex] : undefined;
      commitLocation(picked ? picked.name : query, picked);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Escape") {
      // Abandon the edit: the box goes back to the location actually being shown.
      setQuery(locationRef.current);
      setOpen(false);
      setHighlight(-1);
      inputRef.current?.blur();
    }
  }

  // Fetch candidates for the dropdown while typing, debounced so a fast typist causes one request
  // instead of one per keystroke.
  useEffect(() => {
    if (!showDropdown) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchLocations(trimmedQuery, SUGGESTION_COUNT)
        .then((results) => { if (!cancelled) setSuggested({ query: trimmedQuery, results }); })
        .catch(() => { if (!cancelled) setSuggested({ query: trimmedQuery, results: [] }); });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, showDropdown]);

  useEffect(() => {
    if (!location) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        const geo = await geocodeLocation(location);
        if (cancelled) return;
        geoRef.current = geo;
        setPlaceName(geo.name);
        const current = await fetchCurrentWeather({ lat: geo.lat, lon: geo.lon }, geo.timezone);
        if (cancelled) return;
        setWeather(current);
        setStatus("ready");

        // Wolfram's prebuilt baseline (refresh.sh → data/monthly-mean-temp.json) is preferred: it
        // costs no request at all. The live archive only fills in when this location isn't in
        // location.txt, or its current month has too few years on record — ten years of daily data
        // is a slow, chunky request, so it is never awaited alongside the core weather fetch, and
        // the card simply omits the comparison line if it fails.
        const monthIndex = Number(current.time.slice(5, 7)) - 1;
        const fromFile = monthlyNormalsFromFile(location);
        if (fromFile?.byMonth[monthIndex] != null) {
          setNormals(fromFile);
        } else {
          // Drop any baseline left over from a previously configured location, so the new
          // temperature is never briefly paired with the old place's monthly average.
          setNormals(null);
          fetchMonthlyNormals({ lat: geo.lat, lon: geo.lon }, geo.timezone)
            .then((data) => { if (!cancelled) setNormals(data); })
            .catch(() => { if (!cancelled) setNormals(null); });
        }
      } catch (err) {
        if (!cancelled) setStatus(err instanceof LocationNotFoundError ? "notFound" : "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location, reloadKey]);

  // Auto refresh of the current conditions, on its own effect so that editing the interval only
  // rebuilds the timer instead of re-running the load above (geocode + monthly baseline).
  useEffect(() => {
    if (!location || refreshMinutes <= 0) return;
    let cancelled = false;

    const id = setInterval(() => {
      geocodeLocation(location)
        .then((geo) => fetchCurrentWeather({ lat: geo.lat, lon: geo.lon }, geo.timezone))
        .then((current) => { if (!cancelled) setWeather(current); })
        .catch(() => undefined);
    }, refreshMinutes * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [location, reloadKey, refreshMinutes]);

  // The box stays on screen in every state — a wrong or unknown location has to be fixable without
  // opening the config editor.
  const locationField = (
    <div className={styles.locationRow}>
      <span className={styles.locationLabel}>{STRINGS.locationLabel[lang]}:</span>
      {/* data-value feeds the CSS mirror that sizes the field to its contents; an empty box falls
          back to the placeholder so it stays wide enough to read. */}
      <div className={styles.locationField} data-value={query || STRINGS.locationPlaceholder[lang]}>
        <input
          ref={inputRef}
          type="text"
          className={styles.locationInput}
          value={query}
          placeholder={STRINGS.locationPlaceholder[lang]}
          aria-label={STRINGS.locationLabel[lang]}
          autoComplete="off"
          // Collapses the input's intrinsic width so the mirror above decides how wide the grid
          // column is; the CSS stretches it back to fill.
          size={1}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          // Leaving the box without picking anything isn't a change — put back what is on screen.
          onBlur={() => {
            setQuery(locationRef.current);
            setOpen(false);
            setHighlight(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {showDropdown && (
          <ul className={styles.suggestions} role="listbox">
            {(suggestions ?? []).map((place, i) => (
              <li
                key={place.id ?? `${place.name}-${place.lat}-${place.lon}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`${styles.suggestion} ${i === activeIndex ? styles.suggestionActive : ""}`}
                // Keep the focus in the input, so onBlur can't reset the query before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commitLocation(place.name, place)}
              >
                <span className={styles.suggestionName}>{place.name}</span>
                <span className={styles.suggestionMeta}>
                  {[place.admin1, place.country].filter(Boolean).join(", ")}
                </span>
              </li>
            ))}
            {suggestions?.length === 0 && <li className={styles.suggestionEmpty}>{STRINGS.noMatches[lang]}</li>}
            {suggestions === null && <li className={styles.suggestionEmpty}>{STRINGS.searching[lang]}</li>}
          </ul>
        )}
      </div>
      {/* The geocoder resolves loose input ("tokio") to a real place; show it when it differs from
          what was typed, so the card never silently reports some other city's weather. */}
      {status === "ready" && placeName && placeName.toLowerCase() !== location.toLowerCase() && (
        <span className={styles.resolvedPlace}>→ {placeName}</span>
      )}
    </div>
  );

  const statusHint = !location
    ? STRINGS.noLocation[lang]
    : status === "notFound"
      ? STRINGS.notFound[lang]
      : status === "error"
        ? STRINGS.error[lang]
        : status === "loading" || status === "idle"
          ? STRINGS.loading[lang]
          : null;

  if (statusHint !== null || !weather) {
    return (
      <div className={styles.container}>
        {locationField}
        <span className={styles.hint}>{statusHint ?? STRINGS.error[lang]}</span>
      </div>
    );
  }

  const code = describeWeatherCode(weather.weatherCode);
  // Compare like with like: today's daily mean against the same month's mean over the last decade,
  // so the reading says "warm for July" instead of the useless "warm for the year" a yearly
  // baseline gives every summer. The month comes from the location's own date, not the viewer's.
  const monthIndex = Number(weather.time.slice(5, 7)) - 1;
  const monthNormalC = normals?.byMonth[monthIndex] ?? null;
  const todayMeanC = (weather.todayMax + weather.todayMin) / 2;
  const diffFromMonth = monthNormalC != null ? todayMeanC - monthNormalC : null;
  const monthName = formatMonth(monthIndex, lang);

  // Day-over-day, again mean vs mean. Anything under 0.05°C rounds to "0.0" and is reported as
  // flat rather than given a warmer/colder colour it hasn't earned.
  const yesterdayMeanC = weather.yesterday ? (weather.yesterday.tempMax + weather.yesterday.tempMin) / 2 : null;
  const diffFromYesterday = yesterdayMeanC != null ? todayMeanC - yesterdayMeanC : null;
  const yesterdayTrend =
    diffFromYesterday == null ? null : diffFromYesterday >= 0.05 ? "up" : diffFromYesterday <= -0.05 ? "down" : "flat";
  const YESTERDAY_STYLE = { up: styles.warmerThanYesterday, down: styles.colderThanYesterday, flat: "" } as const;

  return (
    <div className={styles.container}>
      {locationField}

      <div className={styles.header}>
        <WeatherIconGlyph icon={code.icon} />
        <div className={styles.headerText}>
          <div className={styles.temperatureRow}>
            <div className={styles.temperature}>{Math.round(weather.temperature)}°C</div>
            {yesterdayTrend != null && diffFromYesterday != null && yesterdayMeanC != null && (
              <span
                className={`${styles.yesterdayDelta} ${YESTERDAY_STYLE[yesterdayTrend]}`}
                // The bare number carries no label next to the temperature, so the tooltip spells
                // out what it is measured against.
                title={
                  `${STRINGS.vsYesterday[lang]} · ${STRINGS.todayMean[lang]} ${todayMeanC.toFixed(1)}°C · ` +
                  `${STRINGS.yesterdayMean[lang]} ${yesterdayMeanC.toFixed(1)}°C`
                }
              >
                {yesterdayTrend === "flat"
                  ? "±0.0°C"
                  : `${diffFromYesterday >= 0 ? "+" : ""}${diffFromYesterday.toFixed(1)}°C`}
              </span>
            )}
          </div>
          <div className={styles.condition}>{code.label[lang]}</div>
        </div>
      </div>

      <div className={styles.details}>
        <div className={styles.detail}>
          <span className={styles.detailLabel}>{STRINGS.feelsLike[lang]}</span>
          <span className={styles.detailValue}>{Math.round(weather.apparentTemperature)}°C</span>
        </div>
        <div className={styles.detail}>
          <span className={styles.detailLabel}>{STRINGS.humidity[lang]}</span>
          <span className={styles.detailValue}>{weather.humidity}%</span>
        </div>
        <div className={styles.detail}>
          <span className={styles.detailLabel}>{STRINGS.wind[lang]}</span>
          <span className={styles.detailValue}>{Math.round(weather.windSpeed)} km/h</span>
        </div>
        <div className={styles.detail}>
          <span className={styles.detailLabel}>{STRINGS.high[lang]} / {STRINGS.low[lang]}</span>
          <span className={styles.detailValue}>{Math.round(weather.todayMax)}° / {Math.round(weather.todayMin)}°</span>
        </div>
      </div>

      {weather.hourly.length > 0 && (
        <div className={styles.hourlySection}>
          <div className={styles.hourlyTitle}>{STRINGS.next24h[lang]}</div>
          <div className={styles.hourlyRow}>
            {weather.hourly.map((hour, i) => {
              const hourCode = describeWeatherCode(hour.weatherCode);
              return (
                <div className={styles.hourlyItem} key={hour.time}>
                  <span className={styles.hourlyTime}>{i === 0 ? STRINGS.now[lang] : hour.time.slice(11, 16)}</span>
                  <WeatherIconGlyph icon={hourCode.icon} />
                  <span className={styles.hourlyTemp}>{Math.round(hour.temperature)}°</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {weather.upcomingDays.length > 0 && (
        <div className={styles.dailySection}>
          <div className={styles.dailyTitle}>{STRINGS.upcomingDays[lang]}</div>
          <div className={styles.dailyRow}>
            {weather.upcomingDays.map((day) => {
              const dayCode = describeWeatherCode(day.weatherCode);
              return (
                <div className={styles.dailyItem} key={day.date}>
                  <span className={styles.dailyLabel}>{formatWeekday(day.date, lang)}</span>
                  <WeatherIconGlyph icon={dayCode.icon} />
                  <span className={styles.dailyTemp}>
                    {Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {diffFromMonth != null && monthNormalC != null && normals != null && (
        <div
          className={styles.average}
          title={
            `${STRINGS.todayMean[lang]} ${todayMeanC.toFixed(1)}°C · ` +
            `${STRINGS.monthAverage[lang].replace("{month}", monthName)} ${monthNormalC.toFixed(1)}°C ` +
            `(${normals.startYear}–${normals.endYear}, ${normals.source})`
          }
        >
          {diffFromMonth >= 0 ? "+" : ""}
          {diffFromMonth.toFixed(1)}°C {diffFromMonth >= 0 ? STRINGS.warmer[lang] : STRINGS.colder[lang]} (
          {STRINGS.vsMonthAverage[lang].replace("{month}", monthName)})
        </div>
      )}
    </div>
  );
}
