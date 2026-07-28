import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  geocodeLocation,
  fetchCurrentWeather,
  findNearbyTyphoon,
  findRecentEarthquakes,
  fetchMonthlyNormals,
  monthlyNormalsFromFile,
  type CurrentWeather,
  type TyphoonInfo,
  type EarthquakeInfo,
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

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const EARTHQUAKE_WITHIN_HOURS = 24;

const STRINGS: Record<string, Record<Lang, string>> = {
  noLocation: { en: "No location configured.", ja: "地点が設定されていません。", zh: "尚未设置地点。" },
  loading: { en: "Loading weather…", ja: "天気を読み込み中…", zh: "正在加载天气…" },
  error: { en: "Failed to load weather.", ja: "天気の取得に失敗しました。", zh: "天气加载失败。" },
  feelsLike: { en: "Feels like", ja: "体感", zh: "体感" },
  humidity: { en: "Humidity", ja: "湿度", zh: "湿度" },
  wind: { en: "Wind", ja: "風速", zh: "风速" },
  high: { en: "High", ja: "最高", zh: "最高" },
  low: { en: "Low", ja: "最低", zh: "最低" },
  typhoonNearby: { en: "Typhoon nearby", ja: "台風接近中", zh: "台风接近" },
  kmAway: { en: "km away", ja: "km先", zh: "公里外" },
  earthquake: { en: "Earthquake", ja: "地震", zh: "地震" },
  intensity: { en: "Intensity", ja: "震度", zh: "震度" },
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
  const comp = config.comp as { location?: string; typhoonRadiusKm?: number; earthquakeRadiusKm?: number } | undefined;
  const location = (comp?.location ?? "").trim();
  const typhoonRadiusKm = typeof comp?.typhoonRadiusKm === "number" ? comp.typhoonRadiusKm : 800;
  const earthquakeRadiusKm = typeof comp?.earthquakeRadiusKm === "number" ? comp.earthquakeRadiusKm : 300;
  const lang = useLang();

  const [placeName, setPlaceName] = useState("");
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [typhoon, setTyphoon] = useState<TyphoonInfo | null>(null);
  const [earthquakes, setEarthquakes] = useState<EarthquakeInfo[]>([]);
  const [normals, setNormals] = useState<MonthlyNormals | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

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
        setPlaceName(geo.name);
        const current = await fetchCurrentWeather({ lat: geo.lat, lon: geo.lon }, geo.timezone);
        if (cancelled) return;
        setWeather(current);
        setStatus("ready");

        findNearbyTyphoon({ lat: geo.lat, lon: geo.lon }, typhoonRadiusKm)
          .then((info) => { if (!cancelled) setTyphoon(info); })
          .catch(() => { if (!cancelled) setTyphoon(null); });

        findRecentEarthquakes({ lat: geo.lat, lon: geo.lon }, earthquakeRadiusKm, EARTHQUAKE_WITHIN_HOURS)
          .then((quakes) => { if (!cancelled) setEarthquakes(quakes); })
          .catch(() => { if (!cancelled) setEarthquakes([]); });

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
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    const id = setInterval(() => {
      geocodeLocation(location)
        .then((geo) => fetchCurrentWeather({ lat: geo.lat, lon: geo.lon }, geo.timezone))
        .then((current) => { if (!cancelled) setWeather(current); })
        .catch(() => undefined);
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [location, typhoonRadiusKm, earthquakeRadiusKm]);

  if (!location) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.hint}>{STRINGS.noLocation[lang]}</span>
      </div>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <div className={styles.placeholder}>
        <span className={styles.hint}>{STRINGS.loading[lang]}</span>
      </div>
    );
  }

  if (status === "error" || !weather) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.hint}>{STRINGS.error[lang]}</span>
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
      {typhoon && (
        <div className={styles.typhoonBanner}>
          <span className={styles.typhoonName}>⚠ {STRINGS.typhoonNearby[lang]}: {typhoon.name}</span>
          <span className={styles.typhoonDistance}>{typhoon.distanceKm} {STRINGS.kmAway[lang]}</span>
        </div>
      )}

      {earthquakes.length > 0 && (
        <div className={styles.earthquakeSection}>
          {earthquakes.map((eq) => (
            <div className={styles.earthquakeBanner} key={eq.time + eq.locationJa}>
              <span className={styles.earthquakeName}>
                ⚠ {STRINGS.earthquake[lang]}: {lang === "en" ? eq.locationEn : eq.locationJa}
                {eq.magnitude != null && ` M${eq.magnitude.toFixed(1)}`}
              </span>
              <span className={styles.earthquakeDistance}>
                {STRINGS.intensity[lang]} {eq.maxIntensity} · {eq.distanceKm} {STRINGS.kmAway[lang]}
              </span>
            </div>
          ))}
        </div>
      )}

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

      <div className={styles.place}>{placeName || location}</div>

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
