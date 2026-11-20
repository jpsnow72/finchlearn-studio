/**
 * lottieCore: the shared deterministic Lottie renderer (issues #97,
 * #99, #100).
 *
 * One pure function renders a Lottie animation to an SVG string at an
 * exact frame: renderLottieSvg(animation, localMs, options). The stage
 * preview, the client export, and the server render host all call it
 * with scene clock time (the export paths quantize to the export frame
 * rate first), so a frame on stage and the same frame in an MP4 are
 * produced by the same math from the same clock, never from wall clock
 * time, requestAnimationFrame, or a player's internal playhead.
 *
 * Why no player dependency: package.json carries no Lottie player, and
 * the common players (lottie-web, dotlottie) drive playback from wall
 * clock time and the DOM, which cannot step deterministically to an
 * export frame. This sampler implements the shape layer subset of the
 * Lottie format directly (shape, ellipse, rect, star geometry; fill and
 * stroke paints; trim paths; groups; parented layers; keyframed
 * transforms, opacity, colors, and paths with cubic bezier easing and
 * hold keyframes), which covers the bundled Generative Icons pack and
 * typical icon style imports. Layers it cannot express (text, images,
 * precomps, masks, effects) are skipped, never faked; see MANIFEST.md.
 *
 * Determinism: no Date, no Math.random, fixed iteration order, and all
 * numbers formatted through fmt(), so the same animation, time, and
 * color overrides always produce the identical SVG string.
 */

export type LottieAnimationData = Record<string, unknown>;

interface RawLayer {
  ind?: number;
  parent?: number;
  ty?: number;
  ip?: number;
  op?: number;
  st?: number;
  sr?: number;
  ks?: Record<string, unknown>;
  shapes?: unknown[];
  [key: string]: unknown;
}

export interface LottieColorSlot {
  /** Slot id: the paint's sid, or "paint:#rrggbb" when it has no sid. */
  id: string;
  /** Human label for the inspector. */
  label: string;
  /** The color the animation ships with, as #rrggbb. */
  defaultColor: string;
}

export interface LottieRenderOptions {
  /** Recolor overrides keyed by color slot id (see LottieColorSlot). */
  colors?: Record<string, string>;
  /** Loop playback while the object is on stage. Defaults to true. */
  loop?: boolean;
  /** Playback rate multiplier. Defaults to 1. */
  speed?: number;
}

// ---------------------------------------------------------------------------
// Validation and basic facts
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when the value has the shape of a Lottie animation document. */
export function isLottieAnimationData(v: unknown): v is LottieAnimationData {
  if (!isRecord(v)) return false;
  return (
    typeof v.fr === "number" &&
    typeof v.w === "number" &&
    typeof v.h === "number" &&
    Array.isArray(v.layers)
  );
}

/** Validate unknown input as a Lottie animation; throws a clear Error. */
export function parseLottieAnimationData(v: unknown): LottieAnimationData {
  if (!isRecord(v)) throw new Error("That file is not a Lottie animation (expected a JSON object).");
  if (typeof v.fr !== "number" || !(v.fr > 0)) {
    throw new Error("That file is not a Lottie animation (missing frame rate).");
  }
  if (!Array.isArray(v.layers)) {
    throw new Error("That file is not a Lottie animation (missing layers).");
  }
  if (typeof v.w !== "number" || typeof v.h !== "number" || v.w <= 0 || v.h <= 0) {
    throw new Error("That file is not a Lottie animation (missing canvas size).");
  }
  return v as LottieAnimationData;
}

function frameRate(anim: LottieAnimationData): number {
  return typeof anim.fr === "number" && anim.fr > 0 ? anim.fr : 30;
}

export function lottieInFrame(anim: LottieAnimationData): number {
  return typeof anim.ip === "number" ? anim.ip : 0;
}

export function lottieOutFrame(anim: LottieAnimationData): number {
  const fr = frameRate(anim);
  return typeof anim.op === "number" && anim.op > lottieInFrame(anim)
    ? anim.op
    : lottieInFrame(anim) + fr;
}

/** Full play length of one pass through the animation, in ms. */
export function lottieDurationMs(anim: LottieAnimationData): number {
  return ((lottieOutFrame(anim) - lottieInFrame(anim)) / frameRate(anim)) * 1000;
}

// ---------------------------------------------------------------------------
// Color slots and recolor mapping
// ---------------------------------------------------------------------------

export function rgbArrayToHex(rgb: readonly number[]): string {
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round((typeof v === "number" ? v : 0) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(rgb[0] ?? 0)}${ch(rgb[1] ?? 0)}${ch(rgb[2] ?? 0)}`;
}

export function hexToRgbArray(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface PaintColorRef {
  sid?: string;
  rgb: number[];
}

function collectPaintColors(node: unknown, out: PaintColorRef[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPaintColors(item, out);
    return;
  }
  if (!isRecord(node)) return;
  if ((node.ty === "fl" || node.ty === "st") && isRecord(node.c)) {
    const k = node.c.k;
    const rgb = staticColorValue(k);
    if (rgb) out.push({ sid: typeof node.c.sid === "string" ? node.c.sid : undefined, rgb });
  }
  for (const value of Object.values(node)) collectPaintColors(value, out);
}

function staticColorValue(k: unknown): number[] | null {
  if (Array.isArray(k) && k.length >= 3 && k.every((v) => typeof v === "number")) {
    return k as number[];
  }
  // Keyframed color: use the first keyframe's start value as the default.
  if (
    Array.isArray(k) &&
    k.length > 0 &&
    isRecord(k[0]) &&
    Array.isArray(k[0].s) &&
    (k[0].s as unknown[]).every((v) => typeof v === "number")
  ) {
    return k[0].s as number[];
  }
  return null;
}

/**
 * The shared color slots an animation exposes for recoloring. Paints
 * that carry a slot id (the Generative Icons pack shares one slot,
 * "color.primary", across every icon) group into a single slot, so one
 * inspector color drives the whole icon. Paints without a slot id fall
 * back to one slot per distinct shipped color, keyed "paint:#rrggbb".
 */
export function discoverColorSlots(anim: LottieAnimationData): LottieColorSlot[] {
  const refs: PaintColorRef[] = [];
  collectPaintColors(anim.layers, refs);
  const slots = new Map<string, LottieColorSlot>();
  for (const ref of refs) {
    const hex = rgbArrayToHex(ref.rgb);
    if (ref.sid) {
      if (!slots.has(ref.sid)) {
        slots.set(ref.sid, {
          id: ref.sid,
          label: ref.sid.replace(/^color\./, "").replace(/[._-]+/g, " "),
          defaultColor: hex,
        });
      }
    } else {
      const id = `paint:${hex}`;
      if (!slots.has(id)) slots.set(id, { id, label: `Paint ${hex}`, defaultColor: hex });
    }
  }
  return [...slots.values()];
}

/**
 * Resolve the effective RGB for one paint color property under the
 * recolor overrides. This is the single mapping the renderer uses, so
 * the inspector, the stage, and exports always agree.
 */
export function resolvePaintColor(
  sid: string | undefined,
  rgb: readonly number[],
  colors: Record<string, string> | undefined,
): string {
  if (colors) {
    if (sid && typeof colors[sid] === "string") {
      const rgbOverride = hexToRgbArray(colors[sid]);
      if (rgbOverride) return rgbArrayToHex(rgbOverride);
    }
    if (!sid) {
      const key = `paint:${rgbArrayToHex(rgb)}`;
      if (typeof colors[key] === "string") {
        const rgbOverride = hexToRgbArray(colors[key]);
        if (rgbOverride) return rgbArrayToHex(rgbOverride);
      }
    }
  }
  return rgbArrayToHex(rgb);
}

// ---------------------------------------------------------------------------
// Keyframe sampling
// ---------------------------------------------------------------------------

interface Keyframe {
  t: number;
  s: unknown[];
  h?: number;
  i?: { x?: number[]; y?: number[] };
  o?: { x?: number[]; y?: number[] };
}

function isKeyframeArray(k: unknown): k is Keyframe[] {
  return (
    Array.isArray(k) &&
    k.length > 0 &&
    isRecord(k[0]) &&
    typeof k[0].t === "number" &&
    Array.isArray(k[0].s)
  );
}

/** Cubic bezier easing solve: given x progress, return y progress. */
function bezierEase(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const cy = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let iter = 0; iter < 24; iter++) {
    t = (lo + hi) / 2;
    if (cx(t) < x) lo = t;
    else hi = t;
  }
  return cy(t);
}

function lerpValue(a: unknown, b: unknown, p: number): unknown {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((v, i) => lerpValue(v, b[i], p));
  }
  if (isRecord(a) && isRecord(b)) {
    // A bezier path shape: { v, i, o, c } interpolates vertex by vertex.
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(a)) out[key] = lerpValue(a[key], b[key], p);
    return out;
  }
  return p < 1 ? a : b;
}

/**
 * Sample one Lottie property at a frame. Static properties return their
 * value; keyframed properties interpolate between the surrounding
 * keyframes with the authored easing (hold keyframes hold). Returns a
 * number, a number array, a path shape record, or undefined.
 */
export function sampleProperty(prop: unknown, frame: number): unknown {
  if (!isRecord(prop)) return undefined;
  const k = prop.k;
  if (!isKeyframeArray(k)) return k;
  if (frame <= k[0].t) return unwrap(k[0].s);
  const last = k[k.length - 1];
  if (frame >= last.t) return unwrap(last.s);
  for (let i = 0; i < k.length - 1; i++) {
    const from = k[i];
    const to = k[i + 1];
    if (frame < from.t || frame >= to.t) continue;
    if (from.h === 1) return unwrap(from.s);
    const span = to.t - from.t;
    const raw = span > 0 ? (frame - from.t) / span : 1;
    const x1 = from.o?.x?.[0] ?? 0;
    const y1 = from.o?.y?.[0] ?? 0;
    const x2 = to.i?.x?.[0] ?? 1;
    const y2 = to.i?.y?.[0] ?? 1;
    const eased = bezierEase(raw, x1, y1, x2, y2);
    const a = unwrap(from.s);
    const b = unwrap(to.s);
    return lerpValue(a, b, eased);
  }
  return unwrap(last.s);
}

function unwrap(s: unknown[]): unknown {
  return s.length === 1 ? s[0] : s;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numPair(value: unknown, fallback: [number, number] = [0, 0]): [number, number] {
  if (Array.isArray(value)) return [num(value[0], fallback[0]), num(value[1], fallback[1])];
  if (typeof value === "number") return [value, value];
  return fallback;
}

// ---------------------------------------------------------------------------
// 2D matrices (SVG convention: [a c e; b d f])
// ---------------------------------------------------------------------------

interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function translate(x: number, y: number): Mat {
  return { ...IDENTITY, e: x, f: y };
}

function rotate(deg: number): Mat {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

function scale(x: number, y: number): Mat {
  return { ...IDENTITY, a: x, d: y };
}

/** Sample a Lottie transform block (layer ks or group tr) to a matrix. */
function transformMatrix(ks: Record<string, unknown> | undefined, frame: number): Mat {
  if (!ks) return IDENTITY;
  const [px, py] = numPair(sampleProperty(ks.p, frame));
  const [ax, ay] = numPair(sampleProperty(ks.a, frame));
  const [sx, sy] = numPair(sampleProperty(ks.s, frame), [100, 100]);
  const r = num(sampleProperty(ks.r, frame));
  const sk = num(sampleProperty(ks.sk, frame));
  const sa = num(sampleProperty(ks.sa, frame));
  let m = multiply(translate(px, py), rotate(r));
  if (sk !== 0) {
    const shear: Mat = { ...IDENTITY, c: Math.tan((sk * Math.PI) / 180) };
    m = multiply(m, multiply(rotate(sa), multiply(shear, rotate(-sa))));
  }
  m = multiply(m, scale(sx / 100, sy / 100));
  m = multiply(m, translate(-ax, -ay));
  return m;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function matAttr(m: Mat): string {
  if (
    m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
  ) {
    return "";
  }
  return ` transform="matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})"`;
}

// ---------------------------------------------------------------------------
// Shape rendering
// ---------------------------------------------------------------------------

interface Trim {
  s: number;
  e: number;
  o: number;
}

interface RenderCtx {
  colors?: Record<string, string>;
}

function pathFromShape(shape: Record<string, unknown>): string {
  const v = (shape.v as number[][]) ?? [];
  const inn = (shape.i as number[][]) ?? [];
  const out = (shape.o as number[][]) ?? [];
  if (v.length === 0) return "";
  const pt = (p: number[]) => `${fmt(p[0] ?? 0)},${fmt(p[1] ?? 0)}`;
  let d = `M${pt(v[0])}`;
  const segments = shape.c ? v.length : v.length - 1;
  for (let i = 0; i < segments; i++) {
    const next = v[(i + 1) % v.length];
    const c1: [number, number] = [
      (v[i][0] ?? 0) + (out[i]?.[0] ?? 0),
      (v[i][1] ?? 0) + (out[i]?.[1] ?? 0),
    ];
    const c2: [number, number] = [
      (next[0] ?? 0) + (inn[(i + 1) % v.length]?.[0] ?? 0),
      (next[1] ?? 0) + (inn[(i + 1) % v.length]?.[1] ?? 0),
    ];
    d += `C${fmt(c1[0])},${fmt(c1[1])} ${fmt(c2[0])},${fmt(c2[1])} ${pt(next)}`;
  }
  if (shape.c) d += "Z";
  return d;
}

function geometryElement(item: Record<string, unknown>, frame: number): string | null {
  switch (item.ty) {
    case "sh": {
      const shape = sampleProperty(item.ks, frame);
      if (!isRecord(shape)) return null;
      const d = pathFromShape(shape);
      return d ? `<path d="${d}"/>` : null;
    }
    case "el": {
      const [cx, cy] = numPair(sampleProperty(item.p, frame));
      const [w, h] = numPair(sampleProperty(item.s, frame));
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}"/>`;
    }
    case "rc": {
      const [cx, cy] = numPair(sampleProperty(item.p, frame));
      const [w, h] = numPair(sampleProperty(item.s, frame));
      const r = num(sampleProperty(item.r, frame));
      return `<rect x="${fmt(cx - w / 2)}" y="${fmt(cy - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(r)}"/>`;
    }
    case "sr": {
      const [px, py] = numPair(sampleProperty(item.p, frame));
      const points = Math.max(3, Math.round(num(item.pt, 5)));
      const outer = num(sampleProperty(item.or, frame), 10);
      const rot = num(sampleProperty(item.r, frame));
      const isStar = num(item.sy, 1) === 1;
      const inner = isStar ? num(sampleProperty(item.ir, frame), outer / 2) : outer;
      const total = isStar ? points * 2 : points;
      const coords: string[] = [];
      for (let i = 0; i < total; i++) {
        const radius = isStar && i % 2 === 1 ? inner : outer;
        const ang = ((rot + (i * 360) / total - 90) * Math.PI) / 180;
        coords.push(`${fmt(px + radius * Math.cos(ang))},${fmt(py + radius * Math.sin(ang))}`);
      }
      return `<polygon points="${coords.join(" ")}"/>`;
    }
    default:
      return null;
  }
}

function paintAttrs(
  item: Record<string, unknown>,
  frame: number,
  layerOpacity: number,
  ctx: RenderCtx,
  trims: Trim[],
): { attrs: string; isStroke: boolean } | null {
  const colorProp = item.c as Record<string, unknown> | undefined;
  if (!colorProp) return null;
  const rgb = sampleProperty(colorProp, frame);
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  const sid = typeof colorProp.sid === "string" ? colorProp.sid : undefined;
  const color = resolvePaintColor(sid, rgb as number[], ctx.colors);
  const paintOpacity = num(sampleProperty(item.o, frame), 100) / 100;
  const alpha = Math.max(0, Math.min(1, (num(rgb[3], 1)) * paintOpacity * layerOpacity));
  if (item.ty === "fl") {
    const rule = num(item.r, 1) === 2 ? ` fill-rule="evenodd"` : "";
    return { attrs: ` fill="${color}" fill-opacity="${fmt(alpha)}"${rule}`, isStroke: false };
  }
  if (item.ty === "st") {
    const width = num(sampleProperty(item.w, frame), 1);
    const cap = num(item.lc, 1) === 2 ? "round" : num(item.lc, 1) === 3 ? "square" : "butt";
    const join = num(item.lj, 1) === 2 ? "round" : num(item.lj, 1) === 3 ? "bevel" : "miter";
    let attrs =
      ` fill="none" stroke="${color}" stroke-opacity="${fmt(alpha)}"` +
      ` stroke-width="${fmt(width)}" stroke-linecap="${cap}" stroke-linejoin="${join}"` +
      ` stroke-miterlimit="${fmt(num(item.ml, 4))}"`;
    const dashes = item.d as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(dashes) && dashes.length > 0) {
      const parts = dashes
        .filter((d) => d.n === "d" || d.n === "g")
        .map((d) => fmt(num(sampleProperty(d.v, frame))));
      if (parts.length > 0) attrs += ` stroke-dasharray="${parts.join(" ")}"`;
    }
    for (const trim of trims) {
      const len = Math.max(0, Math.min(100, trim.e - trim.s));
      if (len < 100) {
        const start = (((trim.s + trim.o) % 100) + 100) % 100;
        attrs += ` pathLength="100" stroke-dasharray="${fmt(len)} 100" stroke-dashoffset="${fmt(-start)}"`;
      }
    }
    return { attrs, isStroke: true };
  }
  return null;
}

/**
 * Render one shape item list (a layer's shapes, or a group's items) at
 * a frame. Geometry accumulates until a paint item, which paints every
 * geometry collected since the previous paint, matching Lottie group
 * semantics. Groups recurse with their own transform and opacity.
 */
function renderShapeItems(
  items: unknown[],
  frame: number,
  layerOpacity: number,
  ctx: RenderCtx,
): string {
  const trims: Trim[] = [];
  for (const raw of items) {
    if (isRecord(raw) && raw.ty === "tm") {
      trims.push({
        s: num(sampleProperty(raw.s, frame)),
        e: num(sampleProperty(raw.e, frame), 100),
        o: num(sampleProperty(raw.o, frame)),
      });
    }
  }
  let out = "";
  let pending: string[] = [];
  const flush = (paint: Record<string, unknown>) => {
    if (pending.length === 0) return;
    const painted = paintAttrs(paint, frame, layerOpacity, ctx, trims);
    if (painted) {
      for (const geo of pending) out += geo.replace(/\/>$/, `${painted.attrs}/>`);
    }
    pending = [];
  };
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    if (raw.ty === "gr") {
      const inner = Array.isArray(raw.it) ? raw.it : [];
      const tr = inner.find((i) => isRecord(i) && i.ty === "tr") as
        | Record<string, unknown>
        | undefined;
      const groupOpacity = tr ? num(sampleProperty(tr.o, frame), 100) / 100 : 1;
      const mat = tr ? transformMatrix(tr, frame) : IDENTITY;
      const body = renderShapeItems(
        inner.filter((i) => !(isRecord(i) && i.ty === "tr")),
        frame,
        layerOpacity * groupOpacity,
        ctx,
      );
      if (body) out += `<g${matAttr(mat)}>${body}</g>`;
    } else if (raw.ty === "fl" || raw.ty === "st") {
      flush(raw);
    } else if (raw.ty === "tm" || raw.ty === "tr") {
      continue;
    } else {
      const geo = geometryElement(raw, frame);
      if (geo) pending.push(geo);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer rendering and the public entry points
// ---------------------------------------------------------------------------

function renderLayer(
  layer: RawLayer,
  childrenOf: Map<number, RawLayer[]>,
  frame: number,
  ctx: RenderCtx,
  inheritedOpacity: number,
): string {
  const ip = typeof layer.ip === "number" ? layer.ip : 0;
  const op = typeof layer.op === "number" ? layer.op : Number.POSITIVE_INFINITY;
  if (frame < ip || frame >= op) return "";
  const st = typeof layer.st === "number" ? layer.st : 0;
  const sr = typeof layer.sr === "number" && layer.sr !== 0 ? layer.sr : 1;
  const localFrame = st + (frame - st) / sr;
  const ks = (layer.ks ?? {}) as Record<string, unknown>;
  const opacity = inheritedOpacity * (num(sampleProperty(ks.o, localFrame), 100) / 100);
  if (opacity <= 0) return "";
  const mat = transformMatrix(ks, localFrame);
  let body = "";
  if (layer.ty === 4 && Array.isArray(layer.shapes)) {
    body += renderShapeItems(layer.shapes, localFrame, opacity, ctx);
  }
  const children = (layer.ind !== undefined ? childrenOf.get(layer.ind) : undefined) ?? [];
  // Children paint above their parent layer's own shapes, later array
  // entries first in Lottie order, so iterate in reverse.
  for (let i = children.length - 1; i >= 0; i--) {
    body += renderLayer(children[i], childrenOf, frame, ctx, opacity);
  }
  if (!body) return "";
  return `<g${matAttr(mat)}>${body}</g>`;
}

/**
 * The Lottie frame (in animation frames, float) shown at a local scene
 * time. Looping wraps into [ip, op); non looping clamps to the last
 * frame. Speed multiplies the rate. Pure: same inputs, same frame.
 */
export function lottieFrameAtTime(
  anim: LottieAnimationData,
  localMs: number,
  options: LottieRenderOptions = {},
): number {
  const ip = lottieInFrame(anim);
  const op = lottieOutFrame(anim);
  const speed = options.speed !== undefined && options.speed > 0 ? options.speed : 1;
  const loop = options.loop !== false;
  const raw = ip + ((Math.max(0, localMs) / 1000) * frameRate(anim) * speed);
  if (raw < op) return raw;
  if (!loop) return op - 1 / frameRate(anim);
  const span = op - ip;
  return ip + ((raw - ip) % span);
}

/** Quantize a scene time to an export frame grid (30 fps by default). */
export function quantizeMsToFps(ms: number, fps = 30): number {
  if (!(fps > 0)) return ms;
  // Multiply before dividing so whole frame buckets stay exact.
  return (Math.floor((ms / 1000) * fps) * 1000) / fps;
}

/** Render the animation at an exact frame to an SVG string. */
export function renderLottieFrameSvg(
  anim: LottieAnimationData,
  frame: number,
  options: LottieRenderOptions = {},
): string {
  const w = num(anim.w, 32);
  const h = num(anim.h, 32);
  const layers = (Array.isArray(anim.layers) ? anim.layers : []) as RawLayer[];
  const byInd = new Map<number, RawLayer>();
  const childrenOf = new Map<number, RawLayer[]>();
  for (const layer of layers) {
    if (typeof layer.ind === "number") byInd.set(layer.ind, layer);
  }
  for (const layer of layers) {
    if (typeof layer.parent === "number") {
      const list = childrenOf.get(layer.parent) ?? [];
      list.push(layer);
      childrenOf.set(layer.parent, list);
    }
  }
  const ctx: RenderCtx = { colors: options.colors };
  let body = "";
  const roots = layers.filter((l) => typeof l.parent !== "number" || !byInd.has(l.parent));
  for (let i = roots.length - 1; i >= 0; i--) {
    body += renderLayer(roots[i], childrenOf, frame, ctx, 1);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}"` +
    ` preserveAspectRatio="xMidYMid meet">${body}</svg>`
  );
}

/**
 * Render the animation at a local scene time (ms from the object's
 * clip start). This is the one entry point the stage and both export
 * paths share.
 */
export function renderLottieSvg(
  anim: LottieAnimationData,
  localMs: number,
  options: LottieRenderOptions = {},
): string {
  return renderLottieFrameSvg(anim, lottieFrameAtTime(anim, localMs, options), options);
}

/** Inline SVG as a data URI, for canvas drawImage in the export paths. */
export function lottieSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
