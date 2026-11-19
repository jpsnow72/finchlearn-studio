/**
 * Expressions and lip sync (issue #19). A face is data: eye style, brow
 * style, and a mouth shape, all drawn in a 64 x 64 face space centred on
 * the head bone. Expressions switch the whole set; while a character talks,
 * the mouth comes from the viseme track instead, driven by word timings
 * from the narration audio when available and by a deterministic text
 * approximation otherwise.
 */

export type ExpressionName =
  | "neutral"
  | "happy"
  | "surprised"
  | "concerned"
  | "confused"
  | "laughing"
  | "sad"
  | "angry";

export const EXPRESSION_NAMES: ExpressionName[] = [
  "neutral", "happy", "surprised", "concerned", "confused", "laughing", "sad", "angry",
];

export type EyeStyle = "open" | "happy" | "wide" | "soft" | "closed";
export type BrowStyle = "neutral" | "raised" | "worried" | "angry" | "one-up";

export interface FaceDef {
  eyes: EyeStyle;
  brows: BrowStyle;
  /** Mouth shape id from MOUTH_SHAPES. */
  mouth: MouthShapeId;
}

export const EXPRESSIONS: Record<ExpressionName, FaceDef> = {
  neutral: { eyes: "open", brows: "neutral", mouth: "rest" },
  happy: { eyes: "happy", brows: "raised", mouth: "smile" },
  surprised: { eyes: "wide", brows: "raised", mouth: "o" },
  concerned: { eyes: "soft", brows: "worried", mouth: "flat" },
  confused: { eyes: "open", brows: "one-up", mouth: "flat" },
  laughing: { eyes: "closed", brows: "raised", mouth: "laugh" },
  sad: { eyes: "soft", brows: "worried", mouth: "frown" },
  angry: { eyes: "open", brows: "angry", mouth: "frown" },
};

// ---------------------------------------------------------------------------
// Mouth shapes: expressions and visemes share one shape set.
// Face space: mouth centred at (32, 44), paths drawn in a 28 x 16 box.
// ---------------------------------------------------------------------------

export type MouthShapeId =
  | "rest" | "smile" | "frown" | "flat" | "laugh"
  | "a" | "e" | "i" | "o" | "u" | "m" | "f" | "l" | "s";

export const MOUTH_PATHS: Record<MouthShapeId, string> = {
  rest: "M22 44 Q32 47 42 44",
  smile: "M21 42 Q32 52 43 42",
  frown: "M22 48 Q32 40 42 48",
  flat: "M23 45 L41 45",
  laugh: "M20 41 Q32 56 44 41 Q32 47 20 41 Z",
  a: "M24 40 Q32 58 40 40 Q32 45 24 40 Z",
  e: "M22 42 Q32 50 42 42 Q32 46 22 42 Z",
  i: "M23 43 Q32 48 41 43 L41 45 Q32 49 23 45 Z",
  o: "M27 41 Q32 38 37 41 Q37 50 32 52 Q27 50 27 41 Z",
  u: "M28 42 Q32 40 36 42 Q35 48 32 48 Q29 48 28 42 Z",
  m: "M23 45 L41 45",
  f: "M24 43 L40 43 L39 47 L25 47 Z",
  l: "M25 42 Q32 50 39 42 Q32 45 25 42 Z",
  s: "M23 43 Q32 47 41 43 Q32 45 23 43 Z",
};

export const EYE_PATHS: Record<EyeStyle, { left: string; right: string }> = {
  open: { left: "M18 30 a3.2 4 0 1 0 0.1 0 Z", right: "M43 30 a3.2 4 0 1 0 0.1 0 Z" },
  happy: { left: "M14.5 31 Q18 26 21.5 31", right: "M39.5 31 Q43 26 46.5 31" },
  wide: { left: "M18 30 a3.8 4.8 0 1 0 0.1 0 Z", right: "M43 30 a3.8 4.8 0 1 0 0.1 0 Z" },
  soft: { left: "M15 29 Q18 32 21 29", right: "M40 29 Q43 32 46 29" },
  closed: { left: "M14.5 30 Q18 33 21.5 30", right: "M39.5 30 Q43 33 46.5 30" },
};

export const BROW_PATHS: Record<BrowStyle, { left: string; right: string }> = {
  neutral: { left: "M13.5 22.5 L22.5 22.5", right: "M38.5 22.5 L47.5 22.5" },
  raised: { left: "M13.5 20.5 Q18 18.5 22.5 20.5", right: "M38.5 20.5 Q43 18.5 47.5 20.5" },
  worried: { left: "M13.5 20.5 L22.5 23", right: "M38.5 23 L47.5 20.5" },
  angry: { left: "M13.5 20 L22.5 23.5", right: "M38.5 23.5 L47.5 20" },
  "one-up": { left: "M13.5 20.5 Q18 18.5 22.5 20.5", right: "M38.5 22.5 L47.5 22.5" },
};

// ---------------------------------------------------------------------------
// Visemes: a small, honest approximation. Letters map to mouth shapes;
// real productions refine this with phoneme timings from the TTS stack.
// ---------------------------------------------------------------------------

const LETTER_VISEME: Record<string, MouthShapeId> = {
  a: "a", e: "e", i: "i", o: "o", u: "u",
  m: "m", b: "m", p: "m",
  f: "f", v: "f",
  l: "l",
  s: "s", z: "s", c: "s", x: "s",
  t: "s", d: "s", n: "s", k: "s", g: "s", r: "s", h: "s", j: "s", w: "u", y: "i", q: "s",
};

export interface VisemeCue {
  atMs: number;
  mouth: MouthShapeId;
}

/** Build a viseme track from text at a steady speaking pace. */
export function visemesFromText(text: string, opts: { startMs?: number; msPerChar?: number } = {}): VisemeCue[] {
  const step = opts.msPerChar ?? 82;
  const cues: VisemeCue[] = [];
  let t = opts.startMs ?? 0;
  for (const ch of text.toLowerCase()) {
    const v = LETTER_VISEME[ch];
    if (v) {
      if (cues.length === 0 || cues[cues.length - 1].mouth !== v) cues.push({ atMs: t, mouth: v });
      t += step;
    } else if (ch === " ") {
      cues.push({ atMs: t, mouth: "rest" });
      t += step * 1.6;
    }
  }
  return cues;
}

export function mouthAt(cues: VisemeCue[], tMs: number): MouthShapeId {
  let current: MouthShapeId = "rest";
  for (const c of cues) {
    if (c.atMs <= tMs) current = c.mouth;
    else break;
  }
  return current;
}
