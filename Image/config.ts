export const config = {
  i: "Image",
  title: { en: "Image", ja: "画像", zh: "图片" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "About", ja: "概要", zh: "说明" },
      items: [
        {
          key: { en: "Adding", ja: "追加", zh: "添加" },
          value: {
            en: "Drop an image on the card, or click it to choose a file",
            ja: "カードに画像をドロップするか、クリックしてファイルを選びます",
            zh: "将图片拖放到卡片上，或点击选择文件",
          },
        },
        {
          key: { en: "Storage", ja: "保存", zh: "存储" },
          value: {
            en: "Compressed to WebP, uploaded to the board; the card keeps only its URL",
            ja: "WebP に圧縮してボードへアップロードし、カードは URL だけを保持します",
            zh: "压缩为 WebP 后上传到看板，卡片只保存其 URL",
          },
        },
        {
          key: { en: "Quality", ja: "画質", zh: "画质" },
          value: {
            en: "comp.quality 0–1, comp.maxSize = longest edge in px (0 = keep original size)",
            ja: "comp.quality は 0〜1、comp.maxSize は長辺のピクセル数（0 は原寸のまま）",
            zh: "comp.quality 为 0–1，comp.maxSize 为最长边像素（0 表示保持原尺寸）",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 20,
  h: 16,
  minW: 6,
  minH: 6,
  comp: {
    // Filled in by the drop: the URL the board's image API handed back, plus what the picture
    // turned out to be. Never the bytes — a board is saved as JSON, and a data URL would ride
    // along in every save, export and sync.
    url: "",
    name: "",
    width: 0,
    height: 0,
    bytes: 0,
    // How the picture sits in the card: "contain" shows all of it, "cover" fills the card
    fit: "contain",
    // WebP encoder quality, 0-1
    quality: 0.85,
    // Longest edge in px; a larger image is scaled down before compressing. 0 = keep original size
    maxSize: 2560,
  },
};
