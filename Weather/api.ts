// Data sources:
// - Open-Meteo: current weather + geocoding — https://open-meteo.com
// - Wolfram|Alpha: monthly mean temperatures, the baseline the card compares today against.
//   Needs an app id, so refresh.sh builds ./data/monthly-mean-temp.json for every location in
//   location.txt and the frontend reads it statically (monthlyNormalsFromFile below).
// - Open-Meteo Archive (ERA5): the same monthly baseline computed live, used as a fallback for
//   locations that are not in location.txt and therefore have no Wolfram data (fetchMonthlyNormals)

export type Coords = { lat: number; lon: number };

export type GeocodeResult = {
  lat: number;
  lon: number;
  name: string;
  country: string;
  timezone: string;
  // Region within the country ("Tokyo", "California") — only used to tell same-named places apart
  // in the location dropdown, so it is absent whenever the geocoder omits it.
  admin1?: string;
  // Open-Meteo's own place id, a stable React key for the dropdown.
  id?: number;
};

// Thrown when the geocoder simply has no such place, as opposed to the network or the API failing —
// the card shows "location not found" for this and a generic error for everything else.
export class LocationNotFoundError extends Error {
  constructor(query: string) {
    super(`Location not found: ${query}`);
    this.name = "LocationNotFoundError";
  }
}

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
  // Null only if the archive has no record for yesterday, which the card then just omits.
  yesterday: DailyForecastPoint | null;
};

export type MonthlyNormals = {
  // Mean daily temperature in °C per calendar month; index 0 = January, null if a month has no data.
  byMonth: Array<number | null>;
  startYear: number;
  endYear: number;
  source: "Wolfram|Alpha" | "Open-Meteo";
};

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

type GeocodeApiPlace = {
  id?: number;
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
  admin1?: string;
  timezone: string;
};

function toGeocodeResult(place: GeocodeApiPlace): GeocodeResult {
  return {
    lat: place.latitude,
    lon: place.longitude,
    name: place.name,
    country: place.country ?? "",
    timezone: place.timezone,
    admin1: place.admin1,
    id: place.id,
  };
}

async function searchGeocoder(query: string, count: number): Promise<GeocodeResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
  const data = (await res.json()) as { results?: GeocodeApiPlace[] };
  return (data.results ?? []).map(toGeocodeResult);
}

export async function geocodeLocation(query: string): Promise<GeocodeResult> {
  const cacheKey = GEOCODE_CACHE_PREFIX + query.trim().toLowerCase();
  const cached = readCache<GeocodeResult>(cacheKey, GEOCODE_TTL_MS);
  if (cached) return cached;

  const first = (await searchGeocoder(query, 1))[0];
  if (!first) throw new LocationNotFoundError(query);
  writeCache(cacheKey, first);
  return first;
}

// Candidates for the location dropdown. Deliberately uncached: the query changes on every
// keystroke, so caching each partial word would only fill up localStorage.
export async function searchLocations(query: string, count: number): Promise<GeocodeResult[]> {
  return searchGeocoder(query, count);
}

// Store a picked dropdown entry under the key geocodeLocation() reads, so a name that matches
// several places ("Springfield") resolves to the exact one the user chose rather than to whichever
// the geocoder ranks first. Only the name is persisted in the config, so without this the
// coordinates behind a pick would be lost on the next load.
export function primeGeocodeCache(query: string, result: GeocodeResult) {
  writeCache(GEOCODE_CACHE_PREFIX + query.trim().toLowerCase(), result);
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
  // Yesterday, for the day-over-day comparison.
  url.searchParams.set("past_days", "1");
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
  // past_days pushes today off the front of the daily arrays, so find it by date rather than
  // trusting a fixed offset — that keeps yesterday/today/upcoming correct whatever the window is.
  const todayIdx = Math.max(0, data.daily.time.indexOf(data.current.time.slice(0, 10)));
  const dailyPoint = (idx: number): DailyForecastPoint | null =>
    idx >= 0 && idx < data.daily.time.length
      ? {
          date: data.daily.time[idx],
          weatherCode: data.daily.weather_code[idx],
          tempMax: data.daily.temperature_2m_max[idx],
          tempMin: data.daily.temperature_2m_min[idx],
        }
      : null;
  const upcomingDays: DailyForecastPoint[] = [dailyPoint(todayIdx + 1), dailyPoint(todayIdx + 2)].filter(
    (day): day is DailyForecastPoint => day !== null,
  );
  return {
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    weatherCode: data.current.weather_code,
    windSpeed: data.current.wind_speed_10m,
    isDay: data.current.is_day === 1,
    todayMax: data.daily.temperature_2m_max[todayIdx],
    todayMin: data.daily.temperature_2m_min[todayIdx],
    time: data.current.time,
    hourly,
    upcomingDays,
    yesterday: dailyPoint(todayIdx - 1),
  };
}

const NORMALS_YEARS = 10;
const NORMALS_CACHE_PREFIX = "liveboard-weather-monthly-normals:";
const NORMALS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms)),
  ]);
}

// Monthly climate normals from Open-Meteo's ERA5 archive: the mean daily temperature of each
// calendar month averaged over the last NORMALS_YEARS *complete* years. Only whole past years
// count — ERA5 lags a few days behind today, and a partial current year would drag a month's
// baseline towards whichever part of the year has already happened. One request covers all 12
// months (~65 KB) and the result only moves when a new year rolls in, hence the month-long cache.
export async function fetchMonthlyNormals(coords: Coords, timezone: string): Promise<MonthlyNormals> {
  const endYear = new Date().getFullYear() - 1;
  const startYear = endYear - (NORMALS_YEARS - 1);
  const cacheKey = `${NORMALS_CACHE_PREFIX}${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}:${startYear}-${endYear}`;
  const cached = readCache<MonthlyNormals>(cacheKey, NORMALS_TTL_MS);
  if (cached) return cached;

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lon));
  url.searchParams.set("start_date", `${startYear}-01-01`);
  url.searchParams.set("end_date", `${endYear}-12-31`);
  url.searchParams.set("daily", "temperature_2m_mean");
  url.searchParams.set("timezone", timezone);
  const res = await withTimeout(fetch(url), 20000);
  if (!res.ok) throw new Error(`Monthly normals fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    daily: { time: string[]; temperature_2m_mean: Array<number | null> };
  };

  const buckets = Array.from({ length: 12 }, () => ({ total: 0, days: 0 }));
  data.daily.time.forEach((date, i) => {
    const value = data.daily.temperature_2m_mean[i];
    if (value == null) return;
    const bucket = buckets[Number(date.slice(5, 7)) - 1];
    bucket.total += value;
    bucket.days += 1;
  });

  const normals: MonthlyNormals = {
    byMonth: buckets.map((b) => (b.days ? b.total / b.days : null)),
    startYear,
    endYear,
    source: "Open-Meteo",
  };
  writeCache(cacheKey, normals);
  return normals;
}

// Wolfram|Alpha monthly means, keyed by lowercased location then "YYYY-MM" (°C, null where
// Wolfram has no record). Gitignored — only exists once refresh.sh has run on this machine or
// server, so the build never depends on it; without it callers just get an empty lookup and the
// card falls back to fetchMonthlyNormals above.
type MonthlyHistory = Record<string, Record<string, number | null>>;

function firstGlobValue<T>(glob: Record<string, { default: T }>): T | undefined {
  const key = Object.keys(glob)[0];
  return key ? glob[key].default : undefined;
}

const monthlyHistoryGlob = import.meta.glob<{ default: MonthlyHistory }>("./data/monthly-mean-temp.json", {
  eager: true,
});
const monthlyHistory: MonthlyHistory = firstGlobValue(monthlyHistoryGlob) ?? {};

// A month needs at least this many years on record before its average is worth showing; below
// that the card falls back to the live archive rather than quoting a one- or two-year "normal".
const MIN_SAMPLE_YEARS = 3;

export function monthlyNormalsFromFile(location: string): MonthlyNormals | null {
  const history = monthlyHistory[location.trim().toLowerCase()];
  if (!history) return null;

  const endYear = new Date().getFullYear() - 1;
  const startYear = endYear - (NORMALS_YEARS - 1);
  const byMonth: Array<number | null> = [];
  for (let month = 1; month <= 12; month++) {
    const values: number[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const value = history[`${year}-${String(month).padStart(2, "0")}`];
      if (typeof value === "number") values.push(value);
    }
    byMonth.push(
      values.length >= MIN_SAMPLE_YEARS ? values.reduce((sum, v) => sum + v, 0) / values.length : null,
    );
  }
  if (byMonth.every((v) => v == null)) return null;
  return { byMonth, startYear, endYear, source: "Wolfram|Alpha" };
}
