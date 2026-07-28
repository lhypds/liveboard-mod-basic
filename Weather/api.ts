// Data sources (all free, no key required except Wolfram|Alpha which needs a server-side refresh):
// - Open-Meteo: current weather + geocoding — https://open-meteo.com
// - GDACS: active tropical cyclone tracking — https://www.gdacs.org
// - Wolfram|Alpha Short Answers API: annual mean temperature — refresh.sh fetches it for each
//   location in location.txt into ./data/annual-mean-temp.json, which is read statically below

export type Coords = { lat: number; lon: number };

export type GeocodeResult = {
  lat: number;
  lon: number;
  name: string;
  country: string;
  timezone: string;
};

export type HourlyForecastPoint = {
  time: string;
  temperature: number;
  weatherCode: number;
};

export type DailyForecastPoint = {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
};

export type CurrentWeather = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  weatherCode: number;
  windSpeed: number;
  isDay: boolean;
  todayMax: number;
  todayMin: number;
  time: string;
  hourly: HourlyForecastPoint[];
  // Tomorrow and the day after — today itself is covered by todayMax/todayMin above.
  upcomingDays: DailyForecastPoint[];
};

export type TyphoonInfo = {
  name: string;
  country: string;
  alertLevel: string;
  distanceKm: number;
  imageUrl: string | null;
  reportUrl: string;
  fromDate: string;
  toDate: string;
};

export type EarthquakeInfo = {
  time: string;
  locationJa: string;
  locationEn: string;
  magnitude: number | null;
  maxIntensity: string;
  distanceKm: number;
};

export type AnnualAvg = { value: number; unit: "C" | "F" };

const GEOCODE_CACHE_PREFIX = "liveboard-weather-geocode:";
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Cached<T> = { data: T; fetchedAt: number };

function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<T>;
    if (Date.now() - parsed.fetchedAt > ttlMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

export async function geocodeLocation(query: string): Promise<GeocodeResult> {
  const cacheKey = GEOCODE_CACHE_PREFIX + query.trim().toLowerCase();
  const cached = readCache<GeocodeResult>(cacheKey, GEOCODE_TTL_MS);
  if (cached) return cached;

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ latitude: number; longitude: number; name: string; country?: string; timezone: string }>;
  };
  const first = data.results?.[0];
  if (!first) throw new Error(`Location not found: ${query}`);
  const result: GeocodeResult = {
    lat: first.latitude,
    lon: first.longitude,
    name: first.name,
    country: first.country ?? "",
    timezone: first.timezone,
  };
  writeCache(cacheKey, result);
  return result;
}

export async function fetchCurrentWeather(coords: Coords, timezone: string): Promise<CurrentWeather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lon));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
  );
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("hourly", "temperature_2m,weather_code");
  url.searchParams.set("timezone", timezone);
  // 3 days: today (daily max/min + hourly coverage even when requested late in the
  // day, since the next-24h window can spill into tomorrow), plus 2 more forecast days.
  url.searchParams.set("forecast_days", "3");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
      is_day: number;
    };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
    hourly: { time: string[]; temperature_2m: number[]; weather_code: number[] };
  };
  const startIdx = Math.max(
    0,
    data.hourly.time.findIndex((t) => t >= data.current.time),
  );
  const hourly: HourlyForecastPoint[] = data.hourly.time
    .slice(startIdx, startIdx + 24)
    .map((time, i) => ({
      time,
      temperature: data.hourly.temperature_2m[startIdx + i],
      weatherCode: data.hourly.weather_code[startIdx + i],
    }));
  const upcomingDays: DailyForecastPoint[] = data.daily.time.slice(1, 3).map((date, i) => ({
    date,
    weatherCode: data.daily.weather_code[i + 1],
    tempMax: data.daily.temperature_2m_max[i + 1],
    tempMin: data.daily.temperature_2m_min[i + 1],
  }));
  return {
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    weatherCode: data.current.weather_code,
    windSpeed: data.current.wind_speed_10m,
    isDay: data.current.is_day === 1,
    todayMax: data.daily.temperature_2m_max[0],
    todayMin: data.daily.temperature_2m_min[0],
    time: data.current.time,
    hourly,
    upcomingDays,
  };
}

type AnnualMeanTempData = Record<string, AnnualAvg>;

function firstGlobValue<T>(glob: Record<string, { default: T }>): T | undefined {
  const key = Object.keys(glob)[0];
  return key ? glob[key].default : undefined;
}

// Gitignored — only exists once refresh.sh has run on this machine/server; the build
// never fails when the data hasn't been generated yet, callers just get an empty lookup.
const annualMeanTempGlob = import.meta.glob<{ default: AnnualMeanTempData }>("./data/annual-mean-temp.json", {
  eager: true,
});
const annualMeanTempData: AnnualMeanTempData = firstGlobValue(annualMeanTempGlob) ?? {};

export function fetchAnnualMeanTemp(location: string): AnnualAvg | null {
  return annualMeanTempData[location.trim().toLowerCase()] ?? null;
}

export function toCelsius(avg: AnnualAvg): number {
  return avg.unit === "F" ? ((avg.value - 32) * 5) / 9 : avg.value;
}

function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type GdacsFeature = {
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    name: string;
    country: string;
    alertlevel: string;
    iscurrent: string;
    fromdate: string;
    todate: string;
    icon: string;
    url: { report: string; details: string };
  };
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms)),
  ]);
}

// GDACS event list has no image; the per-event detail endpoint does (see `images.overviewmap`),
// so only fetch it once a nearby storm is actually found. GDACS responds noticeably slower than
// Open-Meteo (several seconds), so this is always run independently of the core weather fetch —
// never awaited alongside it — and bounded by a timeout so a slow/hung request can't hang forever.
export async function findNearbyTyphoon(coords: Coords, radiusKm: number): Promise<TyphoonInfo | null> {
  const res = await withTimeout(fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC"), 15000);
  if (!res.ok) throw new Error(`Typhoon fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { features?: GdacsFeature[] };

  let nearest: { feature: GdacsFeature; distanceKm: number } | null = null;
  for (const feature of data.features ?? []) {
    if (feature.properties.iscurrent !== "true") continue;
    if (feature.geometry.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates;
    const distanceKm = haversineKm(coords, { lat, lon });
    if (distanceKm > radiusKm) continue;
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { feature, distanceKm };
  }
  if (!nearest) return null;

  let imageUrl: string | null = nearest.feature.properties.icon ?? null;
  try {
    const detailRes = await withTimeout(fetch(nearest.feature.properties.url.details), 15000);
    if (detailRes.ok) {
      const detail = (await detailRes.json()) as { properties?: { images?: { overviewmap?: string } } };
      if (detail.properties?.images?.overviewmap) imageUrl = detail.properties.images.overviewmap;
    }
  } catch {
    // fall back to the alert-level icon already assigned above
  }

  const { properties } = nearest.feature;
  return {
    name: properties.name,
    country: properties.country,
    alertLevel: properties.alertlevel,
    distanceKm: Math.round(nearest.distanceKm),
    imageUrl,
    reportUrl: properties.url.report,
    fromDate: properties.fromdate,
    toDate: properties.todate,
  };
}

type JmaBulletin = {
  eid: string;
  at: string;
  anm: string;
  en_anm?: string;
  cod: string;
  mag: string;
  maxi: string;
};

// JMA reports each earthquake in stages under the same eid — a quick intensity-only
// bulletin (maxi, no location yet) followed later by a hypocenter bulletin (location,
// magnitude, but sometimes no maxi). Merge bulletins per eid to get the full picture.
function consolidateJmaEvents(bulletins: JmaBulletin[]): JmaBulletin[] {
  const byEid = new Map<string, JmaBulletin>();
  for (const b of bulletins) {
    const existing = byEid.get(b.eid);
    if (!existing) {
      byEid.set(b.eid, { ...b });
      continue;
    }
    if (!existing.anm && b.anm) existing.anm = b.anm;
    if (!existing.en_anm && b.en_anm) existing.en_anm = b.en_anm;
    if (!existing.cod && b.cod) existing.cod = b.cod;
    if (!existing.mag && b.mag) existing.mag = b.mag;
    if (!existing.maxi && b.maxi) existing.maxi = b.maxi;
  }
  return [...byEid.values()];
}

function parseJmaCoord(cod: string): Coords | null {
  const match = cod.match(/^([+-][\d.]+)([+-][\d.]+)/);
  if (!match) return null;
  return { lat: Number(match[1]), lon: Number(match[2]) };
}

// JMA (Japan Meteorological Agency) publishes this list directly for browser use — it sets
// Access-Control-Allow-Origin: *, so unlike Wolfram it needs no server-side proxy. Yahoo!
// JAPAN's earthquake page has no public API of its own; it (like every Japanese weather
// site) ultimately sources this same JMA data, so we go straight to JMA instead of scraping.
export async function findRecentEarthquakes(coords: Coords, radiusKm: number, withinHours: number): Promise<EarthquakeInfo[]> {
  const res = await withTimeout(fetch("https://www.jma.go.jp/bosai/quake/data/list.json"), 15000);
  if (!res.ok) throw new Error(`Earthquake fetch failed: HTTP ${res.status}`);
  const bulletins = (await res.json()) as JmaBulletin[];
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;

  const results: EarthquakeInfo[] = [];
  for (const event of consolidateJmaEvents(bulletins)) {
    if (!event.maxi) continue; // no measured intensity — not felt anywhere, skip
    const originMs = new Date(event.at).getTime();
    if (Number.isNaN(originMs) || originMs < cutoff) continue;
    const epicenter = parseJmaCoord(event.cod);
    if (!epicenter) continue;
    const distanceKm = haversineKm(coords, epicenter);
    if (distanceKm > radiusKm) continue;
    results.push({
      time: event.at,
      locationJa: event.anm,
      locationEn: event.en_anm || event.anm,
      magnitude: event.mag ? Number(event.mag) : null,
      maxIntensity: event.maxi,
      distanceKm: Math.round(distanceKm),
    });
  }
  return results.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}
