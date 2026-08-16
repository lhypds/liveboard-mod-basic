import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Dropdown from "@ui/Dropdown";
import styles from "./map.module.css";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const LANG_MAP: Record<string, string> = {
  en: "en",
  ja: "ja",
  zh: "zh-Hans",
};

type BasemapKey = "standard" | "satellite" | "light";

// Standard is the v3 basemap: shops, stations, parks and building volumes on top of the
// road network. Light — the old default here — draws roads and little else.
const BASEMAPS: Record<BasemapKey, string> = {
  standard: "mapbox://styles/mapbox/standard",
  satellite: "mapbox://styles/mapbox/standard-satellite",
  light: "mapbox://styles/mapbox/light-v11",
};

// All of these are on by default in Standard; setting them explicitly keeps a card that
// once stored a stripped-down config from staying stripped down
const DETAIL_CONFIG: Record<string, boolean> = {
  showPointOfInterestLabels: true,
  showPlaceLabels: true,
  showRoadLabels: true,
  showTransitLabels: true,
  show3dObjects: true,
};

type Strings = {
  placeholder: string;
  button: string;
  notFound: string;
  error: string;
  noToken: string;
  basemapLabel: string;
  basemaps: Record<BasemapKey, string>;
};

const STRINGS: Record<string, Strings> = {
  en: {
    placeholder: "Search address...",
    button: "Search",
    notFound: "Address not found",
    error: "Search failed. Please try again.",
    noToken: "Add VITE_MAPBOX_TOKEN to display the map.",
    basemapLabel: "Map detail",
    basemaps: { standard: "Detailed", satellite: "Satellite", light: "Minimal" },
  },
  ja: {
    placeholder: "住所を検索...",
    button: "検索",
    notFound: "住所が見つかりません",
    error: "検索に失敗しました。もう一度お試しください。",
    noToken: "地図を表示するには VITE_MAPBOX_TOKEN を設定してください。",
    basemapLabel: "地図の詳細度",
    basemaps: { standard: "詳細", satellite: "衛星", light: "シンプル" },
  },
  zh: {
    placeholder: "搜索地址...",
    button: "搜索",
    notFound: "未找到该地址",
    error: "搜索失败，请重试。",
    noToken: "请设置 VITE_MAPBOX_TOKEN 以显示地图。",
    basemapLabel: "地图详细程度",
    basemaps: { standard: "详细", satellite: "卫星", light: "简约" },
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

type Comp = {
  longitude?: number;
  latitude?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  basemap?: string;
  style?: string;
};

// `basemap` is what the picker writes. `style` is the pre-picker field: a hand-set style URL
// still wins, but the old light-v11 default is exactly the sparse map this card replaced, so
// it falls through to Standard rather than pinning every existing card to roads-only.
function resolveStyle(comp: Comp | undefined): { key: BasemapKey | null; url: string } {
  const key = comp?.basemap;
  if (typeof key === "string" && key in BASEMAPS) return { key: key as BasemapKey, url: BASEMAPS[key as BasemapKey] };
  const legacy = comp?.style;
  if (typeof legacy === "string" && legacy && legacy !== BASEMAPS.light) return { key: null, url: legacy };
  return { key: "standard", url: BASEMAPS.standard };
}

function isStandard(url: string): boolean {
  return url.includes("mapbox/standard");
}

// The label the map already draws, plus what kind of place it is — built as nodes because the
// name comes from map data, not from us
function poiContent(name: string, properties: Record<string, string | number | boolean>) {
  const wrapper = document.createElement("div");
  wrapper.className = styles.poi;
  const title = document.createElement("div");
  title.className = styles.poiName;
  title.textContent = name;
  wrapper.appendChild(title);
  const category = properties.class;
  if (typeof category === "string" && category) {
    const sub = document.createElement("div");
    sub.className = styles.poiCategory;
    sub.textContent = category.replace(/_/g, " ");
    wrapper.appendChild(sub);
  }
  return wrapper;
}

export default function Map({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const strings = STRINGS[i18n.language] ?? STRINGS.en;
  const comp = config.comp as Comp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  const initialViewRef = useRef({
    longitude: finite(comp?.longitude, 139.7517),
    latitude: finite(comp?.latitude, 35.6895),
    zoom: finite(comp?.zoom, 14),
    pitch: finite(comp?.pitch, 0),
    bearing: finite(comp?.bearing, 0),
  });
  const [basemap, setBasemap] = useState(() => resolveStyle(comp));
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const styleUrlRef = useRef(basemap.url);
  const poiBoundRef = useRef(false);
  const languageRef = useRef(LANG_MAP[i18n.language] ?? "en");
  // moveend outlives the render that registered it, so what it writes back merges onto the
  // newest comp rather than the one the map was built from
  const compRef = useRef(comp);
  const saveRef = useRef(save);
  useEffect(() => {
    compRef.current = comp;
    saveRef.current = save;
  }, [comp, save]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !TOKEN) return;
    const initial = initialViewRef.current;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrlRef.current,
      center: [initial.longitude, initial.latitude],
      zoom: initial.zoom,
      pitch: initial.pitch,
      bearing: initial.bearing,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    // The compass doubles as the pitch handle, which is how you get under the 3D buildings
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    mapRef.current = map;

    const applyStyleExtras = () => {
      const standard = isStandard(styleUrlRef.current);
      if (standard) {
        for (const [key, value] of Object.entries(DETAIL_CONFIG)) {
          try {
            map.setConfigProperty("basemap", key, value);
          } catch {
            // A style that does not expose this switch — nothing to turn on
          }
        }
      }
      map.setLanguage(languageRef.current);
      syncPoi(standard);
    };

    const syncPoi = (standard: boolean) => {
      if (standard === poiBoundRef.current) return;
      if (!standard) {
        for (const id of ["poi-click", "poi-enter", "poi-leave"]) {
          try {
            map.removeInteraction(id);
          } catch {
            // Never registered
          }
        }
        popupRef.current?.remove();
        popupRef.current = null;
        poiBoundRef.current = false;
        return;
      }
      const poi = { featuresetId: "poi", importId: "basemap" };
      map.addInteraction("poi-click", {
        type: "click",
        target: poi,
        handler: (event) => {
          const feature = event.feature;
          const name = feature?.properties?.name;
          if (!feature || typeof name !== "string" || !name) return;
          const at =
            feature.geometry.type === "Point"
              ? (feature.geometry.coordinates as [number, number])
              : [event.lngLat.lng, event.lngLat.lat];
          popupRef.current?.remove();
          popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10, className: styles.popup })
            .setLngLat(at as [number, number])
            .setDOMContent(poiContent(name, feature.properties))
            .addTo(map);
        },
      });
      map.addInteraction("poi-enter", {
        type: "mouseenter",
        target: poi,
        handler: () => {
          map.getCanvas().style.cursor = "pointer";
        },
      });
      map.addInteraction("poi-leave", {
        type: "mouseleave",
        target: poi,
        handler: () => {
          map.getCanvas().style.cursor = "";
        },
      });
      poiBoundRef.current = true;
    };

    const persistView = () => {
      const center = map.getCenter();
      const next = {
        longitude: Number(center.lng.toFixed(6)),
        latitude: Number(center.lat.toFixed(6)),
        zoom: Number(map.getZoom().toFixed(2)),
        pitch: Number(map.getPitch().toFixed(1)),
        bearing: Number(map.getBearing().toFixed(1)),
      };
      const current = compRef.current ?? {};
      const unchanged = (Object.keys(next) as Array<keyof typeof next>).every((key) => current[key] === next[key]);
      if (unchanged) return;
      saveRef.current?.({ ...current, ...next });
    };

    map.on("style.load", applyStyleExtras);
    map.on("moveend", persistView);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      poiBoundRef.current = false;
      map.remove();
      mapRef.current = null;
      searchMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleUrlRef.current === basemap.url) return;
    styleUrlRef.current = basemap.url;
    popupRef.current?.remove();
    popupRef.current = null;
    map.setStyle(basemap.url);
  }, [basemap.url]);

  useEffect(() => {
    const map = mapRef.current;
    languageRef.current = LANG_MAP[i18n.language] ?? "en";
    if (!map) return;
    const applyLanguage = () => map.setLanguage(languageRef.current);
    if (map.isStyleLoaded()) applyLanguage();
    else map.once("load", applyLanguage);
  }, [i18n.language]);

  function pickBasemap(key: BasemapKey) {
    if (basemap.key === key) return;
    setBasemap({ key, url: BASEMAPS[key] });
    saveRef.current?.({ ...(compRef.current ?? {}), basemap: key });
  }

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
      map.flyTo({ center: lngLat, zoom: 17, duration: 1_500 });
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
      {TOKEN && (
        <div className={styles.topBar}>
          {GOOGLE_API_KEY && (
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
          <div className={styles.basemapPicker}>
            <Dropdown
              value={basemap.key ?? "standard"}
              options={(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => ({
                value: key,
                label: strings.basemaps[key],
              }))}
              onChange={pickBasemap}
              ariaLabel={strings.basemapLabel}
            />
          </div>
        </div>
      )}
    </div>
  );
}
