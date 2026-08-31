import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./flowchart.module.css";

type Lang = "en" | "ja" | "zh";

type Strings = {
  box: string;
  arrow: string;
  dash: string;
  importMermaid: string;
  exportMermaid: string;
  undo: string;
  redo: string;
  remove: string;
  clear: string;
};

const STRINGS: Record<Lang, Strings> = {
  en: {
    box: "Add box",
    arrow: "Draw arrow",
    dash: "Dashed arrow",
    importMermaid: "Import",
    exportMermaid: "Export",
    undo: "Undo",
    redo: "Redo",
    remove: "Delete selected",
    clear: "Clear",
  },
  ja: {
    box: "ボックス追加",
    arrow: "矢印を引く",
    dash: "破線の矢印",
    importMermaid: "インポート",
    exportMermaid: "エクスポート",
    undo: "元に戻す",
    redo: "やり直す",
    remove: "選択を削除",
    clear: "クリア",
  },
  zh: {
    box: "添加方框",
    arrow: "画箭头",
    dash: "虚线箭头",
    importMermaid: "导入",
    exportMermaid: "导出",
    undo: "撤销",
    redo: "重做",
    remove: "删除所选",
    clear: "清除",
  },
};

/** A new box, in px. Wide enough for a short label at the size the text is drawn. */
const BOX_W = 120;
const BOX_H = 48;

/** Imported labels can be longer than a hand-drawn starter box. Keep them readable, not enormous. */
const IMPORT_MAX_W = 260;
const TEXT_PX = 12;
const TEXT_LINE = 17;
const TEXT_PAD_X = 14;
const TEXT_PAD_Y = 10;

/** The space Tab leaves between a box and the one it adds beside it. */
const GAP = 40;

/** A dragged box lands on this grid, so a chart drawn by hand still lines up. */
const GRID = 10;

/** Blank space kept past the furthest box, so there is always somewhere to drag one to. */
const PAD = 20;

/** A press that travels less than this is a click on a box, not a drag of it. */
const SLOP = 4;

/** How far back Undo reaches, in edits. */
const MAX_HISTORY = 100;

/**
 * How far down and right a pasted copy lands from what it was copied from. Two grid cells, so the
 * copy sits clear of the original rather than exactly on top of it, and still on the grid.
 */
const PASTE_STEP = GRID * 2;

/* The only ink on the card. Nothing here is marked by a second colour — see the selection rule in
   the stylesheet for what a picked box does instead. */
const INK = "#0f172a";

/**
 * What a picked arrow's hairline thickens to. A shade over the 1px every other arrow is drawn at:
 * a box says it is picked by putting its handles out, and an arrow, having no corners to put any
 * on, has only its own weight to say it with — but it is still one line among a chart of them, and
 * a line drawn at twice the others' weight reads as a different kind of arrow rather than as the
 * same one, picked.
 */
const PICKED_STROKE = 1.5;

/**
 * How far back from a turn a wire starts rounding it. Small against the gap between two boxes, so
 * a corner reads as a corner that has been eased rather than as a curve.
 */
const ELBOW = 8;

/**
 * How far past a box a wire is taken before it turns, in the one case where there is no room
 * between the two boxes to turn in — see {@link route}.
 */
const STUB = 20;

/**
 * The dash a dashed arrow is drawn with. Longer than the one the arrow being dragged out is drawn
 * with (`.live` in the stylesheet), which is the only other broken line on the sheet: the two mean
 * quite different things — one is a weaker link, the other is a link that is not there yet — and
 * the second is only ever on screen while a pointer is down, so they are never side by side.
 */
const DASH = "6 4";

/** Where a box's four link handles sit, as percentages of its own box. */
const PORTS = [
  { k: "t", x: 50, y: 0 },
  { k: "r", x: 100, y: 50 },
  { k: "b", x: 50, y: 100 },
  { k: "l", x: 0, y: 50 },
];

/**
 * The four corners a box is resized by. `k` names the two edges that corner moves — the other two
 * stay where they are, which is the whole of the arithmetic in {@link resized}.
 */
const CORNERS = [
  { k: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { k: "ne", x: 100, y: 0, cursor: "nesw-resize" },
  { k: "se", x: 100, y: 100, cursor: "nwse-resize" },
  { k: "sw", x: 0, y: 100, cursor: "nesw-resize" },
];

/** How small a box can be dragged down to. Both on the grid, so a resize lands on it. */
const MIN_W = 60;
const MIN_H = 30;

/** One box on the chart, as it is kept in the card's config. See `config.ts`. */
type Box = { id: string; x: number; y: number; w: number; h: number; text: string };

/**
 * One arrow, named by the boxes at its two ends. Never by coordinates — see `config.ts`. `dashed`
 * is left off a solid arrow rather than written false: most arrows on a chart are solid, and every
 * one of them rides along in every board save.
 */
type Arrow = { id: string; from: string; to: string; dashed?: boolean };

type Chart = { boxes: Box[]; arrows: Arrow[] };

type Point = { x: number; y: number };

type Comp = {
  boxes?: unknown;
  arrows?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

type GenerateTarget = {
  content: () => string;
  prompt: string;
  onGenerated: (next: string) => void;
  onDone?: (text: string) => void;
  onBusy?: (busy: boolean) => void;
};

const GENERATE_PROMPT =
  "Generate Mermaid flowchart code for this Flow Chart card. Return only a complete Mermaid flowchart or graph definition, no markdown fences or explanation. Use readable node labels and directed arrows: --> for a plain link, and -.-> for one that is optional, conditional or otherwise weaker. Preserve any useful existing Mermaid structure unless the instruction asks to replace it.";

/**
 * What the toolbar's Delete and the Delete key act on. Boxes come as a list because a marquee
 * picks up however many it is dragged over; an arrow is only ever picked one at a time, since
 * there is nothing to do to several of them at once that Delete does not already do. Session
 * state, never saved.
 */
type Selection = { kind: "boxes"; ids: string[] } | { kind: "arrow"; id: string };

/**
 * The boxes being dragged right now — one, or the whole picked group if the press landed on a box
 * already in it. `from` is where each of them was when the press landed and `dx`,`dy` is the one
 * offset applied to all, so a group keeps its shape exactly and a drag that comes back to where it
 * started leaves every box where it was.
 */
type Drag = {
  pointerId: number;
  from: Record<string, Point>;
  /** How far left and up the group can go before its leftmost or topmost box leaves the sheet. */
  minX: number;
  minY: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
};

/** The dashed box being dragged over the sheet to pick up everything under it. */
type Marquee = { pointerId: number; x0: number; y0: number; x: number; y: number; active: boolean };

/**
 * A box being resized right now. `start` is the box as the corner was taken hold of, so every
 * move is worked out from that rather than from the last one — a drag that comes back to where it
 * began leaves the box exactly as it was, with no rounding piled up along the way.
 */
type Resize = {
  pointerId: number;
  id: string;
  corner: string;
  start: Box;
  startX: number;
  startY: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * An arrow being drawn right now. `pointerId` is the pointer dragging it out of a handle, or
 * null in arrow mode, where the line follows the pointer until the second box is clicked.
 */
type Link = { pointerId: number | null; from: string; x: number; y: number };

/**
 * What Ctrl+C last took: the picked boxes and whichever arrows had both ends among them. Held
 * outside the component rather than in it, so a chart copied out of one card can be pasted into
 * another — two of these cards share a board. Never saved; a reload starts with nothing copied.
 */
let clipboard: Chart | null = null;

/** How many times that has been pasted, so a second paste does not land on top of the first. */
let pasteCount = 0;

// comp is free-form and can be hand-edited in the Edit modal, so nothing read out of it is trusted
function isBox(value: unknown): value is Box {
  const box = value as Box | null;
  if (!box || typeof box !== "object") return false;
  if (typeof box.id !== "string" || !box.id || typeof box.text !== "string") return false;
  for (const n of [box.x, box.y, box.w, box.h]) if (typeof n !== "number" || !Number.isFinite(n)) return false;
  return box.w > 0 && box.h > 0;
}

function isArrow(value: unknown): value is Arrow {
  const arrow = value as Arrow | null;
  if (!arrow || typeof arrow !== "object") return false;
  if (arrow.dashed !== undefined && typeof arrow.dashed !== "boolean") return false;
  return typeof arrow.id === "string" && !!arrow.id && typeof arrow.from === "string" && typeof arrow.to === "string";
}

function readChart(comp: Comp | undefined): Chart {
  const boxes = Array.isArray(comp?.boxes) ? comp.boxes.filter(isBox) : [];
  const ids = new Set(boxes.map((box) => box.id));
  const arrows = Array.isArray(comp?.arrows) ? comp.arrows.filter(isArrow) : [];
  return {
    boxes,
    // An arrow to a box that is gone has nothing to draw itself between, and one from a box to
    // itself has no length; both would sit in every save as dead weight
    arrows: arrows.filter((arrow) => arrow.from !== arrow.to && ids.has(arrow.from) && ids.has(arrow.to)),
  };
}

/** Ids are short and sequential rather than random: they ride along in every board save. */
function nextId(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function snapUp(value: number): number {
  return Math.ceil(value / GRID) * GRID;
}

function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Where the line from the box's centre towards `to` crosses the box's own border. Used by the
 * arrow being dragged out of a handle, which has a pointer at its far end rather than a second
 * box, and so has no sides to square itself up against — the finished arrows are routed by
 * {@link route}.
 */
function border(box: Box, to: Point): Point {
  const from = center(box);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return from;
  // How far along the line each of the two edge pairs is reached; the nearer one is the border
  const toSide = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const toEnd = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const scale = Math.min(toSide, toEnd);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/**
 * The corners an arrow turns on its way from one box's border to the other's. Every segment runs
 * along an axis, so a chart of them reads as wiring rather than as string pulled taut between
 * centres — and two boxes in a column are joined by a line straight down instead of one leaning
 * off to whichever of them is wider.
 *
 * Which sides it leaves and enters by is decided by where the air between the two boxes is: a box
 * with clear space under it is left by the bottom and entered by the top, and the turn is made
 * half way down that space, where it is furthest from both. Ties go to the vertical, which is the
 * way a flowchart is read. This is worked out from the boxes every time the chart is drawn, so a
 * box that moves drags its arrows along — and re-routes them — without any of them being touched.
 */
function route(from: Box, to: Box): Point[] {
  const a = center(from);
  const b = center(to);
  const down = b.y >= a.y;
  const right = b.x >= a.x;
  // The space between the two facing edges, on the side the target actually lies. Negative where
  // the boxes overlap on that axis, which is what rules the axis out.
  const vGap = down ? to.y - (from.y + from.h) : from.y - (to.y + to.h);
  const hGap = right ? to.x - (from.x + from.w) : from.x - (to.x + to.w);

  if (vGap > 0 && vGap >= hGap) {
    const y0 = down ? from.y + from.h : from.y;
    const y1 = down ? to.y : to.y + to.h;
    const mid = (y0 + y1) / 2;
    return [
      { x: a.x, y: y0 },
      { x: a.x, y: mid },
      { x: b.x, y: mid },
      { x: b.x, y: y1 },
    ];
  }

  if (hGap > 0) {
    const x0 = right ? from.x + from.w : from.x;
    const x1 = right ? to.x : to.x + to.w;
    const mid = (x0 + x1) / 2;
    return [
      { x: x0, y: a.y },
      { x: mid, y: a.y },
      { x: mid, y: b.y },
      { x: x1, y: b.y },
    ];
  }

  // Overlapping, or touching: there is no air between the pair of them to turn in, so the wire is
  // taken out past both on the side the target leans to and brought back in on that same side of
  // it. Never a zero-length turn, whatever the two boxes are doing to each other.
  const x0 = right ? from.x + from.w : from.x;
  const x1 = right ? to.x + to.w : to.x;
  const out = right ? Math.max(x0, x1) + STUB : Math.min(x0, x1) - STUB;
  return [
    { x: x0, y: a.y },
    { x: out, y: a.y },
    { x: out, y: b.y },
    { x: x1, y: b.y },
  ];
}

/** Whether two of a route's corners are near enough to the same place to be one corner. */
function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

/**
 * The route with the corners that are not corners taken out: the ones a box's centre lining up
 * with the other's collapses onto each other, and the ones left sitting in the middle of a
 * straight run. Both would otherwise be rounded by {@link elbowPath} as if they were turns, which
 * puts a dent in a line that never leaves its axis.
 */
function corners(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && same(last.x, point.x) && same(last.y, point.y)) continue;
    out.push(point);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const [before, at, after] = [out[i - 1], out[i], out[i + 1]];
    const straight = (same(before.x, at.x) && same(at.x, after.x)) || (same(before.y, at.y) && same(at.y, after.y));
    if (straight) out.splice(i, 1);
  }
  return out;
}

/**
 * The route as an SVG path, each turn eased into a quarter-circle of radius `r`. The radius is cut
 * down to half of the shorter of the two segments meeting at the turn, so a corner between two
 * short segments rounds by as much as there is room for rather than overrunning the next one.
 */
function elbowPath(points: Point[], r: number): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [before, at, after] = [points[i - 1], points[i], points[i + 1]];
    const inLen = Math.hypot(at.x - before.x, at.y - before.y);
    const outLen = Math.hypot(after.x - at.x, after.y - at.y);
    const cut = Math.min(r, inLen / 2, outLen / 2);
    // Under half a pixel there is nothing to see in the curve, and its control point is the corner
    if (cut < 0.5) {
      d += `L${at.x} ${at.y}`;
      continue;
    }
    const from = { x: at.x + ((before.x - at.x) / inLen) * cut, y: at.y + ((before.y - at.y) / inLen) * cut };
    const to = { x: at.x + ((after.x - at.x) / outLen) * cut, y: at.y + ((after.y - at.y) / outLen) * cut };
    d += `L${from.x} ${from.y}Q${at.x} ${at.y} ${to.x} ${to.y}`;
  }
  const last = points[points.length - 1];
  return `${d}L${last.x} ${last.y}`;
}

function hits(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/** The marquee as a rectangle, whichever way round it was dragged out. */
function marqueeRect(m: Marquee): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(m.x0, m.x),
    y: Math.min(m.y0, m.y),
    w: Math.abs(m.x - m.x0),
    h: Math.abs(m.y - m.y0),
  };
}

/**
 * Whether the box overlaps the rectangle at all. Touching is enough — a marquee that had to
 * swallow a box whole would mean drawing round the far corners of a chart to pick up its middle.
 */
function touches(box: Box, r: { x: number; y: number; w: number; h: number }): boolean {
  return box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y;
}

/** Whether a box put down at `spot` would land on top of an existing one. */
function covers(box: Box, spot: Point): boolean {
  return spot.x < box.x + box.w && spot.x + BOX_W > box.x && spot.y < box.y + box.h && spot.y + BOX_H > box.y;
}

/**
 * The box a corner drag has made of `start`, having moved it by `dx`,`dy`. The two edges the
 * corner does not name are held exactly where they were, and the two it does are snapped to the
 * grid and stopped at the minimum — so a corner pulled past its opposite edge stops there rather
 * than turning the box inside out.
 */
function resized(start: Box, corner: string, dx: number, dy: number): { x: number; y: number; w: number; h: number } {
  const west = corner.includes("w");
  const north = corner.includes("n");
  // The edges that stay put
  const fixedX = west ? start.x + start.w : start.x;
  const fixedY = north ? start.y + start.h : start.y;

  let movedX = snap((west ? start.x : start.x + start.w) + dx);
  let movedY = snap((north ? start.y : start.y + start.h) + dy);
  movedX = west ? Math.max(0, Math.min(movedX, fixedX - MIN_W)) : Math.max(movedX, fixedX + MIN_W);
  movedY = north ? Math.max(0, Math.min(movedY, fixedY - MIN_H)) : Math.max(movedY, fixedY + MIN_H);

  return {
    x: Math.min(fixedX, movedX),
    y: Math.min(fixedY, movedY),
    w: Math.abs(fixedX - movedX),
    h: Math.abs(fixedY - movedY),
  };
}

/** `x`,`y` if nothing is already there, otherwise the next free row under it. */
function freeSpot(boxes: Box[], x: number, y: number): Point {
  const spot = { x: Math.max(0, snap(x)), y: Math.max(0, snap(y)) };
  // Each pass clears at least one box and there are finitely many, so this always ends
  while (boxes.some((box) => covers(box, spot))) spot.y = snap(spot.y + BOX_H + GAP);
  return spot;
}

function cleanMermaidLabel(label: string): string {
  return label
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
}

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width += TEXT_PX * 0.35;
    else if (/[A-Z0-9]/.test(char)) width += TEXT_PX * 0.68;
    else if (/[il.,:;|!']/i.test(char)) width += TEXT_PX * 0.35;
    else if (/[^\x00-\x7F]/.test(char)) width += TEXT_PX;
    else width += TEXT_PX * 0.58;
  }
  return width;
}

/**
 * The width a label would like to have, before the column settles on one width for all of them.
 * Floored at the width of a box added by hand, so a one-word node is still a box rather than a
 * chip, and capped, so a sentence is wrapped rather than drawn as one very long line.
 */
function importedBoxWidth(text: string): number {
  const longest = Math.max(...(text || " ").split(/\r?\n/).map(textWidth));
  return snapUp(Math.max(BOX_W, Math.min(IMPORT_MAX_W, Math.ceil(longest + TEXT_PAD_X))));
}

/** How tall a box has to be for its label once that label has wrapped inside a box `w` wide. */
function importedBoxHeight(text: string, w: number): number {
  const innerW = Math.max(1, w - TEXT_PAD_X);
  const lines = (text || " ").split(/\r?\n/);
  const lineCount = lines.reduce((count, line) => count + Math.max(1, Math.ceil(textWidth(line || " ") / innerW)), 0);
  return snapUp(Math.max(BOX_H, Math.ceil(lineCount * TEXT_LINE + TEXT_PAD_Y)));
}

/**
 * The order the imported nodes are stacked in, top to bottom. A node is only placed once
 * everything pointing into it has been, so every arrow that can point down the column does, and
 * the chart reads in the order the flow runs.
 *
 * Which of the nodes that are ready goes next is what keeps a branching chart legible in one
 * column: a successor of the node just placed wins, so a chain stays together and each of its
 * arrows has only the gap between two boxes to cross. Failing that, the earliest node in the file,
 * so a chart with several starts is stacked the way it was written. Anything still not ready when
 * that runs out is in a cycle and goes on the end in file order — one of its arrows has to point
 * back up the column whatever is done with it.
 */
function orderNodes(ids: string[], edges: Array<{ from: string; to: string }>): string[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const order: string[] = [];
  const placed = new Set<string>();
  const ready = new Set(ids.filter((id) => !incoming.get(id)));
  let last: string | null = null;

  while (ready.size) {
    const next: string =
      (last && (outgoing.get(last) ?? []).find((id) => ready.has(id))) ||
      [...ready].reduce((best, id) => ((rank.get(id) ?? 0) < (rank.get(best) ?? 0) ? id : best));
    ready.delete(next);
    order.push(next);
    placed.add(next);
    last = next;
    for (const to of outgoing.get(next) ?? []) {
      const left = (incoming.get(to) ?? 1) - 1;
      incoming.set(to, left);
      if (left === 0) ready.add(to);
    }
  }

  for (const id of ids) if (!placed.has(id)) order.push(id);
  return order;
}

function readMermaidNode(raw: string): { id: string; text?: string } | null {
  const token = raw
    .trim()
    .replace(/^\|[^|]*\|\s*/, "")
    .replace(/;$/, "")
    .trim();
  const match = token.match(/^([A-Za-z0-9_-]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?/);
  if (!match) return null;
  return {
    id: match[1],
    text: [match[2], match[3], match[4]].find((label) => label !== undefined),
  };
}

function chartFromMermaid(source: string): Chart {
  const nodes = new Map<string, string>();
  const edges: Array<{ from: string; to: string; dashed: boolean }> = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/%%.*$/, "").trim();
    if (!line || /^(flowchart|graph)\b/i.test(line)) continue;

    // The link itself is captured rather than skipped over: Mermaid's dotted forms are the ones
    // with a stop in them, and they are what a dashed arrow on this card is written as
    const edge = line.match(/^(.*?)\s*(-\.+->|-\.+-|-{2,}>|-{3,}|={2,}>|={3,})\s*(.*?)$/);
    if (edge) {
      const from = readMermaidNode(edge[1]);
      const to = readMermaidNode(edge[3]);
      if (!from || !to || from.id === to.id) continue;
      nodes.set(from.id, cleanMermaidLabel(from.text ?? nodes.get(from.id) ?? from.id));
      nodes.set(to.id, cleanMermaidLabel(to.text ?? nodes.get(to.id) ?? to.id));
      if (!edges.some((item) => item.from === from.id && item.to === to.id)) {
        edges.push({ from: from.id, to: to.id, dashed: edge[2].includes(".") });
      }
      continue;
    }

    const node = readMermaidNode(line);
    if (node) nodes.set(node.id, cleanMermaidLabel(node.text ?? nodes.get(node.id) ?? node.id));
  }

  const order = orderNodes([...nodes.keys()], edges);

  /* One column, one box to a row. Every box is given the same width — the widest label's, so
     nothing is wrapped that need not be — which puts every left edge, every right edge and every
     centre on one line down the sheet. That last one is what the arrows are drawn between, so
     they run straight down rather than leaning off to whichever box happened to be wider. A chart
     laid out in rows has to guess which branch belongs above which; a column does not guess, and
     what it costs is only that an arrow which skips a box passes behind the boxes between. */
  const w = order.length ? Math.max(...order.map((id) => importedBoxWidth(nodes.get(id) ?? id))) : BOX_W;
  let y = PAD;
  const boxes: Box[] = order.map((id, index) => {
    const text = nodes.get(id) ?? id;
    const h = importedBoxHeight(text, w);
    const box = { id: `b${index + 1}`, x: PAD, y, w, h, text };
    y += h + GAP;
    return box;
  });

  const idMap = new Map(order.map((id, index) => [id, boxes[index].id]));
  const arrows: Arrow[] = edges.flatMap((edge, index) => {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    if (!from || !to) return [];
    return [{ id: `a${index + 1}`, from, to, ...(edge.dashed ? { dashed: true } : {}) }];
  });

  return { boxes, arrows };
}

function mermaidId(id: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ? id : `node_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function mermaidLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "<br/>");
}

function chartToMermaid(chart: Chart): string {
  const ids = new Map(chart.boxes.map((box) => [box.id, mermaidId(box.id)]));
  const lines = ["flowchart TD", ...chart.boxes.map((box) => `  ${ids.get(box.id)}["${mermaidLabel(box.text || box.id)}"]`)];
  for (const arrow of chart.arrows) {
    const from = ids.get(arrow.from);
    const to = ids.get(arrow.to);
    if (from && to) lines.push(`  ${from} ${arrow.dashed ? "-.->" : "-->"} ${to}`);
  }
  return `${lines.join("\n")}\n`;
}

type ChartBoxProps = {
  box: Box;
  selected: boolean;
  editing: boolean;
  editRef: React.RefObject<HTMLTextAreaElement | null>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, box: Box) => void;
  onPortPointerDown: (e: React.PointerEvent<HTMLSpanElement>, box: Box) => void;
  onCornerPointerDown: (e: React.PointerEvent<HTMLSpanElement>, box: Box, corner: string) => void;
  onOpen: (id: string) => void;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClose: () => void;
};

/**
 * One box, drawn where the chart says it is. Kept out of the chart's own render, which is then
 * only about what goes where: the frame, the text and the four handles are one piece, and the
 * three states a box can be in — plain, picked, being typed into — are decided in one place.
 */
function ChartBox({
  box,
  selected,
  editing,
  editRef,
  onPointerDown,
  onPortPointerDown,
  onCornerPointerDown,
  onOpen,
  onChange,
  onKeyDown,
  onClose,
}: ChartBoxProps) {
  // The box centres whatever is in it, so the editor has to be as tall as its text and no taller.
  // Measured here rather than left to CSS: `field-sizing: content` would do it, and is too new for
  // the browsers this board is read in. Runs before paint, so a box never flashes at the wrong
  // height, and re-runs as the label wraps onto another line.
  useLayoutEffect(() => {
    const el = editRef.current;
    if (!editing || !el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, box.text, editRef]);

  return (
    <div
      className={styles.box}
      data-selected={selected ? "" : undefined}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={(e) => onPointerDown(e, box)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen(box.id);
      }}
    >
      {editing ? (
        <textarea
          ref={editRef}
          className={`${styles.text} ${styles.textarea}`}
          value={box.text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={onClose}
        />
      ) : (
        <span className={styles.text}>{box.text}</span>
      )}

      {/* Grab handles, one per side, so an arrow can be pulled the way it is going to run. Where
          it actually leaves the box is worked out from the two boxes, not from the handle — that
          is what lets it re-route itself when either of them moves. */}
      {PORTS.map((port) => (
        <span
          key={port.k}
          className={styles.port}
          style={{ left: `${port.x}%`, top: `${port.y}%` }}
          onPointerDown={(e) => onPortPointerDown(e, box)}
        />
      ))}

      {/* Square corners against the round handles above, and out on the corners where nothing else
          sits — the two are told apart by shape and by place, not by a colour. They show only on a
          picked box, which is also what a picked box is marked by: its border stays the hairline
          every other box on the sheet is drawn with. */}
      {CORNERS.map((corner) => (
        <span
          key={corner.k}
          className={styles.corner}
          style={{ left: `${corner.x}%`, top: `${corner.y}%`, cursor: corner.cursor }}
          onPointerDown={(e) => onCornerPointerDown(e, box, corner.k)}
        />
      ))}
    </div>
  );
}

export default function FlowChart({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = (i18n.language in STRINGS ? i18n.language : "en") as Lang;
  const strings = STRINGS[lang];

  const comp = config.comp as Comp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;
  // Two cards of this module share a page, and an SVG marker is looked up by id across the whole
  // document — so the arrowheads are named after the card. `[\w-]` is all a card id can hold.
  const cardId = ((config._id as string | undefined) ?? "flowchart").replace(/[^\w-]/g, "");

  const chart = useMemo(() => readChart(comp), [comp]);
  const { boxes, arrows } = chart;

  // Where the chart has been, and where Undo has taken it back from. Deliberately not in the
  // card's config, the way Paint keeps its own: a save carries the chart, not the editing history.
  const [past, setPast] = useState<Chart[]>([]);
  const [future, setFuture] = useState<Chart[]>([]);

  const [selected, setSelected] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [arrowMode, setArrowMode] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mermaidOpen, setMermaidOpen] = useState(false);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef({ chart, comp, save, busy: false });
  // Whether this editing session has already put a step on the Undo stack. Typing is one step,
  // not one per keystroke — otherwise a word costs as many Undos as it has letters.
  const textStepRef = useRef(false);

  useEffect(() => {
    liveRef.current.chart = chart;
    liveRef.current.comp = comp;
    liveRef.current.save = save;
  }, [chart, comp, save]);

  function persist(next: Chart) {
    save?.({
      ...comp,
      boxes: next.boxes,
      arrows: next.arrows,
      createdAt: comp?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  }

  function pushStep() {
    setPast((prev) => [...prev, chart].slice(-MAX_HISTORY));
    setFuture([]);
  }

  /** Every edit but a keystroke goes through here: what was on the card becomes the Undo step. */
  function edit(next: Chart) {
    pushStep();
    persist(next);
  }

  /**
   * Both of these close whatever box was being typed into — a step back that left the caret in a
   * label would be typing into a box that may no longer say what it did. The sheet takes the focus
   * as that happens: the closed textarea was holding it, and focus dropped on the page body is
   * focus this card's keys never see, so the Redo after an Undo would go nowhere. Undo pressed on
   * the toolbar hands the focus over the same way, so the next one can be a key.
   */
  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [...prev, chart]);
    setEditing(null);
    surfaceRef.current?.focus();
    persist(previous);
  }

  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture((prev) => prev.slice(0, -1));
    setPast((prev) => [...prev, chart]);
    setEditing(null);
    surfaceRef.current?.focus();
    persist(next);
  }

  // A card stamps its creation time the first time it mounts, the way Note and Paint do — one
  // added from the Add menu arrives without one. The ref keeps StrictMode's double mount from
  // stamping twice.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (stampedRef.current || comp?.createdAt) return;
    stampedRef.current = true;
    save?.({ ...comp, createdAt: Date.now() });
  }, [comp, save]);

  // The chart is as big as the card gives it, or as big as its own contents, whichever is more
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const measure = () => {
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();

    // Safari only got ResizeObserver in 13.1, and this board is also opened on an old iPad
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // A box just added is ready to be typed into, and so is one opened with Enter or a double-click.
  // The caret goes to the end rather than over the whole label: a box opened to have a word added
  // to it should not lose what it already says to the next key pressed.
  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // A half-drawn arrow belongs to the mode that started it, and goes when the mode does
  function toggleArrowMode() {
    setArrowMode((prev) => !prev);
    setLink(null);
  }

  /** Pointer position in the chart's own coordinates, which scroll with it. */
  function toLocal(e: { clientX: number; clientY: number }): Point {
    const surface = surfaceRef.current;
    if (!surface) return { x: 0, y: 0 };
    const rect = surface.getBoundingClientRect();
    return { x: e.clientX - rect.left + surface.scrollLeft, y: e.clientY - rect.top + surface.scrollTop };
  }

  function boxAt(point: Point): Box | undefined {
    // Last drawn is topmost, so the search runs the other way
    for (let i = boxes.length - 1; i >= 0; i--) if (hits(boxes[i], point.x, point.y)) return boxes[i];
    return undefined;
  }

  /** The picked boxes, in the order the chart holds them. Empty when an arrow is picked instead. */
  const picked = selected?.kind === "boxes" ? selected.ids : [];

  /** The one picked box, or nothing when a marquee has picked several — see {@link addNext}. */
  const onlyPicked = picked.length === 1 ? boxes.find((box) => box.id === picked[0]) : undefined;

  /** The picked arrow, when what is picked is an arrow. Only ever one — see {@link Selection}. */
  const pickedArrow = selected?.kind === "arrow" ? arrows.find((arrow) => arrow.id === selected.id) : undefined;

  function pickBox(id: string) {
    setSelected({ kind: "boxes", ids: [id] });
  }

  function startEditing(id: string) {
    textStepRef.current = false;
    pickBox(id);
    setEditing(id);
  }

  function closeEditing() {
    setEditing(null);
  }

  function addBox(x: number, y: number, from?: string): void {
    const spot = freeSpot(boxes, x, y);
    const box: Box = { id: nextId("b", new Set(boxes.map((b) => b.id))), ...spot, w: BOX_W, h: BOX_H, text: "" };
    const nextArrows = from
      ? [...arrows, { id: nextId("a", new Set(arrows.map((a) => a.id))), from, to: box.id }]
      : arrows;
    edit({ boxes: [...boxes, box], arrows: nextArrows });
    // Picked, but not opened for typing. A box lands where there was room for it rather than
    // where it is wanted, so the first thing done to a new one is usually to drag it somewhere —
    // and a caret sitting in it would take that first press as a click into its own text. Enter,
    // or a double-click, opens it when there is something to write in it.
    pickBox(box.id);
    // The box that used to be opened for typing is what held the focus for the card's keys. With
    // nothing opened, the sheet has to take it back — from the toolbar button that was just
    // pressed, or from the textarea a Tab has just closed.
    surfaceRef.current?.focus();
  }

  /**
   * Ctrl+C. Arrows come along only where both of their ends do: one whose other end stayed behind
   * would have nothing to point at once it was pasted.
   */
  function copySelected() {
    if (selected?.kind !== "boxes" || !selected.ids.length) return;
    const ids = new Set(selected.ids);
    clipboard = {
      boxes: boxes.filter((box) => ids.has(box.id)),
      arrows: arrows.filter((arrow) => ids.has(arrow.from) && ids.has(arrow.to)),
    };
    pasteCount = 0;
  }

  /**
   * Ctrl+V. The copies keep their places relative to one another and are shifted as one group, so
   * a pasted chart is the same shape as the one it came from. They are picked as they land, which
   * makes the paste the start of a drag: press one of them and the whole group moves off the
   * original.
   */
  function paste() {
    if (!clipboard?.boxes.length) return;
    pasteCount += 1;
    const shift = PASTE_STEP * pasteCount;

    const takenBoxes = new Set(boxes.map((box) => box.id));
    const idMap = new Map<string, string>();
    const copies = clipboard.boxes.map((box) => {
      const id = nextId("b", takenBoxes);
      takenBoxes.add(id);
      idMap.set(box.id, id);
      return { ...box, id, x: Math.max(0, snap(box.x + shift)), y: Math.max(0, snap(box.y + shift)) };
    });

    const takenArrows = new Set(arrows.map((arrow) => arrow.id));
    const copiedArrows = clipboard.arrows.flatMap((arrow) => {
      const from = idMap.get(arrow.from);
      const to = idMap.get(arrow.to);
      if (!from || !to) return [];
      const id = nextId("a", takenArrows);
      takenArrows.add(id);
      // Spread first, so a dashed arrow is still dashed where the copy lands
      return [{ ...arrow, id, from, to }];
    });

    edit({ boxes: [...boxes, ...copies], arrows: [...arrows, ...copiedArrows] });
    setSelected({ kind: "boxes", ids: copies.map((box) => box.id) });
    setEditing(null);
  }

  /** The toolbar's Add: at the top-left of whatever part of the chart the card is showing. */
  function handleAdd() {
    const surface = surfaceRef.current;
    addBox((surface?.scrollLeft ?? 0) + PAD, (surface?.scrollTop ?? 0) + PAD);
  }

  /**
   * Tab: the next box in the chain, drawn to the right of the one being worked on and joined to
   * it. With nothing picked — or with a whole group picked, where there is no one box the chain is
   * at — it carries on from the newest box, which is the one a Tab before this put there.
   */
  function addNext() {
    const source = onlyPicked ?? boxes[boxes.length - 1];
    if (!source) {
      handleAdd();
      return;
    }
    addBox(source.x + source.w + GAP, source.y, source.id);
  }

  function connect(from: string, to: string) {
    if (from === to) return;
    if (arrows.some((arrow) => arrow.from === from && arrow.to === to)) return;
    edit({ boxes, arrows: [...arrows, { id: nextId("a", new Set(arrows.map((a) => a.id))), from, to }] });
  }

  /**
   * Solid to dashed and back, on the picked arrow. A property of the arrow rather than a mode the
   * next one is drawn in: which links on a chart are the weaker ones is usually only settled once
   * they are all down and the shape of the thing can be seen.
   */
  function toggleDash() {
    if (!pickedArrow) return;
    edit({
      boxes,
      arrows: arrows.map((arrow) => {
        if (arrow.id !== pickedArrow.id) return arrow;
        if (!arrow.dashed) return { ...arrow, dashed: true };
        // Off is the flag gone, not the flag written false — see the note on Arrow
        const solid = { ...arrow };
        delete solid.dashed;
        return solid;
      }),
    });
    // The press took the focus off the sheet, and the sheet is what the card's keys are read on
    surfaceRef.current?.focus();
  }

  function removeSelected() {
    if (!selected) return;
    if (selected.kind === "arrow") {
      edit({ boxes, arrows: arrows.filter((arrow) => arrow.id !== selected.id) });
    } else {
      // An arrow's two ends are the only thing holding it up, so a deleted box takes them with it
      const gone = new Set(selected.ids);
      edit({
        boxes: boxes.filter((box) => !gone.has(box.id)),
        arrows: arrows.filter((arrow) => !gone.has(arrow.from) && !gone.has(arrow.to)),
      });
    }
    setSelected(null);
    setEditing(null);
  }

  // A Clear pressed by mistake costs one Undo rather than the chart
  function clear() {
    if (!boxes.length && !arrows.length) return;
    edit({ boxes: [], arrows: [] });
    setSelected(null);
    setEditing(null);
  }

  function exportMermaid() {
    const blob = new Blob([chartToMermaid(chart)], { type: "text/vnd.mermaid;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flowchart.mmd";
    a.click();
    URL.revokeObjectURL(url);
    setMermaidOpen(false);
  }

  function importMermaidClick() {
    fileInputRef.current?.click();
    setMermaidOpen(false);
  }

  function handleMermaidFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = typeof ev.target?.result === "string" ? ev.target.result : "";
      const next = chartFromMermaid(text);
      if (!next.boxes.length) return;
      edit(next);
      setSelected(null);
      setEditing(null);
      setArrowMode(false);
      setLink(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function importGeneratedMermaid(text: string) {
    const next = chartFromMermaid(text);
    if (!next.boxes.length) return;
    setPast((prev) => [...prev, liveRef.current.chart].slice(-MAX_HISTORY));
    setFuture([]);
    liveRef.current.save?.({
      ...liveRef.current.comp,
      boxes: next.boxes,
      arrows: next.arrows,
      createdAt: liveRef.current.comp?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    setSelected(null);
    setEditing(null);
    setArrowMode(false);
    setLink(null);
  }

  /* The header's Generate button works in Mermaid because that is the compact,
     editable interchange format this card already imports. While tokens stream,
     FlowChart waits; the final answer is then imported as boxes and arrows. */
  useEffect(() => {
    const setGenerate = config._setGenerate as ((target: GenerateTarget | null) => void) | undefined;
    setGenerate?.({
      content: () => chartToMermaid(liveRef.current.chart),
      prompt: GENERATE_PROMPT,
      onBusy: (busy) => {
        liveRef.current.busy = busy;
      },
      onGenerated: (next) => {
        if (!liveRef.current.busy) importGeneratedMermaid(next);
      },
      onDone: importGeneratedMermaid,
    });
    return () => setGenerate?.(null);
    // Registered once: the target reads current chart state through liveRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSurfacePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setSelected(null);
    setEditing(null);
    setLink(null);
    surfaceRef.current?.focus();
    // Arrow mode is waiting on a box to be pressed, not on a region to be drawn round
    if (e.button !== 0 || arrowMode) return;
    const point = toLocal(e);
    setMarquee({ pointerId: e.pointerId, x0: point.x, y0: point.y, x: point.x, y: point.y, active: false });
  }

  function handleBoxPointerDown(e: React.PointerEvent<HTMLDivElement>, box: Box) {
    if (e.button !== 0) return;
    // The press belongs to the box, not to the empty surface under it
    e.stopPropagation();

    // In arrow mode the first box pressed is the tail and the second is the head, which is the
    // only way to draw an arrow with a finger: the edge handles never show without a hover
    if (arrowMode) {
      // preventDefault takes the focus the press would have moved, so the chart is told to keep it
      e.preventDefault();
      surfaceRef.current?.focus();
      if (link) {
        connect(link.from, box.id);
        setLink(null);
        pickBox(box.id);
        return;
      }
      setLink({ pointerId: null, from: box.id, ...center(box) });
      pickBox(box.id);
      return;
    }

    // A press inside the box being typed into is the caret being placed, not a drag
    if (editing === box.id) return;

    // A box already in the picked group keeps the group and takes it along; one outside it becomes
    // the whole of the selection. Pressing a member to collapse the group onto it would leave a
    // marquee with nothing to do — the press that moves the group is the same press.
    const group = picked.includes(box.id) ? picked : [box.id];
    if (group.length === 1) pickBox(box.id);
    setEditing(null);
    surfaceRef.current?.focus();

    const moving = boxes.filter((b) => group.includes(b.id));
    // The pointer is not captured yet, on purpose — see handlePointerMove
    const point = toLocal(e);
    setDrag({
      pointerId: e.pointerId,
      from: Object.fromEntries(moving.map((b) => [b.id, { x: b.x, y: b.y }])),
      minX: Math.min(...moving.map((b) => b.x)),
      minY: Math.min(...moving.map((b) => b.y)),
      startX: point.x,
      startY: point.y,
      dx: 0,
      dy: 0,
      moved: false,
    });
  }

  function handlePortPointerDown(e: React.PointerEvent<HTMLSpanElement>, box: Box) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const point = toLocal(e);
    surfaceRef.current?.setPointerCapture(e.pointerId);
    surfaceRef.current?.focus();
    pickBox(box.id);
    setEditing(null);
    setLink({ pointerId: e.pointerId, from: box.id, x: point.x, y: point.y });
  }

  function handleCornerPointerDown(e: React.PointerEvent<HTMLSpanElement>, box: Box, corner: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const point = toLocal(e);
    // A resize is a drag from its first pixel — there is no click on a corner to keep clear of, so
    // unlike a box this takes the pointer straight away
    surfaceRef.current?.setPointerCapture(e.pointerId);
    surfaceRef.current?.focus();
    pickBox(box.id);
    setEditing(null);
    setResize({
      pointerId: e.pointerId,
      id: box.id,
      corner,
      start: box,
      startX: point.x,
      startY: point.y,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    });
  }

  function handleArrowPointerDown(e: React.PointerEvent<SVGPathElement>, arrow: Arrow) {
    e.stopPropagation();
    setSelected({ kind: "arrow", id: arrow.id });
    setEditing(null);
    surfaceRef.current?.focus();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (marquee && marquee.pointerId === e.pointerId) {
      const point = toLocal(e);
      const active = marquee.active || Math.hypot(point.x - marquee.x0, point.y - marquee.y0) > SLOP;
      // Same as the box drag below: the pointer is only taken once the press turns out to be one
      if (active && !marquee.active) surfaceRef.current?.setPointerCapture(e.pointerId);
      setMarquee({ ...marquee, x: point.x, y: point.y, active });
      return;
    }
    if (resize && resize.pointerId === e.pointerId) {
      const point = toLocal(e);
      const next = resized(resize.start, resize.corner, point.x - resize.startX, point.y - resize.startY);
      if (next.x !== resize.x || next.y !== resize.y || next.w !== resize.w || next.h !== resize.h) {
        setResize({ ...resize, ...next });
      }
      return;
    }
    if (drag && drag.pointerId === e.pointerId) {
      const point = toLocal(e);
      // One offset for the whole group, snapped once: snapping each box on its own would shear a
      // group that was not laid out on the grid to begin with. Clamped so the box furthest left or
      // furthest up is what stops at the edge, and the rest keep their places behind it.
      const dx = Math.max(snap(point.x - drag.startX), -drag.minX);
      const dy = Math.max(snap(point.y - drag.startY), -drag.minY);
      // Under the slop the press is still a click: a box nudged by a pixel on the way to a
      // double-click should not end up on a different grid cell
      const moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > SLOP;
      // Captured, the pointer keeps reporting here after it leaves the card, so a box dragged
      // past the edge follows it back instead of being dropped where the pointer left. Taken
      // only once the press turns out to be a drag: a capture held from the press onwards
      // retargets the click and the double-click behind it at whatever holds the capture, and
      // the double-click on the box is how it is opened to be typed into.
      if (moved && !drag.moved) surfaceRef.current?.setPointerCapture(e.pointerId);
      if (dx !== drag.dx || dy !== drag.dy || moved !== drag.moved) setDrag({ ...drag, dx, dy, moved });
      return;
    }
    if (link && (link.pointerId === null || link.pointerId === e.pointerId)) {
      const point = toLocal(e);
      setLink({ ...link, x: point.x, y: point.y });
    }
  }

  // One save per drag rather than per frame: a save rewrites the whole board
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (marquee && marquee.pointerId === e.pointerId) {
      const region = marqueeRect(marquee);
      const wasActive = marquee.active;
      setMarquee(null);
      // A press that never became a drag is the plain click on the sheet it looked like, and that
      // already cleared the selection on the way down
      if (!wasActive) return;
      const ids = boxes.filter((box) => touches(box, region)).map((box) => box.id);
      setSelected(ids.length ? { kind: "boxes", ids } : null);
      return;
    }
    if (resize && resize.pointerId === e.pointerId) {
      const box = boxes.find((b) => b.id === resize.id);
      setResize(null);
      if (box && (box.x !== resize.x || box.y !== resize.y || box.w !== resize.w || box.h !== resize.h)) {
        edit({
          boxes: boxes.map((b) =>
            b.id === resize.id ? { ...b, x: resize.x, y: resize.y, w: resize.w, h: resize.h } : b,
          ),
          arrows,
        });
      }
      return;
    }
    if (drag && drag.pointerId === e.pointerId) {
      setDrag(null);
      if (drag.moved && (drag.dx !== 0 || drag.dy !== 0)) {
        edit({
          boxes: boxes.map((b) => {
            const origin = drag.from[b.id];
            return origin ? { ...b, x: origin.x + drag.dx, y: origin.y + drag.dy } : b;
          }),
          arrows,
        });
      }
      return;
    }
    if (link && link.pointerId === e.pointerId) {
      const target = boxAt(toLocal(e));
      setLink(null);
      if (target) connect(link.from, target.id);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl on a keyboard, Cmd on a Mac: the same key to the hand pressing it
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;

    // Undo and Redo are taken even while a label is being typed, which is why they come before the
    // guard below. A label is on the chart's own history like everything else, and the textarea it
    // is typed into is a controlled one, so the undo the browser would otherwise do there is
    // against a value React puts straight back.
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }

    // Keys typed into a box bubble up here; that box's own handler has already had them
    if (editing) return;

    if (mod && !e.shiftKey && e.key.toLowerCase() === "c") {
      // Nothing picked leaves the press to the browser, so a copy of a label selected elsewhere on
      // the page is still a copy
      if (selected?.kind !== "boxes") return;
      e.preventDefault();
      copySelected();
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === "v") {
      if (!clipboard?.boxes.length) return;
      e.preventDefault();
      paste();
      return;
    }

    // The letter shortcuts are bare letters only: Cmd+N opens a browser window and Ctrl+D bookmarks
    // the page, and neither of those is this card's to take
    const bare = !e.altKey && !e.ctrlKey && !e.metaKey;
    const letter = bare ? e.key.toLowerCase() : "";

    // Tab belongs to the chart while the chart has the focus; Shift+Tab is left alone, so it is
    // still the way out of the card
    if (e.key === "Tab" && !e.shiftKey && bare) {
      e.preventDefault();
      addNext();
      return;
    }
    // N adds a box on its own, where Tab adds one on the end of the chain
    if (letter === "n") {
      e.preventDefault();
      handleAdd();
      return;
    }
    if (e.key === "Enter" && onlyPicked) {
      e.preventDefault();
      startEditing(onlyPicked.id);
      return;
    }
    // D for the hand that is already on N, Delete and Backspace for the one that is not. Taken
    // even with nothing selected: Backspace left to the browser is a page back on the browsers
    // that still bind it, and the board would be gone with it
    if (e.key === "Delete" || e.key === "Backspace" || letter === "d") {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      setArrowMode(false);
      setLink(null);
    }
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Tab out of a box is the same Tab as on the chart: it finishes this box and opens the next
    // one, so a chain is typed straight through without a hand leaving the keyboard
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const source = boxes.find((box) => box.id === editing);
      setEditing(null);
      if (source) addBox(source.x + source.w + GAP, source.y, source.id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      surfaceRef.current?.focus();
    }
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (!editing) return;
    const text = e.target.value;
    if (!textStepRef.current) {
      textStepRef.current = true;
      pushStep();
    }
    persist({ boxes: boxes.map((box) => (box.id === editing ? { ...box, text } : box)), arrows });
  }

  // Where a box is on screen: what the config says, or what the drag or resize in progress says if
  // it is the one under the pointer. The arrows read from here too, which is the whole of "the
  // arrows follow the box" — they re-route as it is resized just as they do as it is moved.
  const moving = drag?.moved ? drag : null;
  const placed = boxes.map((box) => {
    const origin = moving?.from[box.id];
    if (origin) return { ...box, x: origin.x + moving.dx, y: origin.y + moving.dy };
    if (resize && resize.id === box.id) return { ...box, x: resize.x, y: resize.y, w: resize.w, h: resize.h };
    return box;
  });
  const byId = new Map(placed.map((box) => [box.id, box]));

  const extent = placed.reduce((acc, box) => ({ x: Math.max(acc.x, box.x + box.w), y: Math.max(acc.y, box.y + box.h) }), {
    x: 0,
    y: 0,
  });
  const width = Math.max(size.width, extent.x + PAD);
  const height = Math.max(size.height, extent.y + PAD);

  const linkFrom = link ? byId.get(link.from) : undefined;
  const head = `${cardId}-head`;

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          <button type="button" className={styles.button} title={strings.box} aria-label={strings.box} onClick={handleAdd}>
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16v10H4z" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.button}
            title={strings.arrow}
            aria-label={strings.arrow}
            data-active={arrowMode ? "" : undefined}
            onClick={toggleArrowMode}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h14" />
              <path d="M13 7l5 5-5 5" />
            </svg>
          </button>
          {/* Beside the arrow tool, because it is about arrows — but it acts on the picked one
              rather than arming a mode, so it is dark when that arrow is dashed and dead when
              there is no arrow picked to dash */}
          <button
            type="button"
            className={styles.button}
            title={strings.dash}
            aria-label={strings.dash}
            aria-pressed={!!pickedArrow?.dashed}
            data-active={pickedArrow?.dashed ? "" : undefined}
            disabled={!pickedArrow}
            onClick={toggleDash}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h14" strokeDasharray="4 3" />
              <path d="M13 7l5 5-5 5" />
            </svg>
          </button>
        </div>

        <div className={styles.spacer} />

        <div className={styles.group}>
          <button
            type="button"
            className={styles.button}
            title={strings.undo}
            aria-label={strings.undo}
            disabled={!past.length}
            onClick={undo}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5 3 10l5 5" />
              <path d="M3 10h10a5 5 0 0 1 0 10H8" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.button}
            title={strings.redo}
            aria-label={strings.redo}
            disabled={!future.length}
            onClick={redo}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 5l5 5-5 5" />
              <path d="M21 10H11a5 5 0 0 0 0 10h5" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.button}
            title={strings.remove}
            aria-label={strings.remove}
            disabled={!selected}
            onClick={removeSelected}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Its own group, a gap away from the rest: one press wipes the card, and it is the last
            thing a pointer coming back to Undo should be able to land on by mistake */}
        <div className={styles.group}>
          <button
            type="button"
            className={styles.button}
            title={strings.clear}
            aria-label={strings.clear}
            disabled={!boxes.length && !arrows.length}
            onClick={clear}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M9 7V4h6v3" />
              <path d="M6 7l1 13h10l1-13" />
            </svg>
          </button>
        </div>

        <div
          className={styles.menu}
          data-open={mermaidOpen ? "" : undefined}
          onPointerEnter={() => setMermaidOpen(true)}
          onPointerLeave={() => setMermaidOpen(false)}
          onFocus={() => setMermaidOpen(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMermaidOpen(false);
          }}
        >
          <button
            type="button"
            className={`${styles.button} ${styles.mermaidButton}`}
            title="Mermaid"
            aria-label="Mermaid"
            aria-haspopup="menu"
            aria-expanded={mermaidOpen}
          >
            <span className={styles.mermaidMark} aria-hidden="true">
              M
            </span>
          </button>
          <div className={styles.menuDropdown} role="menu">
            <button type="button" className={styles.menuOption} role="menuitem" onClick={importMermaidClick}>
              {strings.importMermaid}
            </button>
            <button
              type="button"
              className={styles.menuOption}
              role="menuitem"
              disabled={!boxes.length}
              onClick={exportMermaid}
            >
              {strings.exportMermaid}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mmd,.mermaid,.txt,text/plain,text/vnd.mermaid"
            className={styles.fileInput}
            onChange={handleMermaidFile}
          />
        </div>
      </div>

      {/* Focusable, because Tab, Enter and Delete are half of how this card is worked */}
      <div
        ref={surfaceRef}
        className={styles.surface}
        tabIndex={0}
        data-linking={arrowMode ? "" : undefined}
        onKeyDown={handleKeyDown}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        // The capture can go without a pointerup ever reaching here; this is what keeps a box
        // from being left stuck to a pointer that is no longer reporting
        onLostPointerCapture={handlePointerUp}
      >
        <div className={styles.canvas} style={{ width, height }}>
          <svg className={styles.arrows} width={width} height={height}>
            <defs>
              {/* userSpaceOnUse, so the head stays one size whatever the line's width is; refX at
                  the tip puts that tip on the box's border rather than past it */}
              <marker id={head} markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0 0L8 4L0 8z" fill={INK} />
              </marker>
            </defs>

            {arrows.map((arrow) => {
              const from = byId.get(arrow.from);
              const to = byId.get(arrow.to);
              if (!from || !to) return null;
              const d = elbowPath(corners(route(from, to)), ELBOW);
              const on = selected?.kind === "arrow" && selected.id === arrow.id;
              return (
                <g key={arrow.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={INK}
                    strokeWidth={on ? PICKED_STROKE : 1}
                    strokeDasharray={arrow.dashed ? DASH : undefined}
                    markerEnd={`url(#${head})`}
                  />
                  {/* Fat, invisible, and the only part of the arrow a pointer can reach: a
                      hairline is far too thin to press, on a mouse and more so on a finger */}
                  <path d={d} className={styles.hit} onPointerDown={(e) => handleArrowPointerDown(e, arrow)} />
                </g>
              );
            })}

            {/* The arrow being pulled out of a handle, or waiting on its second box in arrow mode */}
            {link && linkFrom && (
              <line
                x1={border(linkFrom, { x: link.x, y: link.y }).x}
                y1={border(linkFrom, { x: link.x, y: link.y }).y}
                x2={link.x}
                y2={link.y}
                className={styles.live}
                markerEnd={`url(#${head})`}
              />
            )}
          </svg>

          {placed.map((box) => (
            <ChartBox
              key={box.id}
              box={box}
              selected={picked.includes(box.id)}
              editing={editing === box.id}
              editRef={editRef}
              onPointerDown={handleBoxPointerDown}
              onPortPointerDown={handlePortPointerDown}
              onCornerPointerDown={handleCornerPointerDown}
              onOpen={startEditing}
              onChange={handleTextChange}
              onKeyDown={handleTextKeyDown}
              onClose={closeEditing}
            />
          ))}

          {/* The region being drawn round the boxes to pick them up. Over them rather than under:
              it is the thing being dragged, and a group of boxes would otherwise hide most of it. */}
          {marquee?.active && (
            <div
              className={styles.marquee}
              style={{
                left: marqueeRect(marquee).x,
                top: marqueeRect(marquee).y,
                width: marqueeRect(marquee).w,
                height: marqueeRect(marquee).h,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
