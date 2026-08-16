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
          value: {
            en: "Mapbox Standard — shops, transit and 3D buildings",
            ja: "Mapbox Standard — 店舗・交通機関・3D 建物",
            zh: "Mapbox Standard — 店铺、交通与 3D 建筑",
          },
        },
        {
          key: { en: "Detail level", ja: "詳細度", zh: "详细程度" },
          value: {
            en: "Set basemap in this card's config: standard, satellite or light; click a POI for its name",
            ja: "カード設定の basemap で指定：standard／satellite／light。POI をクリックすると名称を表示",
            zh: "在卡片配置的 basemap 中设置：standard／satellite／light；点击 POI 查看名称",
          },
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
    zoom: 14,
    basemap: "standard",
  },
};
