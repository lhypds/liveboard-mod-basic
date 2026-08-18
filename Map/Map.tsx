import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
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

// Where LanguageSwitcher records the reader's pick — the same key i18n reads on boot
function pickedUiLanguage(): string | null {
  try {
    return localStorage.getItem("lang");
  } catch {
    // Storage walled off (Safari private browsing); nothing was picked as far as we can tell
    return null;
  }
}

// A pick in the switcher wins. Until then the map follows the system: "auto" hands the choice to
// Mapbox, which reads navigator.language — so a machine set to Korean gets Korean labels even
// though the board's own UI only ships en/ja/zh.
function mapLanguage(uiLanguage: string): string {
  if (!pickedUiLanguage()) return "auto";
  return LANG_MAP[uiLanguage] ?? "auto";
}

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
  clear: string;
  notFound: string;
  error: string;
  noToken: string;
  dropHint: string;
  measure: string;
  measureHint: string;
};

const STRINGS: Record<string, Strings> = {
  en: {
    placeholder: "Search address...",
    button: "Search",
    clear: "Clear",
    notFound: "Address not found",
    error: "Search failed. Please try again.",
    noToken: "Add VITE_MAPBOX_TOKEN to display the map.",
    dropHint: "Drop text to search this address",
    measure: "Measure distance",
    measureHint: "Click the start point",
  },
  ja: {
    placeholder: "住所を検索...",
    button: "検索",
    clear: "クリア",
    notFound: "住所が見つかりません",
    error: "検索に失敗しました。もう一度お試しください。",
    noToken: "地図を表示するには VITE_MAPBOX_TOKEN を設定してください。",
    dropHint: "テキストをドロップして住所を検索",
    measure: "距離を測定",
    measureHint: "始点をクリック",
  },
  zh: {
    placeholder: "搜索地址...",
    button: "搜索",
    clear: "清除",
    notFound: "未找到该地址",
    error: "搜索失败，请重试。",
    noToken: "请设置 VITE_MAPBOX_TOKEN 以显示地图。",
    dropHint: "拖入文字即可搜索该地址",
    measure: "测量距离",
    measureHint: "点击起点",
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

const TEXT_DRAG_TYPES = ["text/plain", "text/uri-list"];

function carriesText(transfer: DataTransfer): boolean {
  return TEXT_DRAG_TYPES.some((type) => transfer.types.includes(type));
}

// A dragged selection arrives with whatever line breaks and padding it had on the page it came
// from; the geocoder wants one line, and a runaway paragraph is not an address anyway
function droppedAddress(transfer: DataTransfer): string {
  const raw = transfer.getData("text/plain") || transfer.getData("text/uri-list");
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

type Comp = {
  longitude?: number;
  latitude?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  basemap?: string;
  style?: string;
  address?: string;
  addressLng?: number;
  addressLat?: number;
};

// The coordinates an earlier search resolved to, saved beside the address so a reload can put the
// pin back without spending a second geocoding call on a question already answered
function savedPin(comp: Comp | undefined): [number, number] | null {
  const lng = comp?.addressLng;
  const lat = comp?.addressLat;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

// `basemap` is a BASEMAPS key, set by hand in the card's config — there is no picker on the map.
// `style` is the older field: a hand-set style URL still wins, but the old light-v11 default is
// exactly the sparse map this card replaced, so it falls through to Standard rather than pinning
// every existing card to roads-only.
function resolveStyleUrl(comp: Comp | undefined): string {
  const key = comp?.basemap;
  if (typeof key === "string" && key in BASEMAPS) return BASEMAPS[key as BasemapKey];
  const legacy = comp?.style;
  if (typeof legacy === "string" && legacy && legacy !== BASEMAPS.light) return legacy;
  return BASEMAPS.standard;
}

function isStandard(url: string): boolean {
  return url.includes("mapbox/standard");
}

const MEASURE_SOURCE = "liveboard-measure";
const MEASURE_LINE_LAYER = "liveboard-measure-line";
const MEASURE_POINT_LAYER = "liveboard-measure-point";

// `end` is wherever the pointer is until the second click lands, which is what makes the distance
// move with the mouse; `fixed` is that second click, after which the line stops following anything
type Measure = {
  start: [number, number] | null;
  end: [number, number] | null;
  fixed: boolean;
};

const NO_MEASURE: Measure = { start: null, end: null, fixed: false };

// Typed here rather than pulled from @types/geojson: this module declares its own dependencies, and
// the shape a two-point ruler needs is small enough to state outright
type MeasureFeature = {
  type: "Feature";
  properties: null;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: Array<[number, number]> };
};

function measureData(measure: Measure): { type: "FeatureCollection"; features: MeasureFeature[] } {
  const features: MeasureFeature[] = [];
  const { start, end } = measure;
  if (start) features.push({ type: "Feature", properties: null, geometry: { type: "Point", coordinates: start } });
  if (start && end) {
    features.push({ type: "Feature", properties: null, geometry: { type: "LineString", coordinates: [start, end] } });
    if (measure.fixed) {
      features.push({ type: "Feature", properties: null, geometry: { type: "Point", coordinates: end } });
    }
  }
  return { type: "FeatureCollection", features };
}

const EARTH_RADIUS_M = 6_371_008.8;

function distanceMeters(a: [number, number], b: [number, number]): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const dLat = lat2 - lat1;
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Three significant figures at every scale: a 4 m gap reads as 4.2 m, a city crossing as 12.3 km
function formatDistance(meters: number): string {
  if (meters < 1_000) return `${meters < 10 ? meters.toFixed(1) : Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 2 : 1)} km`;
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
  // What the box was showing when the board was last saved — the card comes back mid-search
  // rather than blank, and an address typed straight into the config is picked up the same way
  const initialAddressRef = useRef(typeof comp?.address === "string" ? comp.address : "");
  const initialPinRef = useRef(savedPin(comp));
  // Read on every render, so editing `basemap` in the card's config restyles the live map
  const styleUrl = resolveStyleUrl(comp);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const styleUrlRef = useRef(styleUrl);
  const poiBoundRef = useRef(false);
  const languageRef = useRef(mapLanguage(i18n.language));
  // moveend outlives the render that registered it, so what it writes back merges onto the
  // newest comp rather than the one the map was built from
  const compRef = useRef(comp);
  const saveRef = useRef(save);
  useEffect(() => {
    compRef.current = comp;
    saveRef.current = save;
  }, [comp, save]);
  const [searchQuery, setSearchQuery] = useState(initialAddressRef.current);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const canDropSearch = Boolean(TOKEN && GOOGLE_API_KEY);
  const [measuring, setMeasuring] = useState(false);
  // The map's own listeners are bound once and outlive any render, so what they read has to be a
  // ref: the POI handlers below check it to stay out of the ruler's way
  const measuringRef = useRef(false);
  const measureRef = useRef<Measure>(NO_MEASURE);
  const measureLabelRef = useRef<mapboxgl.Marker | null>(null);
  const measureDeferredRef = useRef(false);

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
      // Set here as well as on style.load, so the first tiles already come back localized
      // instead of arriving in English and being reloaded a moment later
      language: languageRef.current,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    // The compass doubles as the pitch handle, which is how you get under the 3D buildings
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    mapRef.current = map;

    // The saved view already points at the address; the pin is what says which spot it is
    const pin = initialPinRef.current;
    if (pin) searchMarkerRef.current = new mapboxgl.Marker({ color: "black" }).setLngLat(pin).addTo(map);

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
      // A style swap takes the ruler's source and layers with it; a line in progress is redrawn
      // onto the style that just arrived
      drawMeasure();
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
          // A click while the ruler is out is a measurement point, not a request for a shop card
          if (measuringRef.current) return;
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
      // Both cursor handlers stand down while measuring, or crossing a shop would trade the
      // crosshair for a pointer and never give it back
      map.addInteraction("poi-enter", {
        type: "mouseenter",
        target: poi,
        handler: () => {
          if (measuringRef.current) return;
          map.getCanvas().style.cursor = "pointer";
        },
      });
      map.addInteraction("poi-leave", {
        type: "mouseleave",
        target: poi,
        handler: () => {
          if (measuringRef.current) return;
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
      measureLabelRef.current?.remove();
      measureLabelRef.current = null;
      measureRef.current = NO_MEASURE;
      map.remove();
      mapRef.current = null;
      searchMarkerRef.current = null;
    };
    // The map is built once and torn down with the card; drawMeasure reads only refs, so the
    // instance captured here stays correct for the life of that map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bound only while the ruler is out, so a board that is being read still gets plain map clicks
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !measuring) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    // Two measurement points in quick succession are otherwise read as a double click
    map.doubleClickZoom.disable();

    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      const at: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      const measure = measureRef.current;
      // A finished line has answered its question; the next click asks a new one
      measureRef.current = measure.start && !measure.fixed
        ? { start: measure.start, end: at, fixed: true }
        : { start: at, end: null, fixed: false };
      syncMeasure();
    };

    const handleMove = (event: mapboxgl.MapMouseEvent) => {
      const measure = measureRef.current;
      if (!measure.start || measure.fixed) return;
      measureRef.current = { ...measure, end: [event.lngLat.lng, event.lngLat.lat] };
      syncMeasure();
    };

    // Nothing is being pointed at once the pointer is off the card, so the rubber band lets go
    const handleOut = () => {
      const measure = measureRef.current;
      if (!measure.start || measure.fixed || !measure.end) return;
      measureRef.current = { ...measure, end: null };
      syncMeasure();
    };

    map.on("click", handleClick);
    map.on("mousemove", handleMove);
    map.on("mouseout", handleOut);
    return () => {
      map.off("click", handleClick);
      map.off("mousemove", handleMove);
      map.off("mouseout", handleOut);
      map.doubleClickZoom.enable();
      canvas.style.cursor = "";
    };
    // syncMeasure reads nothing but refs and the map itself, so listing it would only rebind these
    // listeners on every render — the ruler goes on and off, and that is the whole dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleUrlRef.current === styleUrl) return;
    styleUrlRef.current = styleUrl;
    popupRef.current?.remove();
    popupRef.current = null;
    map.setStyle(styleUrl);
  }, [styleUrl]);

  useEffect(() => {
    const applyLanguage = () => {
      languageRef.current = mapLanguage(i18n.language);
      const map = mapRef.current;
      if (!map) return;
      // "load" fires once in a map's life, so a style swapped in later would never see it
      if (map.isStyleLoaded()) map.setLanguage(languageRef.current);
      else map.once("style.load", () => map.setLanguage(languageRef.current));
    };
    applyLanguage();
    // Changing the system language does not reload the page, and the board may sit open for days
    window.addEventListener("languagechange", applyLanguage);
    return () => window.removeEventListener("languagechange", applyLanguage);
  }, [i18n.language]);

  // An address typed into the config by hand has no coordinates with it, so there is nothing to
  // put on the map until it has been looked up once — after that the pin comes back from the save
  useEffect(() => {
    const address = initialAddressRef.current;
    if (!address || initialPinRef.current || !mapRef.current) return;
    void runSearch(address);
    // Only ever on mount: once the lookup lands it writes coordinates back, and re-running on
    // every address change would fight the box the reader is typing in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The address belongs to the card, not to this page view: it goes back into the config next to
  // the coordinates the pin needs
  function persistAddress(address: string, lngLat: [number, number]) {
    const current = compRef.current ?? {};
    const next = {
      address,
      addressLng: Number(lngLat[0].toFixed(6)),
      addressLat: Number(lngLat[1].toFixed(6)),
    };
    const unchanged = (Object.keys(next) as Array<keyof typeof next>).every((key) => current[key] === next[key]);
    if (unchanged) return;
    saveRef.current?.({ ...current, ...next });
  }

  function forgetAddress() {
    const current = compRef.current;
    if (!current) return;
    if (current.address === undefined && current.addressLng === undefined && current.addressLat === undefined) return;
    const next: Record<string, unknown> = { ...current };
    delete next.address;
    delete next.addressLng;
    delete next.addressLat;
    saveRef.current?.(next);
  }

  // The line lives in the map style, so it is added on first use and re-added after a style swap;
  // when nothing is being measured this just empties the source
  function drawMeasure() {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource<mapboxgl.GeoJSONSource>(MEASURE_SOURCE);
    if (source) {
      // Deliberately not gated on isStyleLoaded: Standard reports the style unloaded while its
      // imports settle, which is exactly when a click that ends a measurement tends to land
      source.setData(measureData(measureRef.current));
      return;
    }
    if (!measureRef.current.start) return;
    // Adding to the style is the part that does need a loaded style. One deferral is enough — the
    // pointer keeps moving while the style settles, and each move would otherwise queue its own
    if (!map.isStyleLoaded()) {
      if (measureDeferredRef.current) return;
      measureDeferredRef.current = true;
      map.once("idle", () => {
        measureDeferredRef.current = false;
        drawMeasure();
      });
      return;
    }
    map.addSource(MEASURE_SOURCE, { type: "geojson", data: measureData(NO_MEASURE) });
    // Standard drops slot-less layers on top of everything, which is where a ruler belongs;
    // classic styles have no slots, so the layer simply goes on last
    const slot = isStandard(styleUrlRef.current) ? "top" : undefined;
    map.addLayer({
      id: MEASURE_LINE_LAYER,
      type: "line",
      source: MEASURE_SOURCE,
      slot,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" },
      paint: { "line-color": "#000", "line-width": 2, "line-dasharray": [2, 1.5] },
    });
    map.addLayer({
      id: MEASURE_POINT_LAYER,
      type: "circle",
      source: MEASURE_SOURCE,
      slot,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": "#000", "circle-stroke-width": 2 },
    });
    map.getSource<mapboxgl.GeoJSONSource>(MEASURE_SOURCE)?.setData(measureData(measureRef.current));
  }

  // A marker rather than an overlay: the reading has to stay on its end of the line while the map
  // is panned and zoomed under it
  function syncMeasureLabel() {
    const map = mapRef.current;
    const { start, end } = measureRef.current;
    if (!map || !start || !end) {
      measureLabelRef.current?.remove();
      measureLabelRef.current = null;
      return;
    }
    if (!measureLabelRef.current) {
      const element = document.createElement("div");
      element.className = styles.measureLabel;
      measureLabelRef.current = new mapboxgl.Marker({ element, anchor: "bottom", offset: [0, -12] })
        .setLngLat(end)
        .addTo(map);
    }
    measureLabelRef.current.setLngLat(end);
    measureLabelRef.current.getElement().textContent = formatDistance(distanceMeters(start, end));
  }

  function syncMeasure() {
    drawMeasure();
    syncMeasureLabel();
  }

  // Putting the ruler away is what clears the line — the second click fixes it, it does not end it
  function toggleMeasure() {
    const next = !measuring;
    measuringRef.current = next;
    setMeasuring(next);
    measureRef.current = NO_MEASURE;
    syncMeasure();
    if (next) {
      popupRef.current?.remove();
      popupRef.current = null;
    }
  }

  async function runSearch(query: string) {
    const address = query.trim();
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
      persistAddress(address, lngLat);
    } catch (error) {
      console.error("Geocoding failed:", error);
      setSearchError(strings.error);
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runSearch(searchQuery);
  }

  // The pin is the other half of the search — leaving it behind on an empty box reads as a
  // result that is still current
  function handleClear() {
    setSearchQuery("");
    setSearchError(null);
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    forgetAddress();
    searchInputRef.current?.focus();
  }

  function handleDragOver(event: DragEvent) {
    // Only claiming the drop — preventDefault here is what lets a drop event fire at all, and
    // skipping it leaves file drags to whatever the browser would normally do with them
    if (!canDropSearch || !carriesText(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  }

  function handleDragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropping(false);
  }

  function handleDrop(event: DragEvent) {
    if (!canDropSearch || !carriesText(event.dataTransfer)) return;
    event.preventDefault();
    setDropping(false);
    const address = droppedAddress(event.dataTransfer);
    if (!address || searching) return;
    // The box shows what is being looked up, so a near miss can be edited and re-run
    setSearchQuery(address);
    setSearchError(null);
    void runSearch(address);
  }

  return (
    <div
      className={styles.wrapper}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div ref={containerRef} className={styles.container} />
      {!TOKEN && <div className={styles.missingToken}>{strings.noToken}</div>}
      {dropping && <div className={styles.dropHint}>{strings.dropHint}</div>}
      {TOKEN && (
        <div className={styles.topBar}>
          {GOOGLE_API_KEY && (
            <form className={styles.searchBox} onSubmit={handleSubmit}>
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                placeholder={strings.placeholder}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery && (
                <button type="button" className={styles.clearButton} onClick={handleClear} aria-label={strings.clear}>
                  ✕
                </button>
              )}
              <button type="submit" className={styles.searchButton} disabled={searching}>
                {strings.button}
              </button>
              {searchError && <div className={styles.searchError}>{searchError}</div>}
            </form>
          )}
          <button
            type="button"
            className={measuring ? `${styles.rulerButton} ${styles.rulerButtonOn}` : styles.rulerButton}
            onClick={toggleMeasure}
            aria-label={strings.measure}
            aria-pressed={measuring}
            title={measuring ? strings.measureHint : strings.measure}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <g fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="1" y="5" width="14" height="6" />
                <path d="M4 5v2.5M7 5v3.5M10 5v2.5M13 5v3.5" />
              </g>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
