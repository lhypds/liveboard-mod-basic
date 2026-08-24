/* The standing description sent with every Generate, so the model knows what it is
   writing before it reads the instruction the user typed. Model-facing, so it stays
   in English whatever language the card is showing, and it describes the *runtime*
   rather than the syntax: this document is not a page on the open web, it is one
   card on a wall, with no network and no origin of its own. Code that reaches for
   either won't run here, and the model has no other way to find that out. */
export const GENERATE_PROMPT = [
  "A self-contained HTML document rendered as a single card on a dashboard, inside a sandboxed iframe with no origin of its own.",
  "Inline every style and script it needs: no external stylesheet, font, image or script, and nothing over the network — fetch, XHR and WebSocket all fail, so build from what the document itself carries.",
  "localStorage and sessionStorage are present but are scratch space for one run, not storage: whatever they hold is gone when the card re-renders.",
  "The card is small and gets resized by hand, so fill 100% of the viewport at whatever size it is rather than laying out to a fixed pixel width, and stay usable when it is short.",
  "Base styles are already applied — Helvetica, 13px, dark text on white — so write only what the widget itself needs on top of them.",
  "The document meets the card edge to edge with no margin or padding of its own, so put any breathing room the widget wants inside its own elements rather than on body.",
  "Scrollbars are hidden everywhere in the card, so don't lay out around one and don't draw your own: content that overflows still scrolls to a wheel or a swipe.",
  "Uncaught errors are shown to the user and fed back for repair, so fail loudly rather than swallowing exceptions.",
].join(" ");

export const config = {
  i: "X",
  // The card is named for the glyph rather than for what it does, and the glyph is
  // the same in every language — see the README. The folder name stays ASCII `X`
  // because it is also the card's address (`/api/data/X`), which is validated
  // against [\w-]+ server-side.
  title: { en: "𝛘", ja: "𝛘", zh: "𝛘" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Runtime", ja: "実行環境", zh: "运行环境" },
      items: [
        {
          key: { en: "Isolation", ja: "分離", zh: "隔离" },
          value: {
            en: "Sandboxed iframe, allow-scripts only — no origin, no parent DOM",
            ja: "サンドボックス iframe（allow-scripts のみ）— オリジンなし、親 DOM に触れない",
            zh: "沙盒 iframe，仅 allow-scripts —— 无源，够不到父页面 DOM",
          },
        },
        {
          key: { en: "Network", ja: "ネットワーク", zh: "网络" },
          value: {
            en: "Unreachable — the document must carry everything it needs",
            ja: "到達不可 — 必要なものはすべて文書自身が持つ",
            zh: "不可用 —— 文档必须自带它需要的一切",
          },
        },
        {
          key: { en: "Written by", ja: "生成", zh: "生成方式" },
          value: {
            en: "The Generate button in this card's header",
            ja: "このカードのヘッダーにある生成ボタン",
            zh: "本卡片标题栏的生成按钮",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 28,
  h: 28,
  minW: 6,
  minH: 6,
  allowMultipleInstances: true,
  comp: {
    /* The whole widget, as one HTML document. Empty is the starting state: a card
       just added has nothing in it until the first Generate. */
    source: "",
    /* Sent with every Generate. Kept in comp rather than read from the constant
       above so a card can be given a narrower brief of its own from the Edit modal
       without touching the module. */
    prompt: GENERATE_PROMPT,
    /* Whether the source panel is open under the preview. Closed by default — the
       point of this card is the thing that runs, not the code behind it. */
    showSource: false,
    /* Whether a document that throws is sent back to be repaired without being
       asked. Capped at two consecutive attempts, see MAX_AUTO_FIX. */
    autoFix: true,
  },
};
