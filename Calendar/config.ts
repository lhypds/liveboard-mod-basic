export const config = {
  i: "Calendar",
  title: { en: "Calendar", ja: "カレンダー", zh: "日历" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "About", ja: "概要", zh: "说明" },
      items: [
        {
          key: { en: "Navigation", ja: "操作", zh: "操作" },
          value: {
            en: "Browse months, select a date, or return to today",
            ja: "月を移動し、日付を選択、または今日に戻ります",
            zh: "切换月份、选择日期或返回今天",
          },
        },
        {
          key: { en: "Week start", ja: "週の開始", zh: "每周起始日" },
          value: {
            en: "comp.weekStartsOn: 0 = Sunday, 1 = Monday",
            ja: "comp.weekStartsOn: 0 = 日曜、1 = 月曜",
            zh: "comp.weekStartsOn：0 = 周日，1 = 周一",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 19,
  h: 20,
  minW: 14,
  minH: 15,
  comp: {
    weekStartsOn: 0,
  },
};
