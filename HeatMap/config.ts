export const config = {
  i: "HeatMap",
  title: { en: "Tokyo Heatmap", ja: "東京ヒートマップ", zh: "东京热力图" },
  refreshAgeMinutes: 24,
  info: [
    {
      title: { en: "Data", ja: "データ", zh: "数据" },
      items: [
        {
          key: { en: "Data Source", ja: "データソース", zh: "数据来源" },
          value: { en: "STR + internal PMS", ja: "STR + 自社PMS", zh: "STR + 内部 PMS" },
        },
        {
          key: { en: "Refresh Frequency", ja: "更新頻度", zh: "刷新频率" },
          value: { en: "Every hour", ja: "1時間ごと", zh: "每小时" },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 24,
  h: 18,
  minW: 16,
  minH: 16,
  comp: {},
};
