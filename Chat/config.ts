export const config = {
  i: "Chat",
  title: { en: "Chat", ja: "チャット", zh: "聊天" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Data", ja: "データ", zh: "数据" },
      items: [
        {
          key: { en: "Backend", ja: "バックエンド", zh: "后端" },
          value: {
            en: "simple-ai-chat CLI (sc), over the sc bridge at VITE_SC_BRIDGE_URL",
            ja: "simple-ai-chat CLI（sc）— VITE_SC_BRIDGE_URL の sc ブリッジ経由",
            zh: "simple-ai-chat CLI（sc），经 VITE_SC_BRIDGE_URL 的 sc 桥接服务",
          },
        },
        {
          key: { en: "Account", ja: "アカウント", zh: "账号" },
          value: {
            en: "Whoever the CLI is logged in as on the bridge; `:login <user> <password>` to change",
            ja: "ブリッジ上で CLI がログイン中のユーザー。変更は `:login <user> <password>`",
            zh: "桥接服务上 CLI 已登录的用户；用 `:login <user> <password>` 切换",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 20,
  h: 24,
  minW: 10,
  minH: 12,
  allowMultipleInstances: true,
  comp: {
    // Which `sc` process on the bridge this card owns. Generated on first use.
    bridgeSession: "",
    // The simple-ai session id — the conversation itself. Kept so a restarted CLI
    // can be pointed back at it (`:session attach`) instead of starting over.
    scSession: "",
    // Model the CLI last reported, used for the prompt after a refresh.
    model: "",
    // The terminal scrollback, so a reload shows the session before the CLI is even up.
    terminal: "",
    // Scrollback longer than this is trimmed from the top (0 = keep everything).
    maxChars: 20000,
  },
};
