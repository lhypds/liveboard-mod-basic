export const config = {
  i: "Compare",
  title: { en: "Compare", ja: "比較", zh: "比较" },
  refreshAgeMinutes: 0,
  info: [{
    title: { en: "About", ja: "概要", zh: "说明" },
    items: [{
      key: { en: "Files", ja: "ファイル", zh: "文件" },
      value: {
        en: "Drop UTF-8 code or text files on the left and right. The middle shows additions in green and deletions in red. Files stay in this tab and are cleared on reload. Limit: 512 KB and 5,000 lines per side.",
        ja: "左右にUTF-8のコード・テキストファイルをドロップ。中央に追加を緑、削除を赤で表示。ファイルはこのタブ内のみで、再読み込みで消去。各側512 KB・5,000行まで。",
        zh: "在左右两侧拖入 UTF-8 代码或文本文件。中间以绿色显示新增、红色显示删除。文件仅保留在此标签页，刷新后清空。每侧限 512 KB、5,000 行。",
      },
    }],
  }],
  x: 0,
  y: 0,
  w: 36,
  h: 24,
  minW: 12,
  minH: 14,
  allowMultipleInstances: true,
};
