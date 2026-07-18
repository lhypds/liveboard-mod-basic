import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { TOKYO_HEAT } from "./data";
import styles from "./heatmap.module.css";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

const LANG_MAP: Record<string, string> = {
  en: "en",
  ja: "ja",
  zh: "zh-Hans",
};

export default function HeatMap(_: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || !TOKEN) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [139.7517, 35.6895],
      zoom: 10,
      // Keep the WebGL buffer readable so PNG export can capture the map
      preserveDrawingBuffer: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("tokyo-heat", { type: "geojson", data: TOKYO_HEAT });
      map.addLayer({
        id: "tokyo-heat-layer",
        type: "heatmap",
        source: "tokyo-heat",
        paint: {
          "heatmap-weight": ["get", "weight"],
          "heatmap-intensity": 1,
          "heatmap-radius": 30,
          "heatmap-opacity": 0.8,
        },
      });
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lang = LANG_MAP[i18n.language] ?? "en";
    const apply = () => map.setLanguage(lang);
    if (map.isStyleLoaded()) apply();
    else map.once("style.load", apply);
  }, [i18n.language]);

  return <div ref={containerRef} className={styles.container} />;
}
