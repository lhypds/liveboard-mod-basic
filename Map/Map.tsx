import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import styles from "./map.module.css";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const LANG_MAP: Record<string, string> = {
  en: "en",
  ja: "ja",
  zh: "zh-Hans",
};

const STRINGS: Record<string, { placeholder: string; button: string; notFound: string; error: string; noToken: string }> = {
  en: {
    placeholder: "Search address...",
    button: "Search",
    notFound: "Address not found",
    error: "Search failed. Please try again.",
    noToken: "Add VITE_MAPBOX_TOKEN to display the map.",
  },
  ja: {
    placeholder: "住所を検索...",
    button: "検索",
    notFound: "住所が見つかりません",
    error: "検索に失敗しました。もう一度お試しください。",
    noToken: "地図を表示するには VITE_MAPBOX_TOKEN を設定してください。",
  },
  zh: {
    placeholder: "搜索地址...",
    button: "搜索",
    notFound: "未找到该地址",
    error: "搜索失败，请重试。",
    noToken: "请设置 VITE_MAPBOX_TOKEN 以显示地图。",
  },
};

type GoogleLocation = { lng: () => number; lat: () => number };
type GoogleMapsApi = {
  maps: {
    Geocoder: new () => {
      geocode: (request: { address: string; region: string }) => Promise<{
        results: Array<{ geometry: { location: GoogleLocation } }>;
      }>;
    };
  };
};

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function currentGoogleMaps(): GoogleMapsApi | undefined {
  return (window as Window & { google?: GoogleMapsApi }).google;
}

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
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Geocoding timed out")), ms)),
  ]);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export default function Map({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const strings = STRINGS[i18n.language] ?? STRINGS.en;
  const comp = config.comp as { longitude?: number; latitude?: number; zoom?: number; style?: string } | undefined;
  const initialViewRef = useRef({
    longitude: finite(comp?.longitude, 139.7517),
    latitude: finite(comp?.latitude, 35.6895),
    zoom: finite(comp?.zoom, 10),
    style: typeof comp?.style === "string" && comp.style ? comp.style : "mapbox://styles/mapbox/light-v11",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !TOKEN) return;
    const initial = initialViewRef.current;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: initial.style,
      center: [initial.longitude, initial.latitude],
      zoom: initial.zoom,
      preserveDrawingBuffer: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      searchMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const language = LANG_MAP[i18n.language] ?? "en";
    const applyLanguage = () => map.setLanguage(language);
    if (map.isStyleLoaded()) applyLanguage();
    else map.once("load", applyLanguage);
  }, [i18n.language]);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const address = searchQuery.trim();
    const map = mapRef.current;
    if (!address || !GOOGLE_API_KEY || !map) return;

    setSearching(true);
    setSearchError(null);
    try {
      const google = await loadGoogleMaps(GOOGLE_API_KEY);
      const geocoder = new google.maps.Geocoder();
      const { results } = await withTimeout(geocoder.geocode({ address, region: "jp" }), 10_000);
      const location = results[0]?.geometry.location;
      if (!location) {
        setSearchError(strings.notFound);
        return;
      }
      const lngLat: [number, number] = [location.lng(), location.lat()];
      map.flyTo({ center: lngLat, zoom: 15, duration: 1_500 });
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = new mapboxgl.Marker({ color: "black" }).setLngLat(lngLat).addTo(map);
    } catch (error) {
      console.error("Geocoding failed:", error);
      setSearchError(strings.error);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.container} />
      {!TOKEN && <div className={styles.missingToken}>{strings.noToken}</div>}
      {TOKEN && GOOGLE_API_KEY && (
        <form className={styles.searchBox} onSubmit={handleSearch}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={strings.placeholder}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button type="submit" className={styles.searchButton} disabled={searching}>
            {strings.button}
          </button>
          {searchError && <div className={styles.searchError}>{searchError}</div>}
        </form>
      )}
    </div>
  );
}
