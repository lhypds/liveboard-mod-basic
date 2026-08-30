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
          key: { en: "Several at once", ja: "まとめて選ぶ", zh: "多选" },
          value: {
            en: "Drag on the empty sheet to draw a dashed box round several; dragging any one of them then moves the whole group",
            ja: "空白部分をドラッグすると破線の枠で複数を囲めます。そのうち1つをドラッグすれば全体が動きます",
            zh: "在空白处拖动可用虚线框选中多个；再拖动其中任意一个即可整组移动",
          },
        },
        {
          key: { en: "Size", ja: "サイズ", zh: "尺寸" },
          value: {
            en: "A picked box shows a square at each corner; drag one to resize it, holding the opposite corner where it is",
            ja: "選択中のボックスは四隅に四角が出ます。ドラッグでサイズを変更し、対角はその場に留まります",
            zh: "选中的方框四角会出现小方块；拖动即可调整大小，对角保持不动",
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
            en: "Adds the next box and draws an arrow from the selected one, so a chain is built without the pointer; a new box is selected rather than opened, so it can be dragged straight away",
            ja: "次のボックスを追加し、選択中のボックスから矢印を引きます。ポインタなしで連鎖を作れます。新しいボックスは選択されるだけで開かないため、すぐドラッグできます",
            zh: "添加下一个方框并从选中方框引出箭头，无需指针即可连成链条；新方框只被选中而不进入编辑，因此可以立即拖动",
          },
        },
        {
          key: { en: "Keys", ja: "キー", zh: "按键" },
          value: {
            en: "N adds a box, D removes the selection (as Delete does), Enter edits the one selected box, Escape drops the selection",
            ja: "N でボックス追加、D で選択を削除（Delete と同じ）、Enter で選択中の1つを編集、Escape で選択解除",
            zh: "N 添加方框，D 删除所选（同 Delete），Enter 编辑选中的那一个，Escape 取消选择",
          },
        },
        {
          key: { en: "Undo and copy", ja: "元に戻す・コピー", zh: "撤销与复制" },
          value: {
            en: "Ctrl+Z undoes and Ctrl+Shift+Z redoes, even while a label is being typed; Ctrl+C copies the selected boxes with the arrows between them and Ctrl+V pastes them a little below, picked and ready to drag (Cmd on a Mac)",
            ja: "Ctrl+Z で元に戻し、Ctrl+Shift+Z でやり直します。文字入力中でも効きます。Ctrl+C は選択中のボックスとその間の矢印をコピーし、Ctrl+V は少し下にずらして貼り付け、そのまま選択された状態でドラッグできます（Mac は Cmd）",
            zh: "Ctrl+Z 撤销，Ctrl+Shift+Z 重做，输入文字时同样有效；Ctrl+C 复制选中的方框及其之间的箭头，Ctrl+V 稍向下偏移粘贴，粘贴后即为选中状态可直接拖动（Mac 用 Cmd）",
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
