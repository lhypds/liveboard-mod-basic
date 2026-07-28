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
          key: { en: "Monthly Mean Temperature", ja: "月別平年気温", zh: "月平均气温" },
          value: {
            en: "Wolfram|Alpha (10 yr), Open-Meteo Archive fallback",
            ja: "Wolfram|Alpha（10年）、予備: Open-Meteo Archive",
            zh: "Wolfram|Alpha（10年），备用 Open-Meteo Archive",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 18,
  h: 22,
  minW: 12,
  minH: 14,
  allowMultipleInstances: true,
  comp: {
    location: "Tokyo",
  },
};
