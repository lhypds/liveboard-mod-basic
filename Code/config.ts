export const config = {
  i: "Code",
  title: { en: "Code", ja: "コード", zh: "代码" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Runtime", ja: "実行環境", zh: "运行环境" },
      items: [
        {
          key: { en: "Languages", ja: "言語", zh: "语言" },
          value: { en: "HTML, JavaScript, Python", ja: "HTML、JavaScript、Python", zh: "HTML、JavaScript、Python" },
        },
        {
          key: { en: "Isolation", ja: "分離", zh: "隔离" },
          value: {
            en: "Sandboxed iframe and Web Workers",
            ja: "サンドボックス iframe と Web Worker",
            zh: "沙盒 iframe 与 Web Worker",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 24,
  h: 24,
  minW: 12,
  minH: 14,
  allowMultipleInstances: true,
  comp: {
    language: "html",
    mode: "preview",
    sources: {
      html: "<!doctype html>\n<html>\n  <body>\n    <h1>Hello, Liveboard!</h1>\n  </body>\n</html>",
      javascript: "console.log(\"Hello, Liveboard!\");",
      python: "print(\"Hello, Liveboard!\")",
    },
  },
};
