export type DiffLine = {
  kind: "unchanged" | "added" | "deleted";
  text: string;
  left?: number;
  right?: number;
  noNewline: boolean;
};

export const MAX_TEXT_LENGTH = 512 * 1024;
export const MAX_LINES = 5000;

function lines(text: string): string[] {
  // Keep the terminator so adding a final newline remains a visible change.
  return text.replace(/\r\n?/g, "\n").match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function compareLines(leftText: string, rightText: string): DiffLine[] {
  if (leftText.length > MAX_TEXT_LENGTH || rightText.length > MAX_TEXT_LENGTH) {
    throw new Error("size");
  }
  const left = lines(leftText);
  const right = lines(rightText);
  if (left.length > MAX_LINES || right.length > MAX_LINES) throw new Error("size");

  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--;
    endRight--;
  }

  const height = endLeft - start;
  const width = endRight - start;
  // Bound time and memory for unrelated files; matching prefixes/suffixes cost no matrix space.
  if (height * width > 4_000_000) throw new Error("complexity");
  const stride = width + 1;
  const lcs = new Uint16Array((height + 1) * stride);
  for (let i = height - 1; i >= 0; i--) {
    for (let j = width - 1; j >= 0; j--) {
      lcs[i * stride + j] = left[start + i] === right[start + j]
        ? 1 + lcs[(i + 1) * stride + j + 1]
        : Math.max(lcs[(i + 1) * stride + j], lcs[i * stride + j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let leftNumber = 1;
  let rightNumber = 1;
  function append(kind: DiffLine["kind"], text: string) {
    result.push({
      kind,
      text: text.endsWith("\n") ? text.slice(0, -1) : text,
      left: kind === "added" ? undefined : leftNumber++,
      right: kind === "deleted" ? undefined : rightNumber++,
      noNewline: !text.endsWith("\n"),
    });
  }
  for (let i = 0; i < start; i++) append("unchanged", left[i]);
  let i = 0;
  let j = 0;
  while (i < height || j < width) {
    if (i < height && j < width && left[start + i] === right[start + j]) {
      append("unchanged", left[start + i++]);
      j++;
    } else if (i < height && (j === width || lcs[(i + 1) * stride + j] >= lcs[i * stride + j + 1])) {
      append("deleted", left[start + i++]);
    } else {
      append("added", right[start + j++]);
    }
  }
  for (let k = endLeft; k < left.length; k++) append("unchanged", left[k]);
  return result;
}
