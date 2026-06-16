export const config = {
  i: "Website",
  title: { en: "Website", ja: "ウェブサイト", zh: "网页组件" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Data", ja: "データ", zh: "数据" },
      items: [
        {
          key: { en: "Data Source", ja: "データソース", zh: "数据来源" },
          value: { en: "External URL", ja: "外部URL", zh: "外部URL" },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 20,
  h: 15,
  minW: 6,
  minH: 4,
  comp: {
    url: "",
    // true | false | "no-scroll"
    // `false` will block all interactions with a blocker
    allowInteract: "no-scroll",
    // 0 = no refresh, positive integer = refresh interval in seconds
    refreshRate: 0,
    crop: {
      x: 0,
      y: 0,
      renderW: 1920,
      renderH: 1080,
      renderSizeControl: false,
    },
    // > 0, 1 = no zoom, 0.5 = zoom out, 2 = zoom in
    zoom: 1,
    renderSizeControl: false,
  },
};
