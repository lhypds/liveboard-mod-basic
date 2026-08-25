import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./flowchart.module.css";

type Lang = "en" | "ja" | "zh";

type Strings = {
  box: string;
  arrow: string;
  undo: string;
  redo: string;
  remove: string;
  clear: string;
};

const STRINGS: Record<Lang, Strings> = {
  en: {
    box: "Add box",
    arrow: "Draw arrow",
    undo: "Undo",
    redo: "Redo",
    remove: "Delete selected",
    clear: "Clear",
  },
  ja: {
    box: "ボックス追加",
    arrow: "矢印を引く",
    undo: "元に戻す",
    redo: "やり直す",
    remove: "選択を削除",
    clear: "クリア",
  },
  zh: {
    box: "添加方框",
    arrow: "画箭头",
    undo: "撤销",
    redo: "重做",
    remove: "删除所选",
    clear: "清除",
  },
};

/** A new box, in px. Wide enough for a short label at the size the text is drawn. */
const BOX_W = 120;
const BOX_H = 48;

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

/* The only ink on the card. A picked box or arrow is drawn twice as heavy rather than in a
   second colour — see the selection rule in the stylesheet. */
const INK = "#0f172a";

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

/** One arrow, named by the boxes at its two ends. Never by coordinates — see `config.ts`. */
type Arrow = { id: string; from: string; to: string };

type Chart = { boxes: Box[]; arrows: Arrow[] };

type Point = { x: number; y: number };

type Comp = {
  boxes?: unknown;
  arrows?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

/** What the toolbar's Delete and the Delete key act on. Session state, never saved. */
type Selection = { kind: "box" | "arrow"; id: string };

/** A box being dragged right now, with the grab offset that keeps it under the pointer. */
type Drag = {
  pointerId: number;
  id: string;
  offX: number;
  offY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
};

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

function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Where the line from the box's centre towards `to` crosses the box's own border. This is the
 * whole of the arrow routing: both ends are worked out from the boxes every time the chart is
 * drawn, so a box that moves drags its arrows along without any of them being touched.
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

function hits(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
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
  const [size, setSize] = useState({ width: 0, height: 0 });

  const surfaceRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  // Whether this editing session has already put a step on the Undo stack. Typing is one step,
  // not one per keystroke — otherwise a word costs as many Undos as it has letters.
  const textStepRef = useRef(false);

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

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [...prev, chart]);
    setEditing(null);
    persist(previous);
  }

  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture((prev) => prev.slice(0, -1));
    setPast((prev) => [...prev, chart]);
    setEditing(null);
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

  function startEditing(id: string) {
    textStepRef.current = false;
    setSelected({ kind: "box", id });
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
    startEditing(box.id);
  }

  /** The toolbar's Add: at the top-left of whatever part of the chart the card is showing. */
  function handleAdd() {
    const surface = surfaceRef.current;
    addBox((surface?.scrollLeft ?? 0) + PAD, (surface?.scrollTop ?? 0) + PAD);
  }

  /**
   * Tab: the next box in the chain, drawn to the right of the one being worked on and joined to
   * it. With nothing selected the chain carries on from the newest box, which is the one a Tab
   * before this put there.
   */
  function addNext() {
    const source =
      (selected?.kind === "box" ? boxes.find((box) => box.id === selected.id) : undefined) ??
      boxes[boxes.length - 1];
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

  function removeSelected() {
    if (!selected) return;
    if (selected.kind === "arrow") {
      edit({ boxes, arrows: arrows.filter((arrow) => arrow.id !== selected.id) });
    } else {
      // An arrow's two ends are the only thing holding it up, so a deleted box takes them with it
      edit({
        boxes: boxes.filter((box) => box.id !== selected.id),
        arrows: arrows.filter((arrow) => arrow.from !== selected.id && arrow.to !== selected.id),
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

  function handleSurfacePointerDown() {
    setSelected(null);
    setEditing(null);
    setLink(null);
    surfaceRef.current?.focus();
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
        setSelected({ kind: "box", id: box.id });
        return;
      }
      setLink({ pointerId: null, from: box.id, ...center(box) });
      setSelected({ kind: "box", id: box.id });
      return;
    }

    // A press inside the box being typed into is the caret being placed, not a drag
    if (editing === box.id) return;

    setSelected({ kind: "box", id: box.id });
    setEditing(null);
    surfaceRef.current?.focus();

    // The pointer is not captured yet, on purpose — see handlePointerMove
    const point = toLocal(e);
    setDrag({
      pointerId: e.pointerId,
      id: box.id,
      offX: point.x - box.x,
      offY: point.y - box.y,
      startX: point.x,
      startY: point.y,
      x: box.x,
      y: box.y,
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
    setSelected({ kind: "box", id: box.id });
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
    setSelected({ kind: "box", id: box.id });
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

  function handleArrowPointerDown(e: React.PointerEvent<SVGLineElement>, arrow: Arrow) {
    e.stopPropagation();
    setSelected({ kind: "arrow", id: arrow.id });
    setEditing(null);
    surfaceRef.current?.focus();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
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
      const x = Math.max(0, snap(point.x - drag.offX));
      const y = Math.max(0, snap(point.y - drag.offY));
      // Under the slop the press is still a click: a box nudged by a pixel on the way to a
      // double-click should not end up on a different grid cell
      const moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > SLOP;
      // Captured, the pointer keeps reporting here after it leaves the card, so a box dragged
      // past the edge follows it back instead of being dropped where the pointer left. Taken
      // only once the press turns out to be a drag: a capture held from the press onwards
      // retargets the click and the double-click behind it at whatever holds the capture, and
      // the double-click on the box is how it is opened to be typed into.
      if (moved && !drag.moved) surfaceRef.current?.setPointerCapture(e.pointerId);
      if (x !== drag.x || y !== drag.y || moved !== drag.moved) setDrag({ ...drag, x, y, moved });
      return;
    }
    if (link && (link.pointerId === null || link.pointerId === e.pointerId)) {
      const point = toLocal(e);
      setLink({ ...link, x: point.x, y: point.y });
    }
  }

  // One save per drag rather than per frame: a save rewrites the whole board
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
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
      const box = boxes.find((b) => b.id === drag.id);
      setDrag(null);
      if (drag.moved && box && (box.x !== drag.x || box.y !== drag.y)) {
        edit({
          boxes: boxes.map((b) => (b.id === drag.id ? { ...b, x: drag.x, y: drag.y } : b)),
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
    // Keys typed into a box bubble up here; that box's own handler has already had them
    if (editing) return;

    // Tab belongs to the chart while the chart has the focus; Shift+Tab is left alone, so it is
    // still the way out of the card
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      addNext();
      return;
    }
    if (e.key === "Enter" && selected?.kind === "box") {
      e.preventDefault();
      startEditing(selected.id);
      return;
    }
    // Taken even with nothing selected: Backspace left to the browser is a page back on the
    // browsers that still bind it, and the board would be gone with it
    if (e.key === "Delete" || e.key === "Backspace") {
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

  // Where a box is on screen: the config's position, or the drag's if it is the one being moved.
  // The arrows read from here too, which is the whole of "the arrow follows the box".
  const placed = boxes.map((box) =>
    drag && drag.id === box.id && drag.moved ? { ...box, x: drag.x, y: drag.y } : box,
  );
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
              const tail = border(from, center(to));
              const tip = border(to, center(from));
              const on = selected?.kind === "arrow" && selected.id === arrow.id;
              return (
                <g key={arrow.id}>
                  <line
                    x1={tail.x}
                    y1={tail.y}
                    x2={tip.x}
                    y2={tip.y}
                    stroke={INK}
                    strokeWidth={on ? 2 : 1}
                    markerEnd={`url(#${head})`}
                  />
                  {/* Fat, invisible, and the only part of the arrow a pointer can reach: a
                      hairline is far too thin to press, on a mouse and more so on a finger */}
                  <line
                    x1={tail.x}
                    y1={tail.y}
                    x2={tip.x}
                    y2={tip.y}
                    className={styles.hit}
                    onPointerDown={(e) => handleArrowPointerDown(e, arrow)}
                  />
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
              selected={selected?.kind === "box" && selected.id === box.id}
              editing={editing === box.id}
              editRef={editRef}
              onPointerDown={handleBoxPointerDown}
              onPortPointerDown={handlePortPointerDown}
              onOpen={startEditing}
              onChange={handleTextChange}
              onKeyDown={handleTextKeyDown}
              onClose={closeEditing}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
