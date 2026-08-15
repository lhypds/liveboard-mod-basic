export const config = {
  i: "Trip",
  title: { en: "Trip", ja: "旅行", zh: "行程" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Planning", ja: "旅行計画", zh: "行程规划" },
      items: [
        {
          key: { en: "Date range", ja: "旅行期間", zh: "日期范围" },
          value: {
            en: "The selected range creates one editable card per day (up to 366 days)",
            ja: "選択した期間に1日1枚の編集可能なカードを作成（最大366日）",
            zh: "所选日期范围每天生成一张可编辑卡片（最多366天）",
          },
        },
        {
          key: { en: "Day plans", ja: "日別予定", zh: "每日计划" },
          value: {
            en: "Flights, rental cars, linked multi-day hotel stays, events and custom expenses include itemized costs, plus free-form notes",
            ja: "フライト、レンタカー、複数日に連動するホテル、イベント、自由入力の費用明細とノート",
            zh: "航班、租车、跨日联动酒店、活动和自定义费用均计入费用明细，并提供自由笔记",
          },
        },
        {
          key: { en: "Exchange rates", ja: "為替レート", zh: "汇率" },
          value: {
            en: "Mixed-currency costs use Frankfurter ECB reference rates and are totaled in the selected summary currency",
            ja: "複数通貨の費用はFrankfurterのECB参照レートで換算し、選択した集計通貨で合計",
            zh: "不同币种费用使用 Frankfurter 的 ECB 参考汇率换算，并以所选汇总币种计算总额",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 36,
  h: 32,
  minW: 18,
  minH: 16,
  comp: {
    startDate: "",
    endDate: "",
    currency: "JPY",
    days: {},
  },
};
