import * as Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";

export type Language = "html" | "javascript" | "json" | "python";

const GRAMMARS: Record<Language, { grammar: Prism.Grammar; alias: string }> = {
  html: { grammar: Prism.languages.markup, alias: "markup" },
  javascript: { grammar: Prism.languages.javascript, alias: "javascript" },
  json: { grammar: Prism.languages.json, alias: "json" },
  python: { grammar: Prism.languages.python, alias: "python" },
};

export function highlight(source: string, language: Language): string {
  const { grammar, alias } = GRAMMARS[language];
  return Prism.highlight(source, grammar, alias);
}
