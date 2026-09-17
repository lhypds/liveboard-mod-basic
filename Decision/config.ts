export const config = {
  i: "Decision",
  title: { en: "Decision", ja: "意思決定", zh: "决策" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "About", ja: "概要", zh: "说明" },
      items: [
        {
          key: { en: "Background", ja: "背景", zh: "背景" },
          value: {
            en: "Under the question: your situation, priorities and constraints, which Generate tailors the sheet to",
            ja: "質問の下に、自分の状況・優先事項・制約を書きます。生成はこれに合わせて表を作ります",
            zh: "问题下方写自己的情况、优先事项和限制条件，生成时会据此调整表格内容",
          },
        },
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
            en: "One row per point of comparison: each option's pros and cons on it, then the analysis and the conclusion for that row",
            ja: "比較の観点ごとに1行。その観点での各選択肢の長所・短所に続けて、分析と結論を書きます",
            zh: "每个比较维度一行：各选项在该维度上的优缺点，然后是该维度的分析和结论",
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
            en: "The Generate button in the header fills the sheet from the question and background through simple-ai (sign in to an SC account first). The same question improves what is written; a new one starts over, keeping the background, and Ctrl+Z brings the old sheet back",
            ja: "ヘッダーの生成ボタンで、質問と背景から simple-ai が表を埋めます（先に SC アカウントにログイン）。同じ質問なら今の内容を改善し、違う質問なら背景を残して作り直します。Ctrl+Z で元に戻せます",
            zh: "标题栏的生成按钮通过 simple-ai 根据问题和背景填写表格（需先登录 SC 账号）。问题不变时完善已有内容，换了问题则保留背景重新生成，Ctrl+Z 可恢复原表",
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
    // The asker's situation, priorities and constraints, under the question
    background: "",
    // The overall analysis, under the table
    analysis: "",
    // The things being compared, one column each: { id, name }
    options: [
      { id: "o1", name: "" },
      { id: "o2", name: "" },
    ],
    // One row per dimension: { id, dimension, cells: { [optionId]: pros and cons }, analysis, conclusion }
    rows: [
      { id: "r1", dimension: "", cells: {}, analysis: "", conclusion: "" },
      { id: "r2", dimension: "", cells: {}, analysis: "", conclusion: "" },
      { id: "r3", dimension: "", cells: {}, analysis: "", conclusion: "" },
    ],
    // The overall conclusion, under the overall analysis
    conclusion: "",
  },
};
