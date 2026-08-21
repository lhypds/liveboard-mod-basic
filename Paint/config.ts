export const config = {
  i: "Paint",
  title: { en: "Paint", ja: "ペイント", zh: "画板" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "About", ja: "概要", zh: "说明" },
      items: [
        {
          key: { en: "Drawing", ja: "描く", zh: "绘制" },
          value: {
            en: "Drag on the card to draw; pick a colour and a pen width in the toolbar",
            ja: "カード上をドラッグして描きます。色と線の太さはツールバーで選びます",
            zh: "在卡片上拖动即可绘制；在工具栏选择颜色与笔粗细",
          },
        },
        {
          key: { en: "Undo", ja: "取り消し", zh: "撤销" },
          value: {
            en: "Undo, Redo and Clear are in the toolbar; a Clear costs one Undo to take back",
            ja: "元に戻す／やり直す／クリアはツールバーにあり、クリアは元に戻すを1回で復元できます",
            zh: "撤销、重做与清除都在工具栏；清除后按一次撤销即可恢复",
          },
        },
        {
          key: { en: "Eraser", ja: "消しゴム", zh: "橡皮" },
          value: {
            en: "Cuts through the strokes under it, comp.eraserScale times the pen's width; the ring on the card is that width",
            ja: "下の線を削り取ります。太さはペンの comp.eraserScale 倍で、カード上の円がその太さです",
            zh: "擦除其下方的笔画，粗细为笔的 comp.eraserScale 倍；卡片上的圆圈即该粗细",
          },
        },
        {
          key: { en: "Storage", ja: "保存", zh: "存储" },
          value: {
            en: "Strokes are kept as fractions of the card's width, so the drawing scales with the card",
            ja: "線はカード幅に対する比率で保存されるため、絵はカードに合わせて拡縮します",
            zh: "笔画按卡片宽度的比例保存，因此画面随卡片缩放",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 24,
  h: 20,
  minW: 10,
  minH: 8,
  comp: {
    // Every stroke drawn on the card, oldest first: { c: colour or "" for the eraser, w: width,
    // p: [x, y, x, y, ...] }. Coordinates and width are fractions of the card's width rather than
    // pixels, so a resized card scales the drawing instead of cropping it.
    strokes: [],
    // The toolbar's current pick, kept here so a card reopens as the user left it
    color: "#334155",
    // Pen width in px, as drawn at the card's width at the time
    size: 3,
    erasing: false,
    // The eraser is this many times the pen's width
    eraserScale: 4,
  },
};
