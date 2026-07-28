export const config = {
  i: "Weather",
  title: { en: "Weather", ja: "天気", zh: "天气" },
  refreshAgeMinutes: 0,
  hideScrollbar: true,
  info: [
    {
      title: { en: "Data", ja: "データ", zh: "数据" },
      items: [
        {
          key: { en: "Current Weather", ja: "現在の天気", zh: "当前天气" },
          value: { en: "Open-Meteo", ja: "Open-Meteo", zh: "Open-Meteo" },
        },
        {
          key: { en: "Typhoon Tracking", ja: "台風情報", zh: "台风追踪" },
          value: { en: "GDACS", ja: "GDACS", zh: "GDACS" },
        },
        {
          key: { en: "Annual Mean Temperature", ja: "年間平均気温", zh: "年平均气温" },
          value: { en: "Wolfram|Alpha", ja: "Wolfram|Alpha", zh: "Wolfram|Alpha" },
        },
        {
          key: { en: "Earthquake Info", ja: "地震情報", zh: "地震信息" },
          value: { en: "JMA (Japan Meteorological Agency)", ja: "気象庁", zh: "日本气象厅" },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 20,
  h: 22,
  minW: 12,
  minH: 14,
  allowMultipleInstances: true,
  comp: {
    location: "Tokyo",
    typhoonRadiusKm: 800,
    earthquakeRadiusKm: 300,
  },
};
