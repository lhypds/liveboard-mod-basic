import * as Prism from "prismjs";
import "prismjs/components/prism-python";

export type Language = "html" | "javascript" | "python";

const GRAMMARS: Record<Language, { grammar: Prism.Grammar; alias: string }> = {
  html: { grammar: Prism.languages.markup, alias: "markup" },
  javascript: { grammar: Prism.languages.javascript, alias: "javascript" },
  python: { grammar: Prism.languages.python, alias: "python" },
};

export function highlight(source: string, language: Language): string {
  const { grammar, alias } = GRAMMARS[language];
  return Prism.highlight(source, grammar, alias);
}
