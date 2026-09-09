import assert from "node:assert/strict";
import test from "node:test";
import { compareLines, MAX_LINES, MAX_TEXT_LENGTH } from "./diff.ts";

test("replacements retain context and both line numbers", () => {
  const rows = compareLines("start\nold\nend\n", "start\nnew\nend\n");
  assert.deepEqual(rows.map(({ kind, text, left, right }) => [kind, text, left, right]), [
    ["unchanged", "start", 1, 1],
    ["deleted", "old", 2, undefined],
    ["added", "new", undefined, 2],
    ["unchanged", "end", 3, 3],
  ]);
});

test("empty files, blank lines and insertions/deletions at either end", () => {
  assert.deepEqual(compareLines("", ""), []);
  assert.deepEqual(compareLines("", "\n").map((row) => row.kind), ["added"]);
  assert.deepEqual(compareLines("a\n", "").map((row) => row.kind), ["deleted"]);
  assert.deepEqual(compareLines("middle\n", "first\nmiddle\nlast\n").map((row) => row.kind), ["added", "unchanged", "added"]);
  assert.deepEqual(compareLines("first\nmiddle\nlast\n", "middle\n").map((row) => row.kind), ["deleted", "unchanged", "deleted"]);
});

test("normalizes line endings but preserves final newline and whitespace differences", () => {
  assert.ok(compareLines("a\r\nb\r\n", "a\nb\n").every((row) => row.kind === "unchanged"));
  const rows = compareLines("a", "a\n");
  assert.deepEqual(rows.map((row) => [row.kind, row.noNewline]), [["deleted", true], ["added", false]]);
  assert.deepEqual(compareLines(" a\n", "a\n").map((row) => row.kind), ["deleted", "added"]);
});

test("bounds large inputs and unrelated changes while accepting long shared context", () => {
  assert.throws(() => compareLines("x".repeat(MAX_TEXT_LENGTH + 1), ""), /size/);
  assert.throws(() => compareLines("\n".repeat(MAX_LINES + 1), ""), /size/);
  assert.throws(() => compareLines("a\n".repeat(2001), "b\n".repeat(2001)), /complexity/);
  const shared = "same\n".repeat(4999);
  assert.equal(compareLines(shared + "a\n", shared + "b\n").filter((row) => row.kind !== "unchanged").length, 2);
});

test("repeated lines produce minimal edits and reconstruct both inputs", () => {
  let seed = 19;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let trial = 0; trial < 300; trial++) {
    const a = Array.from({ length: random() % 12 }, () => `${random() % 4}\n`);
    const b = Array.from({ length: random() % 12 }, () => `${random() % 4}\n`);
    const rows = compareLines(a.join(""), b.join(""));
    const restore = (kind) => rows.filter((row) => row.kind !== kind).map((row) => row.text + (row.noNewline ? "" : "\n")).join("");
    assert.equal(restore("added"), a.join(""));
    assert.equal(restore("deleted"), b.join(""));
    // Independent edit-distance oracle for small inputs.
    const costs = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) costs[i][0] = i;
    for (let j = 0; j <= b.length; j++) costs[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        costs[i][j] = a[i - 1] === b[j - 1] ? costs[i - 1][j - 1] : 1 + Math.min(costs[i - 1][j], costs[i][j - 1]);
      }
    }
    assert.equal(rows.filter((row) => row.kind !== "unchanged").length, costs[a.length][b.length]);
  }
});
