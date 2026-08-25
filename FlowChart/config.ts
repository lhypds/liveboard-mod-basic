export const config = {
  i: "FlowChart",
  title: { en: "Flow Chart", ja: "フローチャート", zh: "流程图" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "About", ja: "概要", zh: "说明" },
      items: [
        {
          key: { en: "Boxes", ja: "ボックス", zh: "方框" },
          value: {
            en: "Add one from the toolbar, drag it to move, double-click to type in it",
            ja: "ツールバーから追加し、ドラッグで移動、ダブルクリックで文字を入力します",
            zh: "从工具栏添加，拖动移动，双击输入文字",
          },
        },
        {
          key: { en: "Arrows", ja: "矢印", zh: "箭头" },
          value: {
            en: "Pull one from a box's edge handle onto another box, or press the arrow button and click the two boxes in turn",
            ja: "ボックス縁のハンドルから他のボックスへ引くか、矢印ボタンを押して2つのボックスを順にクリックします",
            zh: "从方框边缘的手柄拉到另一个方框，或按箭头按钮后依次点击两个方框",
          },
        },
        {
          key: { en: "Tab", ja: "Tab", zh: "Tab" },
          value: {
            en: "Adds the next box and draws an arrow from the selected one, so a chain is typed rather than drawn",
            ja: "次のボックスを追加し、選択中のボックスから矢印を引きます。描かずに打って繋げられます",
            zh: "添加下一个方框并从选中方框引出箭头，链条可以打字而非绘制",
          },
        },
        {
          key: { en: "Keys", ja: "キー", zh: "按键" },
          value: {
            en: "Enter edits the selected box, Delete removes the selection, Escape drops it",
            ja: "Enter で選択中のボックスを編集、Delete で削除、Escape で選択解除",
            zh: "Enter 编辑选中方框，Delete 删除所选，Escape 取消选择",
          },
        },
        {
          key: { en: "Storage", ja: "保存", zh: "存储" },
          value: {
            en: "An arrow keeps only the two box ids, never a line, so a box carries its arrows with it wherever it is dragged",
            ja: "矢印は線ではなく2つのボックス ID だけを保持するため、ボックスをどこへ動かしても矢印が付いてきます",
            zh: "箭头只保存两个方框的 id 而非线条，因此方框拖到哪里箭头都跟着走",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 26,
  h: 22,
  minW: 10,
  minH: 8,
  allowMultipleInstances: true,
  comp: {
    // Every box on the chart: { id, x, y, w, h, text }. Positions are plain px in the
    // chart's own space rather than fractions of the card's width the way Paint keeps its
    // strokes — a box holds text, and text does not scale with the card it sits in. A chart
    // that outgrows its card scrolls instead.
    boxes: [],
    // Every arrow: { id, from, to }, naming the boxes at its two ends. No coordinates: the
    // line is worked out from where the boxes are each time it is drawn, which is what makes
    // a dragged box take its arrows along.
    arrows: [],
  },
};
