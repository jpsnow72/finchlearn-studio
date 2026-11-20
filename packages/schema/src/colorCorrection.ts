/**
 * Colour correction basics (issue #46): one Auto fix plus manual sliders
 * for exposure, contrast, white balance (temperature and tint), and
 * saturation. No wheels, scopes, or HSL.
 *
 * A correction is non-destructive metadata: five numbers in the range
 * -100 to 100, all zero meaning neutral (the object renders exactly as
 * it did before this feature existed). The single source of truth for
 * rendering is the 4x5 colour matrix from `colorMatrixFor`. Every
 * render path applies that same matrix:
 * - the stage preview applies it with an SVG feColorMatrix filter,
 * - the browser exports apply it per pixel to a corrected copy of the
 *   image before drawing it on the export canvas,
 * - the server render runs the same browser export code in its render
 *   node, so its frames carry the same correction before FFmpeg.
 */

export interface ColorCorrection {
  /** Exposure in stops-ish units: +50 doubles brightness, -50 halves it. */
  exposure: number;
  /** Contrast: +100 doubles contrast around mid grey, -100 flattens to grey. */
  contrast: number;
  /** White balance temperature: positive warms (more red, less blue). */
  temperature: number;
  /** White balance tint: positive shifts magenta, negative shifts green. */
  tint: number;
  /** Saturation: +100 doubles saturation, -100 removes all colour. */
  saturation: number;
}

export const COLOR_CORRECTION_KEYS = [
  "exposure",
  "contrast",
  "temperature",
  "tint",
  "saturation",
] as const satisfies readonly (keyof ColorCorrection)[];

export const NEUTRAL_COLOR_CORRECTION: ColorCorrection = {
  exposure: 0,
  contrast: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
};

/**
 * Conservative preset used by Auto fix when the media's own statistics
 * cannot be read (for example a cross-origin image the browser will not
 * let us sample, or a video object with no preview frame yet). It is a
 * gentle lift, never a strong grade.
 */
export const AUTO_FIX_FALLBACK: ColorCorrection = {
  exposure: 5,
  contrast: 10,
  temperature: 0,
  tint: 0,
  saturation: 10,
};

export const COLOR_CORRECTION_MIN = -100;
export const COLOR_CORRECTION_MAX = 100;

function clampValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(
    COLOR_CORRECTION_MAX,
    Math.max(COLOR_CORRECTION_MIN, value),
  );
}

/** Clamp every slider into range; non-finite values become neutral. */
export function clampColorCorrection(
  correction: ColorCorrection,
): ColorCorrection {
  return {
    exposure: clampValue(correction.exposure),
    contrast: clampValue(correction.contrast),
    temperature: clampValue(correction.temperature),
    tint: clampValue(correction.tint),
    saturation: clampValue(correction.saturation),
  };
}

/**
 * Read a correction out of untrusted JSON (project files, the OCF
 * sidecar, object extensions). Returns undefined when no correction
 * object is present; present-but-partial data fills the rest neutral.
 */
export function sanitizeColorCorrection(
  raw: unknown,
): ColorCorrection | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const out = { ...NEUTRAL_COLOR_CORRECTION };
  for (const key of COLOR_CORRECTION_KEYS) {
    const value = record[key];
    if (typeof value === "number") out[key] = clampValue(value);
  }
  return out;
}

export function isNeutralColorCorrection(
  correction: ColorCorrection | undefined,
): boolean {
  if (!correction) return true;
  return COLOR_CORRECTION_KEYS.every((key) => correction[key] === 0);
}

export function colorCorrectionsEqual(
  a: ColorCorrection | undefined,
  b: ColorCorrection | undefined,
): boolean {
  const left = a ?? NEUTRAL_COLOR_CORRECTION;
  const right = b ?? NEUTRAL_COLOR_CORRECTION;
  return COLOR_CORRECTION_KEYS.every((key) => left[key] === right[key]);
}

// ---------------------------------------------------------------------------
// The canonical colour matrix
// ---------------------------------------------------------------------------

/** A 4x5 affine colour matrix in row-major order, channels normalized 0 to 1. */
export type ColorMatrix = readonly number[];

const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** Compose two 4x5 affine matrices: result applies `b` first, then `a`. */
function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array<number>(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[row * 5 + k] * b[k * 5 + col];
      out[row * 5 + col] = sum;
    }
    let offset = a[row * 5 + 4];
    for (let k = 0; k < 4; k++) offset += a[row * 5 + k] * b[k * 5 + 4];
    out[row * 5 + 4] = offset;
  }
  return out;
}

function exposureMatrix(exposure: number): number[] {
  const gain = Math.pow(2, exposure / 50);
  return [
    gain, 0, 0, 0, 0,
    0, gain, 0, 0, 0,
    0, 0, gain, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function whiteBalanceMatrix(temperature: number, tint: number): number[] {
  const t = temperature / 100;
  const m = tint / 100;
  const rGain = 1 + 0.25 * t + 0.1 * m;
  const gGain = 1 - 0.2 * m;
  const bGain = 1 - 0.25 * t + 0.1 * m;
  return [
    rGain, 0, 0, 0, 0,
    0, gGain, 0, 0, 0,
    0, 0, bGain, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function saturationMatrix(saturation: number): number[] {
  const s = 1 + saturation / 100;
  const wr = 0.2126;
  const wg = 0.7152;
  const wb = 0.0722;
  return [
    wr + (1 - wr) * s, wg * (1 - s), wb * (1 - s), 0, 0,
    wr * (1 - s), wg + (1 - wg) * s, wb * (1 - s), 0, 0,
    wr * (1 - s), wg * (1 - s), wb + (1 - wb) * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function contrastMatrix(contrast: number): number[] {
  const k = 1 + contrast / 100;
  const offset = 0.5 * (1 - k);
  return [
    k, 0, 0, 0, offset,
    0, k, 0, 0, offset,
    0, 0, k, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

/**
 * The one mapping every render path uses. Stage order, first applied
 * first: exposure, then white balance, then saturation, then contrast.
 * A neutral correction returns the identity matrix exactly.
 */
export function colorMatrixFor(correction: ColorCorrection): ColorMatrix {
  const c = clampColorCorrection(correction);
  if (isNeutralColorCorrection(c)) return [...IDENTITY_MATRIX];
  let matrix = exposureMatrix(c.exposure);
  matrix = multiplyMatrices(whiteBalanceMatrix(c.temperature, c.tint), matrix);
  matrix = multiplyMatrices(saturationMatrix(c.saturation), matrix);
  matrix = multiplyMatrices(contrastMatrix(c.contrast), matrix);
  return matrix;
}

/** The matrix as an SVG feColorMatrix `values` attribute string. */
export function feColorMatrixValues(correction: ColorCorrection): string {
  return colorMatrixFor(correction)
    .map((value) => {
      const rounded = Math.round(value * 1e6) / 1e6;
      return Object.is(rounded, -0) ? "0" : String(rounded);
    })
    .join(" ");
}

/**
 * Apply a colour matrix to RGBA pixels in place (0 to 255 space; the
 * matrix translation column is normalized, so it is scaled by 255).
 * Alpha is left untouched. Used by the export paths on a copy of the
 * image, so the source media is never modified.
 */
export function applyColorMatrixToPixels(
  pixels: Uint8ClampedArray,
  matrix: ColorMatrix,
): void {
  const m = matrix;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    pixels[i] = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4] * 255;
    pixels[i + 1] = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9] * 255;
    pixels[i + 2] = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14] * 255;
  }
}

// ---------------------------------------------------------------------------
// Auto fix
// ---------------------------------------------------------------------------

/** Channel statistics of a piece of media, channels in 0 to 255 space. */
export interface ImageStatistics {
  meanR: number;
  meanG: number;
  meanB: number;
  meanLuma: number;
  stdLuma: number;
}

/** Statistics over an RGBA pixel buffer (already downscaled by the caller). */
export function imageStatisticsFromPixels(
  pixels: Uint8ClampedArray,
): ImageStatistics | null {
  const count = Math.floor(pixels.length / 4);
  if (count === 0) return null;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    sumLuma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const meanLuma = sumLuma / count;
  let variance = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    variance += (luma - meanLuma) ** 2;
  }
  return { meanR, meanG, meanB, meanLuma, stdLuma: Math.sqrt(variance / count) };
}

function clampAutoFix(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Auto fix: compute a sensible correction from the media's own
 * statistics. Exposure aims the mean luma at mid grey, contrast aims
 * the luma spread at a healthy range, white balance follows the grey
 * world assumption (channel means should match), and saturation lifts
 * washed-out media. When no statistics are available the conservative
 * fallback preset is returned instead; this function never invents
 * statistics it was not given.
 */
export function autoFixColorCorrection(
  stats: ImageStatistics | null,
): ColorCorrection {
  if (!stats) return { ...AUTO_FIX_FALLBACK };
  const values = [stats.meanR, stats.meanG, stats.meanB, stats.meanLuma, stats.stdLuma];
  if (values.some((value) => !Number.isFinite(value))) {
    return { ...AUTO_FIX_FALLBACK };
  }
  const exposure = clampAutoFix(
    50 * Math.log2(128 / Math.max(1, stats.meanLuma)),
    -75,
    75,
  );
  const contrast = clampAutoFix(55 - stats.stdLuma, -50, 50);
  const temperature = clampAutoFix((stats.meanB - stats.meanR) * 0.8, -70, 70);
  const tint = clampAutoFix(
    (stats.meanG - (stats.meanR + stats.meanB) / 2) * 0.8,
    -70,
    70,
  );
  const chroma =
    (Math.max(stats.meanR, stats.meanG, stats.meanB) -
      Math.min(stats.meanR, stats.meanG, stats.meanB)) /
    Math.max(1, stats.meanLuma);
  const saturation = clampAutoFix((0.12 - chroma) * 250, -40, 40);
  return clampColorCorrection({
    exposure,
    contrast,
    temperature,
    tint,
    saturation,
  });
}
