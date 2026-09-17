export const config = {
  i: "Decision",
  title: { en: "Decision", ja: "意思決定", zh: "决策" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "About", ja: "概要", zh: "说明" },
      items: [
        {
          key: { en: "Options", ja: "選択肢", zh: "选项" },
          value: {
            en: "The things being compared, one column each. One is enough to weigh a single choice on its own",
            ja: "比較する対象を1列ずつ並べます。1つだけでも、その選択を単独で検討できます",
            zh: "要比较的事物，每个一列。只有一个时也可以单独评估这个选择",
          },
        },
        {
          key: { en: "Dimensions", ja: "比較軸", zh: "维度" },
          value: {
            en: "One row per point of comparison: how each option does on it, then the analysis and the conclusion for that row",
            ja: "比較の観点ごとに1行。各選択肢の評価に続けて、その観点での分析と結論を書きます",
            zh: "每个比较维度一行：各选项在该维度上的表现，然后是该维度的分析和结论",
          },
        },
        {
          key: { en: "Overall", ja: "総合", zh: "总体" },
          value: {
            en: "Under the table, the overall analysis and then the overall conclusion. Removing a filled row or column asks first",
            ja: "表の下に総合分析、その下に総合結論を書きます。内容のある行・列を削除するときは確認があります",
            zh: "表格下方先写总分析，再写总结论。删除有内容的行或列前会先确认",
          },
        },
        {
          key: { en: "Generate", ja: "生成", zh: "生成" },
          value: {
            en: "The Generate button in the header fills the sheet from the question through simple-ai (sign in to an SC account first). The same question improves what is written; a new one starts over, and Ctrl+Z brings the old sheet back. Cells under options are kept but not sent",
            ja: "ヘッダーの生成ボタンで、質問から simple-ai が表を埋めます（先に SC アカウントにログイン）。同じ質問なら今の内容を改善し、違う質問なら作り直します。Ctrl+Z で元に戻せます。選択肢ごとのセルは残りますが送信されません",
            zh: "标题栏的生成按钮通过 simple-ai 根据问题填写表格（需先登录 SC 账号）。问题不变时完善已有内容，换了问题则重新生成，Ctrl+Z 可恢复原表。选项下的单元格会保留，但不会发送",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 36,
  h: 26,
  minW: 16,
  minH: 12,
  allowMultipleInstances: true,
  comp: {
    question: "",
    // The overall analysis, under the table
    analysis: "",
    // The things being compared, one column each: { id, name }
    options: [
      { id: "o1", name: "" },
      { id: "o2", name: "" },
    ],
    // One row per dimension: { id, dimension, cells: { [optionId]: text }, analysis, conclusion }
    rows: [
      { id: "r1", dimension: "", cells: {}, analysis: "", conclusion: "" },
      { id: "r2", dimension: "", cells: {}, analysis: "", conclusion: "" },
      { id: "r3", dimension: "", cells: {}, analysis: "", conclusion: "" },
    ],
    // The overall conclusion, under the overall analysis
    conclusion: "",
  },
};
