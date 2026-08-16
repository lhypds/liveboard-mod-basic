// Dropped text -> IANA time zone, in two steps: put the address on the globe, then ask which zone
// that point falls in.
//
// Google does both halves when a key is available. It is the only one here that can read a street
// address, and it is already set up for the Map card next door — the build merges every component's
// VITE_ values into one set, so the key configured there is the key read here. Open-Meteo covers the
// rest without any key: boards that never set one up, Google projects where the Time Zone API was
// not switched on, and the plain city names a world clock is usually pointed at.

import { validTimeZone } from "./timeZones";

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const REQUEST_TIMEOUT_MS = 10_000;

export type ResolvedZone = { zone: string; label: string };

type Point = { latitude: number; longitude: number };

type GoogleLocation = { lng: () => number; lat: () => number };
type GoogleMapsApi = {
  maps: {
    Geocoder: new () => {
      geocode: (request: { address: string; region: string }) => Promise<{
        results: Array<{ formatted_address?: string; geometry: { location: GoogleLocation } }>;
      }>;
    };
  };
};

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function currentGoogleMaps(): GoogleMapsApi | undefined {
  return (window as Window & { google?: GoogleMapsApi }).google;
}

// The Map card loads the same script from the same key: whichever card is asked first pays for it,
// and the other finds it already on `window`.
function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  const loaded = currentGoogleMaps();
  if (loaded?.maps) return Promise.resolve(loaded);
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => {
      const google = currentGoogleMaps();
      if (google?.maps) resolve(google);
      else reject(new Error("Google Maps did not initialize"));
    };
    script.onerror = () => {
      googleMapsPromise = null;
      reject(new Error("Failed to load Google Maps script"));
    };
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Lookup timed out")), ms)),
  ]);
}

async function googlePlace(address: string): Promise<{ point: Point; label: string } | null> {
  if (!GOOGLE_API_KEY) return null;
  const google = await loadGoogleMaps(GOOGLE_API_KEY);
  const geocoder = new google.maps.Geocoder();
  // Same region bias as the Map card: it only decides ties, so a place named in full still lands
  // where it belongs.
  const { results } = await withTimeout(geocoder.geocode({ address, region: "jp" }), REQUEST_TIMEOUT_MS);
  const first = results[0];
  if (!first) return null;
  const location = first.geometry.location;
  return {
    point: { latitude: location.lat(), longitude: location.lng() },
    label: first.formatted_address || address,
  };
}

// Needs the Time Zone API enabled on the same Google project as the key. When it is not, this comes
// back REQUEST_DENIED and the Open-Meteo lookup below answers instead.
async function googleZone(point: Point): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/timezone/json");
  url.searchParams.set("location", `${point.latitude},${point.longitude}`);
  // Required by the API, and only the offset it also returns depends on it — the zone id asked for
  // here is the same at every instant.
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1_000)));
  url.searchParams.set("key", GOOGLE_API_KEY);
  const response = await withTimeout(fetch(url.toString()), REQUEST_TIMEOUT_MS);
  if (!response.ok) return null;
  const data = (await response.json()) as { status?: string; timeZoneId?: unknown };
  return data.status === "OK" && typeof data.timeZoneId === "string" ? data.timeZoneId : null;
}

// The cheapest thing Open-Meteo names a coordinate's zone with: a forecast asked for no weather at
// all still reports the zone it would have used.
async function openMeteoZone(point: Point): Promise<string | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
  url.searchParams.set("timezone", "auto");
  const response = await withTimeout(fetch(url.toString()), REQUEST_TIMEOUT_MS);
  if (!response.ok) return null;
  const data = (await response.json()) as { timezone?: unknown };
  return typeof data.timezone === "string" ? data.timezone : null;
}

type OpenMeteoPlace = { name?: string; admin1?: string; country?: string; timezone?: unknown };

// A city index rather than an address search: it answers "Paris" and "New York", and misses street
// addresses and CJK names. That is the whole no-key path, so a miss here is a miss overall.
async function openMeteoPlace(name: string, language: string): Promise<ResolvedZone | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", language);
  const response = await withTimeout(fetch(url.toString()), REQUEST_TIMEOUT_MS);
  if (!response.ok) return null;
  const data = (await response.json()) as { results?: OpenMeteoPlace[] };
  const first = data.results?.[0];
  const zone = validTimeZone(first?.timezone);
  if (!first || !zone) return null;
  // "Shanghai, Shanghai, China" is what the fields say on their own; a repeated one is dropped.
  const parts = [first.name, first.admin1, first.country].filter(Boolean) as string[];
  return { zone, label: [...new Set(parts)].join(", ") || name };
}

export async function resolveTimeZone(text: string, language: string): Promise<ResolvedZone | null> {
  const address = text.trim();
  if (!address) return null;

  if (GOOGLE_API_KEY) {
    try {
      const place = await googlePlace(address);
      if (place) {
        const zone = validTimeZone((await googleZone(place.point)) ?? (await openMeteoZone(place.point)));
        if (zone) return { zone, label: place.label };
      }
    } catch (error) {
      // Not the end of the lookup — the city index below may still know the place, and a board on
      // an old engine can fail here for reasons that have nothing to do with the address.
      console.warn("Google time zone lookup failed:", error);
    }
  }

  return openMeteoPlace(address, language);
}
