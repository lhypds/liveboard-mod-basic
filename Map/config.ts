export const config = {
  i: "Map",
  title: { en: "Map", ja: "地図", zh: "地图" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Map", ja: "地図", zh: "地图" },
      items: [
        {
          key: { en: "Base map", ja: "ベースマップ", zh: "底图" },
          value: { en: "Mapbox Light", ja: "Mapbox Light", zh: "Mapbox Light" },
        },
        {
          key: { en: "Address search", ja: "住所検索", zh: "地址搜索" },
          value: { en: "Google Maps Geocoder", ja: "Google Maps Geocoder", zh: "Google Maps Geocoder" },
        },
        {
          key: { en: "Credentials", ja: "認証情報", zh: "凭据" },
          value: {
            en: "Reuses VITE_MAPBOX_TOKEN and VITE_GOOGLE_MAPS_API_KEY from eitai/HeatMap",
            ja: "eitai/HeatMap の VITE_MAPBOX_TOKEN と VITE_GOOGLE_MAPS_API_KEY を再利用",
            zh: "复用 eitai/HeatMap 的 VITE_MAPBOX_TOKEN 和 VITE_GOOGLE_MAPS_API_KEY",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 40,
  h: 28,
  minW: 14,
  minH: 10,
  comp: {
    longitude: 139.7517,
    latitude: 35.6895,
    zoom: 10,
    style: "mapbox://styles/mapbox/light-v11",
  },
};
