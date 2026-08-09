import type { Language } from "./highlight";

/* One indent level per language. Formatting only ever rewrites the leading
   whitespace of a line (and trims the trailing whitespace) — the code itself is
   never rearranged, so a bad guess can misalign but cannot corrupt. */
export const INDENT_WIDTH: Record<Language, number> = {
  html: 2,
  javascript: 2,
  json: 2,
  python: 4,
};

const OPENERS = "([{";
const CLOSERS = ")]}";
const TAB_STOP = 8;

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const RAW_TAGS = new Set(["script", "style", "pre", "textarea"]);

/* Words after which a `/` opens a regular expression rather than dividing. */
const REGEX_PRECEDERS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete",
  "void", "case", "do", "else", "yield", "await", "throw",
]);

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

function indentWidth(whitespace: string): number {
  let width = 0;
  for (const char of whitespace) width = char === "\t" ? width + TAB_STOP - (width % TAB_STOP) : width + 1;
  return width;
}

/* Move a line we deliberately do not re-indent — a wrapped tag, a continued
   expression — by the same amount its owning line moved. */
function shiftLine(line: string, delta: number): string {
  const whitespace = leadingWhitespace(line);
  const body = line.slice(whitespace.length).replace(/\s+$/, "");
  if (!body) return "";
  return " ".repeat(Math.max(0, indentWidth(whitespace) + delta)) + body;
}

/* --- JavaScript, CSS and loose JSON ------------------------------------- */

type ScannedLine = {
  /* The line with string, comment and regex bodies replaced by a placeholder,
     so only structural characters survive. */
  code: string;
  /* Opens inside a template literal: every byte must be preserved. */
  frozen: boolean;
  /* Opens inside a block comment: shift it, but do not re-indent it. */
  carried: boolean;
};

type Interpolation = { kind: "template" } | { kind: "interp"; braces: number };

function regexCanStart(emitted: string): boolean {
  const trimmed = emitted.replace(/\s+$/, "");
  if (!trimmed) return true;
  if (!/[\w$)\]"]$/.test(trimmed)) return true;
  const word = /[A-Za-z_$][\w$]*$/.exec(trimmed);
  return word !== null && REGEX_PRECEDERS.has(word[0]);
}

function scanJavaScript(source: string): ScannedLine[] {
  const scanned: ScannedLine[] = [];
  const nesting: Interpolation[] = [];
  let blockComment = false;
  let braces = 0;
  let emitted = "";

  for (const raw of source.split("\n")) {
    const line: ScannedLine = {
      code: "",
      frozen: nesting[nesting.length - 1]?.kind === "template",
      carried: blockComment,
    };
    scanned.push(line);

    const push = (char: string) => {
      line.code += char;
      emitted += char;
    };

    let index = 0;
    while (index < raw.length) {
      const char = raw[index];
      const next = raw[index + 1];

      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          push('"');
          index += 2;
        } else index += 1;
        continue;
      }

      const context = nesting[nesting.length - 1];
      if (context?.kind === "template") {
        if (char === "\\") index += 2;
        else if (char === "`") {
          nesting.pop();
          push('"');
          index += 1;
        } else if (char === "$" && next === "{") {
          braces += 1;
          nesting.push({ kind: "interp", braces });
          push("{");
          index += 2;
        } else index += 1;
        continue;
      }

      if (char === "/" && next === "/") break;
      if (char === "/" && next === "*") {
        blockComment = true;
        index += 2;
        continue;
      }
      if (char === '"' || char === "'") {
        index += 1;
        while (index < raw.length && raw[index] !== char) index += raw[index] === "\\" ? 2 : 1;
        index += 1;
        push('"');
        continue;
      }
      if (char === "`") {
        nesting.push({ kind: "template" });
        index += 1;
        continue;
      }
      if (char === "/" && regexCanStart(emitted)) {
        index += 1;
        let inClass = false;
        while (index < raw.length) {
          const inner = raw[index];
          if (inner === "\\") {
            index += 2;
            continue;
          }
          if (inner === "[") inClass = true;
          else if (inner === "]") inClass = false;
          else if (inner === "/" && !inClass) {
            index += 1;
            break;
          }
          index += 1;
        }
        while (index < raw.length && /[a-z]/.test(raw[index])) index += 1;
        push('"');
        continue;
      }

      if (char === "{") braces += 1;
      if (char === "}") {
        if (context?.kind === "interp" && context.braces === braces) nesting.pop();
        braces -= 1;
      }
      push(char);
      index += 1;
    }

    emitted += "\n";
  }

  return scanned;
}

/* A `case` label indents its body without a bracket of its own, so the indent
   stack tracks frames rather than a plain bracket count. */
type Frame = "bracket" | "switch" | "case";

function popFrame(stack: Frame[]) {
  while (stack[stack.length - 1] === "case") stack.pop();
  stack.pop();
}

function isCaseLabel(stack: Frame[], trimmed: string): boolean {
  if (!/^(case\s[^:]*:|default\s*:)/.test(trimmed)) return false;
  const top = stack[stack.length - 1];
  if (top === "switch") return true;
  return top === "case" && stack[stack.length - 2] === "switch";
}

/* Apply one line's structural characters to the stack and report the level the
   line itself belongs at: closers written before any other code pull it back. */
function levelFor(stack: Frame[], code: string, trimmed: string): number {
  let index = 0;
  while (index < code.length) {
    const char = code[index];
    if (char === " " || char === "\t") index += 1;
    else if (CLOSERS.includes(char)) {
      popFrame(stack);
      index += 1;
    } else break;
  }

  const label = isCaseLabel(stack, trimmed);
  if (label) while (stack[stack.length - 1] === "case") stack.pop();
  const level = stack.length;

  const opensSwitch = /\bswitch\s*\(/.test(trimmed);
  for (; index < code.length; index += 1) {
    const char = code[index];
    if (OPENERS.includes(char)) stack.push(char === "{" && opensSwitch ? "switch" : "bracket");
    else if (CLOSERS.includes(char)) popFrame(stack);
  }
  if (label) stack.push("case");
  return level;
}

function formatBracketed(source: string, unit: number): string {
  const rawLines = source.split("\n");
  const scanned = scanJavaScript(source);
  const pad = " ".repeat(unit);
  const stack: Frame[] = [];
  const formatted: string[] = [];
  let delta = 0;

  rawLines.forEach((raw, index) => {
    const { code, frozen, carried } = scanned[index];
    const trimmed = raw.trim();

    if (frozen) {
      levelFor(stack, code, trimmed);
      formatted.push(raw);
      return;
    }
    if (!trimmed) {
      levelFor(stack, code, trimmed);
      formatted.push("");
      return;
    }
    if (carried) {
      levelFor(stack, code, trimmed);
      formatted.push(shiftLine(raw, delta));
      return;
    }

    const level = levelFor(stack, code, trimmed);
    delta = level * unit - indentWidth(leadingWhitespace(raw));
    formatted.push(pad.repeat(level) + trimmed);
  });

  return formatted.join("\n");
}

/* --- Python -------------------------------------------------------------- */

type PythonLine = {
  /* Starts a logical line, so its own indentation carries the block level. */
  opensStatement: boolean;
  /* Opens inside a triple-quoted string: every byte must be preserved. */
  frozen: boolean;
};

function scanPython(source: string): PythonLine[] {
  const scanned: PythonLine[] = [];
  let triple: string | null = null;
  let depth = 0;
  let continued = false;

  for (const raw of source.split("\n")) {
    scanned.push({ opensStatement: triple === null && depth === 0 && !continued, frozen: triple !== null });

    let index = 0;
    let commented = false;
    while (index < raw.length) {
      const char = raw[index];

      if (triple) {
        if (raw.startsWith(triple, index)) {
          triple = null;
          index += 3;
        } else index += char === "\\" ? 2 : 1;
        continue;
      }
      if (char === "#") {
        commented = true;
        break;
      }
      if (char === '"' || char === "'") {
        const quoted = raw.slice(index, index + 3);
        if (quoted === '"""' || quoted === "'''") {
          triple = quoted;
          index += 3;
          continue;
        }
        index += 1;
        while (index < raw.length && raw[index] !== char) index += raw[index] === "\\" ? 2 : 1;
        index += 1;
        continue;
      }
      if (OPENERS.includes(char)) depth += 1;
      else if (CLOSERS.includes(char)) depth = Math.max(0, depth - 1);
      index += 1;
    }

    continued = triple === null && !commented && /\\$/.test(raw.replace(/\s+$/, ""));
  }

  return scanned;
}

/* Python has no brackets to count, so the author's own nesting is preserved and
   only the width of each level is normalised. */
function formatPython(source: string, unit: number): string {
  const rawLines = source.split("\n");
  const scanned = scanPython(source);
  const pad = " ".repeat(unit);
  const widths: number[] = [];
  const formatted: string[] = [];
  let delta = 0;

  rawLines.forEach((raw, index) => {
    const { opensStatement, frozen } = scanned[index];
    const trimmed = raw.trim();

    if (frozen) {
      formatted.push(raw);
      return;
    }
    if (!trimmed) {
      formatted.push("");
      return;
    }
    if (!opensStatement) {
      formatted.push(shiftLine(raw, delta));
      return;
    }

    const width = indentWidth(leadingWhitespace(raw));

    /* A comment sits wherever it was written without disturbing the block
       structure — the tokenizer ignores it, so a stray one must not open a
       level the following code would inherit. */
    if (trimmed.startsWith("#")) {
      let level = widths.length - 1;
      while (level > 0 && widths[level] > width) level -= 1;
      formatted.push(pad.repeat(Math.max(0, level)) + trimmed);
      return;
    }

    while (widths.length && widths[widths.length - 1] > width) widths.pop();
    if (!widths.length || widths[widths.length - 1] < width) widths.push(width);
    const level = widths.length - 1;
    delta = level * unit - width;
    formatted.push(pad.repeat(level) + trimmed);
  });

  return formatted.join("\n");
}

/* --- HTML ---------------------------------------------------------------- */

type HtmlLine = {
  startState: "text" | "tag" | "comment" | "raw";
  rawTag: string | null;
  /* Close tags written before anything else on the line, which pull it back. */
  leadingCloses: number;
  net: number;
};

function scanHtml(source: string): HtmlLine[] {
  const scanned: HtmlLine[] = [];
  let state: HtmlLine["startState"] = "text";
  let rawTag: string | null = null;
  let tagName = "";
  let tagIsClose = false;
  let tagTail = "";

  for (const raw of source.split("\n")) {
    const line: HtmlLine = { startState: state, rawTag, leadingCloses: 0, net: 0 };
    scanned.push(line);
    let seenContent = state === "tag";
    let index = 0;

    /* Record the finished tag's effect on the depth and report the raw-text
       element it opened, if any. */
    const closeTag = (): string | null => {
      const name = tagName.toLowerCase();
      if (tagIsClose) {
        if (!seenContent) line.leadingCloses += 1;
        line.net -= 1;
        return null;
      }
      seenContent = true;
      if (/\/\s*$/.test(tagTail) || VOID_TAGS.has(name)) return null;
      line.net += 1;
      return RAW_TAGS.has(name) ? name : null;
    };

    while (index < raw.length) {
      if (state === "comment") {
        const end = raw.indexOf("-->", index);
        if (end === -1) index = raw.length;
        else {
          state = "text";
          seenContent = true;
          index = end + 3;
        }
        continue;
      }

      if (state === "raw") {
        const match = new RegExp(`</\\s*${rawTag}\\s*>`, "i").exec(raw.slice(index));
        if (!match) {
          index = raw.length;
          continue;
        }
        const at = index + match.index;
        if (!raw.slice(0, at).trim()) line.leadingCloses += 1;
        line.net -= 1;
        state = "text";
        rawTag = null;
        index = at + match[0].length;
        continue;
      }

      if (state === "tag") {
        let closed = false;
        while (index < raw.length) {
          const char = raw[index];
          if (char === '"' || char === "'") {
            const end = raw.indexOf(char, index + 1);
            index = end === -1 ? raw.length : end + 1;
            continue;
          }
          if (char === ">") {
            index += 1;
            closed = true;
            const opened = closeTag();
            if (opened) {
              state = "raw";
              rawTag = opened;
            } else state = "text";
            break;
          }
          tagTail += char;
          index += 1;
        }
        if (!closed) break;
        continue;
      }

      const char = raw[index];
      if (char !== "<") {
        if (char !== " " && char !== "\t") seenContent = true;
        index += 1;
        continue;
      }
      if (raw.startsWith("<!--", index)) {
        state = "comment";
        index += 4;
        continue;
      }
      if (raw.startsWith("<!", index) || raw.startsWith("<?", index)) {
        const end = raw.indexOf(">", index);
        seenContent = true;
        index = end === -1 ? raw.length : end + 1;
        continue;
      }
      const opening = /^<\s*(\/?)([A-Za-z][\w:-]*)/.exec(raw.slice(index));
      if (!opening) {
        seenContent = true;
        index += 1;
        continue;
      }
      tagIsClose = opening[1] === "/";
      tagName = opening[2];
      tagTail = "";
      state = "tag";
      index += opening[0].length;
    }
  }

  return scanned;
}

function formatHtml(source: string, unit: number): string {
  const rawLines = source.split("\n");
  const scanned = scanHtml(source);
  const pad = " ".repeat(unit);
  const formatted: string[] = [];
  let depth = 0;
  let delta = 0;
  let index = 0;

  while (index < rawLines.length) {
    const raw = rawLines[index];
    const line = scanned[index];

    /* Everything between <script>/<style>/<pre> and its close belongs to the
       embedded language, not to the markup. */
    if (line.startState === "raw" && line.net === 0 && line.leadingCloses === 0) {
      let end = index;
      while (end < rawLines.length && scanned[end].startState === "raw" && scanned[end].net === 0) end += 1;
      const body = rawLines.slice(index, end);
      if (line.rawTag === "script" || line.rawTag === "style") {
        const base = pad.repeat(depth);
        for (const inner of formatBracketed(body.join("\n"), unit).split("\n")) formatted.push(inner ? base + inner : "");
      } else formatted.push(...body);
      index = end;
      continue;
    }

    /* Whitespace before </pre> and </textarea> is still part of the rendered
       value, so that closing line keeps the bytes it was written with. */
    if (line.startState === "raw" && (line.rawTag === "pre" || line.rawTag === "textarea")) {
      formatted.push(raw);
      depth = Math.max(0, depth + line.net);
      index += 1;
      continue;
    }

    if (line.startState === "tag" || line.startState === "comment") {
      formatted.push(shiftLine(raw, delta));
      depth = Math.max(0, depth + line.net);
      index += 1;
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      formatted.push("");
      depth = Math.max(0, depth + line.net);
      index += 1;
      continue;
    }

    const level = Math.max(0, depth - line.leadingCloses);
    delta = level * unit - indentWidth(leadingWhitespace(raw));
    formatted.push(pad.repeat(level) + trimmed);
    depth = Math.max(0, depth + line.net);
    index += 1;
  }

  return formatted.join("\n");
}

/* --- JSON ---------------------------------------------------------------- */

function isJsonSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/* Where the value starting at `start` ends. Containers end on the bracket that
   balances the first one; a bare scalar ends at the whitespace or comma after
   it. -1 means the value never closes, so the source isn't a value sequence. */
function findValueEnd(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let index = start;

  while (index < source.length) {
    const char = source[index];
    if (inString) {
      if (char === "\\") index += 2;
      else {
        if (char === '"') inString = false;
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return -1;
    } else if (depth === 0 && (isJsonSpace(char) || char === ",")) return index;
    index += 1;
  }

  return depth === 0 && !inString ? source.length : -1;
}

/* A log written one JSON value per line — JSONL, or values simply run together
   — is not itself JSON, but it is a list of JSON. Read it back as one, so the
   card can hand it to the formatter as the array it was always meant to be. */
function parseJsonSequence(source: string): unknown[] | null {
  const values: unknown[] = [];
  let index = 0;

  while (index < source.length) {
    // Separators between values are optional: newlines and commas both count
    while (index < source.length && (isJsonSpace(source[index]) || source[index] === ",")) index += 1;
    if (index >= source.length) break;
    const end = findValueEnd(source, index);
    if (end === -1) return null;
    try {
      values.push(JSON.parse(source.slice(index, end)));
    } catch {
      return null;
    }
    index = end;
  }

  return values.length ? values : null;
}

function formatJson(source: string, unit: number): string {
  try {
    return JSON.stringify(JSON.parse(source), null, unit);
  } catch {
    const values = parseJsonSequence(source);
    // One value only means the source was a lone value with something stray
    // around it, like a trailing comma — wrapping that would change what it says
    if (values) return JSON.stringify(values.length === 1 ? values[0] : values, null, unit);
    /* Half-written JSON still deserves tidy indentation. */
    return formatBracketed(source, unit);
  }
}

export function formatSource(source: string, language: Language): string {
  const unit = INDENT_WIDTH[language];
  if (language === "python") return formatPython(source, unit);
  if (language === "html") return formatHtml(source, unit);
  if (language === "json") return formatJson(source, unit);
  return formatBracketed(source, unit);
}
