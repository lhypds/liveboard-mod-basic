import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./paint.module.css";

type Lang = "en" | "ja" | "zh";

type Strings = {
  color: string;
  width: string;
  pen: string;
  eraser: string;
  undo: string;
  redo: string;
  clear: string;
};

const STRINGS: Record<Lang, Strings> = {
  en: {
    color: "Colour",
    width: "Pen width",
    pen: "Pen",
    eraser: "Eraser",
    undo: "Undo",
    redo: "Redo",
    clear: "Clear",
  },
  ja: {
    color: "色",
    width: "線の太さ",
    pen: "ペン",
    eraser: "消しゴム",
    undo: "元に戻す",
    redo: "やり直す",
    clear: "クリア",
  },
  zh: {
    color: "颜色",
    width: "笔粗细",
    pen: "画笔",
    eraser: "橡皮",
    undo: "撤销",
    redo: "重做",
    clear: "清除",
  },
};

/**
 * The swatch row: a soft ink to write with, then seven brights. `comp.color` is drawn with whatever
 * it says — a colour typed into the Edit modal works, it just leaves no swatch showing as picked.
 */
const COLORS = ["#334155", "#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];

/** Pen widths in px, as drawn at the card's width at the time. */
const WIDTHS = [1, 3, 6, 12];

/** Used when `comp.eraserScale` is missing or nonsense. */
const ERASER_SCALE = 4;

/**
 * A move shorter than this is dropped. A pointer reports far more points than a line needs, and
 * every one of them rides along in every board save, export and sync.
 */
const MIN_STEP_PX = 1.2;

/**
 * Points are fractions of the card's width, so four decimals is a fortieth of a pixel on a 400px
 * card — finer than the screen, and a good deal shorter in JSON than the raw float.
 */
const POINT_DECIMALS = 4;

/** A width is a much smaller fraction than a coordinate, so it needs two more places. */
const WIDTH_DECIMALS = 6;

/** Retina sharpness without the backing store a 3x canvas costs on a phone. */
const MAX_DPR = 2;

/**
 * How far back Undo reaches. A step is a list of references to strokes that are kept anyway, so this
 * is only about not growing that list for the length of a long session.
 */
const MAX_HISTORY = 100;

/** One pen or eraser stroke, as it is kept in the card's config. See `config.ts`. */
type Stroke = { c: string; w: number; p: number[] };

type Comp = {
  strokes?: unknown;
  color?: string;
  size?: number;
  erasing?: boolean;
  eraserScale?: number;
  createdAt?: number;
  updatedAt?: number;
};

/** The stroke being drawn right now. Held in a ref: a point per pointer event is no board state. */
type Live = {
  pointerId: number;
  stroke: Stroke;
  /** The canvas' box and width as the stroke started, so a move costs no layout. */
  left: number;
  top: number;
  scale: number;
  /** The last point actually drawn, in css px. */
  x: number;
  y: number;
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function deviceRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

// comp is free-form and can be hand-edited in the Edit modal, so nothing read out of it is trusted
function isStroke(value: unknown): value is Stroke {
  const stroke = value as Stroke | null;
  if (!stroke || typeof stroke !== "object") return false;
  if (typeof stroke.c !== "string" || typeof stroke.w !== "number" || !Number.isFinite(stroke.w)) return false;
  if (!Array.isArray(stroke.p) || stroke.p.length < 2 || stroke.p.length % 2 !== 0) return false;
  return stroke.p.every((n) => typeof n === "number" && Number.isFinite(n));
}

function readStrokes(value: unknown): Stroke[] {
  return Array.isArray(value) ? value.filter(isStroke) : [];
}

/**
 * How big a width button's dot is drawn. The widths differ by a factor of twelve and the button is
 * 18px, so the preview is compressed rather than to scale.
 */
function dotSize(pen: number): number {
  return Math.round(2 + Math.min(pen, 12) * 0.7);
}

/**
 * Resizing the backing store resets the context, so this is called after every resize as well as
 * before a stroke — the live drawing below relies on the same transform the last repaint used.
 */
function prepare(ctx: CanvasRenderingContext2D, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

/**
 * The eraser cuts what is under it rather than painting the background over it, so it still reads
 * as an eraser on a card exported to PNG, where the canvas itself is transparent.
 */
function applyStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number) {
  ctx.globalCompositeOperation = stroke.c ? "source-over" : "destination-out";
  ctx.strokeStyle = stroke.c || "#000";
  ctx.fillStyle = stroke.c || "#000";
  ctx.lineWidth = Math.max(stroke.w * width, 0.5);
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number) {
  applyStroke(ctx, stroke, width);
  const p = stroke.p;
  ctx.beginPath();
  if (p.length === 2) {
    // A tap has no length to stroke, and a pen that leaves nothing where it was put down feels broken
    ctx.arc(p[0] * width, p[1] * width, ctx.lineWidth / 2, 0, 2 * Math.PI);
    ctx.fill();
    return;
  }
  ctx.moveTo(p[0] * width, p[1] * width);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * width, p[i + 1] * width);
  ctx.stroke();
}

/**
 * One segment of the stroke in progress, in css px. Round caps make this the same ink as the same
 * segment inside the whole-stroke path {@link drawStroke} lays down on the next repaint, so
 * committing a stroke changes nothing on screen.
 */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  applyStroke(ctx, stroke, width);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function repaint(canvas: HTMLCanvasElement, strokes: Stroke[], width: number, height: number) {
  const dpr = deviceRatio();
  // Sizing the backing store clears it, which is the clear this repaint would have had to do anyway
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  prepare(ctx, dpr);
  for (const stroke of strokes) drawStroke(ctx, stroke, width);
}

export default function Paint({ config }: { config: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = (i18n.language in STRINGS ? i18n.language : "en") as Lang;
  const strings = STRINGS[lang];

  const comp = config.comp as Comp | undefined;
  const save = config._save as ((comp: Record<string, unknown>) => void) | undefined;

  const strokes = useMemo(() => readStrokes(comp?.strokes), [comp?.strokes]);
  const color = comp?.color || COLORS[0];
  const penWidth = typeof comp?.size === "number" && comp.size > 0 ? comp.size : WIDTHS[1];
  const erasing = comp?.erasing === true;
  const eraserScale =
    typeof comp?.eraserScale === "number" && comp.eraserScale > 0 ? comp.eraserScale : ERASER_SCALE;

  // Where the drawing has been, and where Undo has taken it back from: a snapshot of the whole
  // stroke list per edit, so one Undo covers a Clear as readily as a stroke. Deliberately not in the
  // card's config — a save carries the drawing, not the session's editing history.
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<Live | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /** What the eraser covers, in css px — the width its strokes are actually drawn at. */
  const eraserPx = penWidth * eraserScale;

  function saveTool(patch: Comp) {
    save?.({ ...comp, ...patch });
  }

  function saveStrokes(next: Stroke[]) {
    save?.({ ...comp, strokes: next, createdAt: comp?.createdAt ?? Date.now(), updatedAt: Date.now() });
  }

  // A card stamps its creation time the first time it mounts, the way Note does — one added from the
  // Add menu arrives without one. The ref keeps StrictMode's double mount from stamping twice.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (stampedRef.current || comp?.createdAt) return;
    stampedRef.current = true;
    save?.({ ...comp, createdAt: Date.now() });
  }, [comp, save]);

  // The canvas fills whatever the card gives it, and its backing store has to follow in px
  useEffect(() => {
    const surface = canvasRef.current?.parentElement;
    if (!surface) return;

    const measure = () => {
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();

    // Safari only got ResizeObserver in 13.1, and this board is also opened on an old iPad. There
    // the canvas follows window resizes instead, which is every resize it gets on a phone anyway.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // The strokes in the config are the drawing; this is the only place the whole thing is drawn from.
  // A stroke being drawn right now is already on the canvas, put there segment by segment below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    repaint(canvas, strokes, size.width, size.height);
  }, [strokes, size.width, size.height]);

  // The pen shows its own width in the ink it leaves; the eraser takes ink away, so the only way to
  // know what the next press will reach is to draw its footprint before it. Written straight to the
  // DOM: this fires on every mouse move across the card, and a re-render each time buys nothing.
  // `offsetX/offsetY` are already relative to the canvas, so tracking costs no layout read either.
  function trackGhost(e: React.PointerEvent<HTMLCanvasElement>) {
    const ghost = ghostRef.current;
    if (!ghost || !erasing) return;
    const radius = eraserPx / 2;
    ghost.style.width = `${eraserPx}px`;
    ghost.style.height = `${eraserPx}px`;
    ghost.style.transform = `translate(${e.nativeEvent.offsetX - radius}px, ${e.nativeEvent.offsetY - radius}px)`;
    ghost.style.display = "block";
  }

  function hideGhost() {
    const ghost = ghostRef.current;
    if (ghost) ghost.style.display = "none";
  }

  // Switching back to the pen has to take the ring off the paper even if the pointer never moves again
  useEffect(() => {
    if (!erasing && ghostRef.current) ghostRef.current.style.display = "none";
  }, [erasing]);

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    trackGhost(e);
    // Only the primary button draws, and only one pointer at a time — a second finger landing
    // mid-stroke would otherwise steer the same line.
    if (e.button !== 0 || liveRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;

    // Captured, the pointer keeps reporting here after it leaves the card, so a stroke drawn off the
    // edge finishes instead of being left open
    canvas.setPointerCapture(e.pointerId);
    prepare(ctx, deviceRatio());

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const stroke: Stroke = {
      c: erasing ? "" : color,
      w: round((erasing ? penWidth * eraserScale : penWidth) / rect.width, WIDTH_DECIMALS),
      p: [round(x / rect.width, POINT_DECIMALS), round(y / rect.width, POINT_DECIMALS)],
    };

    liveRef.current = { pointerId: e.pointerId, stroke, left: rect.left, top: rect.top, scale: rect.width, x, y };
    drawStroke(ctx, stroke, rect.width);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    trackGhost(e);
    const live = liveRef.current;
    if (!live || live.pointerId !== e.pointerId) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const x = e.clientX - live.left;
    const y = e.clientY - live.top;
    if (Math.hypot(x - live.x, y - live.y) < MIN_STEP_PX) return;

    drawSegment(ctx, live.stroke, live.scale, live.x, live.y, x, y);
    live.stroke.p.push(round(x / live.scale, POINT_DECIMALS), round(y / live.scale, POINT_DECIMALS));
    live.x = x;
    live.y = y;
  }

  // One save per stroke rather than per point: a save rewrites the whole board. A cancelled pointer
  // commits too — the ink is already on the canvas, and dropping it would rub the stroke out on the
  // next repaint instead.
  function handlePointerEnd(e: React.PointerEvent<HTMLCanvasElement>) {
    // A finger or a stylus that lifted is not hovering anything, so its ring goes with it. A mouse
    // still is, and keeps the ring for wherever it presses next.
    if (e.pointerType !== "mouse") hideGhost();
    const live = liveRef.current;
    if (!live || live.pointerId !== e.pointerId) return;
    liveRef.current = null;
    edit([...strokes, live.stroke]);
  }

  /** Every edit goes through here: what was on the card becomes the step Undo goes back to. */
  function edit(next: Stroke[]) {
    setPast((prev) => [...prev, strokes].slice(-MAX_HISTORY));
    setFuture([]);
    saveStrokes(next);
  }

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [...prev, strokes]);
    saveStrokes(previous);
  }

  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture((prev) => prev.slice(0, -1));
    setPast((prev) => [...prev, strokes]);
    saveStrokes(next);
  }

  // A Clear pressed by mistake costs one Undo rather than the drawing
  function clear() {
    if (!strokes.length) return;
    edit([]);
  }

  // No `_setReset` registration, so the card has no Reset button in its header: the toolbar's Clear
  // is the same wipe, sitting where the rest of the drawing controls are.

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.group} role="group" aria-label={strings.color}>
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={styles.swatch}
              style={{ background: swatch }}
              aria-label={swatch}
              data-active={!erasing && swatch === color ? "" : undefined}
              onClick={() => saveTool({ color: swatch, erasing: false })}
            />
          ))}
        </div>

        <div className={styles.group} role="group" aria-label={strings.width}>
          {WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              className={styles.button}
              aria-label={`${strings.width} ${width}`}
              data-active={width === penWidth ? "" : undefined}
              onClick={() => saveTool({ size: width })}
            >
              <span className={styles.dot} style={{ width: dotSize(width), height: dotSize(width) }} />
            </button>
          ))}
        </div>

        <div className={styles.group}>
          <button
            type="button"
            className={styles.button}
            title={strings.pen}
            aria-label={strings.pen}
            data-active={erasing ? undefined : ""}
            onClick={() => saveTool({ erasing: false })}
          >
            {/* A nib on a long diagonal barrel, against the eraser's short blunt block */}
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 18l1-4 9-9 3 3-9 9-4 1z" />
              <path d="M15 6l3 3" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.button}
            title={strings.eraser}
            aria-label={strings.eraser}
            data-active={erasing ? "" : undefined}
            onClick={() => saveTool({ erasing: true })}
          >
            {/* A ring on the paper: the eraser's tip really is round — a stroke with round caps —
                and against the pen's diagonal it is the one shape that cannot be mistaken for it */}
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="10" r="6" />
              <path d="M21 20H3" />
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
        </div>

        {/* Its own group, a gap away from Undo and Redo: one press wipes the card, and it is the last
            thing a pointer coming back to those two should be able to land on by mistake. Drawn as an
            icon rather than the word — spelt out, it pushed the toolbar onto a second row on a
            default-sized card, and in the widest of the three languages at that. */}
        <div className={styles.group}>
          <button
            type="button"
            className={styles.button}
            title={strings.clear}
            aria-label={strings.clear}
            disabled={!strokes.length}
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

      <div className={styles.surface}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerEnter={trackGhost}
          onPointerLeave={hideGhost}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          // The capture can go without a pointerup ever reaching the canvas; this is what keeps
          // that stroke from being left open, waiting for an event that never comes.
          onLostPointerCapture={handlePointerEnd}
        />
        {/* The eraser's footprint. Sized and positioned by {@link trackGhost}, never by a render. */}
        <div ref={ghostRef} className={styles.ghost} aria-hidden="true" />
      </div>
    </div>
  );
}
