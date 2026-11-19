/**
 * Editor colour correction helpers (issue #46).
 *
 * The correction itself lives in @finch-studio/schema as five numbers
 * and one canonical colour matrix. In the editor's project model the
 * numbers travel on the object under extensions["x-finch-studio"]
 * .colorCorrection, the same non-destructive metadata pattern the
 * audio clip metadata uses: the media itself is never modified, the
 * store's shared undo stack covers every change, and an object with no
 * correction stored renders exactly as it did before this feature.
 *
 * Render application:
 * - Stage: StudioObjectRenderer applies the matrix with an SVG
 *   feColorMatrix filter (see feColorMatrixValues).
 * - Browser exports: correctedDrawableFor draws the image to an
 *   offscreen canvas and applies the same matrix per pixel.
 * - Server render: the render node runs the same export code, so its
 *   frames are corrected before the FFmpeg finish.
 */
import type { CourseObject, Extensions } from "@finch-studio/core";
import {
  NEUTRAL_COLOR_CORRECTION,
  applyColorMatrixToPixels,
  autoFixColorCorrection,
  colorMatrixFor,
  imageStatisticsFromPixels,
  isNeutralColorCorrection,
  sanitizeColorCorrection,
  type ColorCorrection,
  type ImageStatistics,
} from "@finch-studio/schema";

export type { ColorCorrection } from "@finch-studio/schema";
export {
  NEUTRAL_COLOR_CORRECTION,
  isNeutralColorCorrection,
} from "@finch-studio/schema";

const STUDIO_EXTENSION = "x-finch-studio";

/** Object types that carry imagery and can be colour corrected. */
export function isColorCorrectableObject(object: CourseObject): boolean {
  return object.type === "image" || object.type === "video";
}

/** The object's stored correction, or the neutral correction. */
export function getObjectColorCorrection(
  object: CourseObject,
): ColorCorrection {
  const raw = object.extensions?.[STUDIO_EXTENSION]?.colorCorrection;
  return sanitizeColorCorrection(raw) ?? { ...NEUTRAL_COLOR_CORRECTION };
}

/**
 * Return the object with the given correction stored. Passing null, or
 * a neutral correction, removes the stored correction entirely, so a
 * reset object serializes exactly like an untouched one.
 */
export function withObjectColorCorrection(
  object: CourseObject,
  correction: ColorCorrection | null,
): CourseObject {
  const metadata: Record<string, unknown> = {
    ...(object.extensions?.[STUDIO_EXTENSION] ?? {}),
  };
  if (correction === null || isNeutralColorCorrection(correction)) {
    delete metadata.colorCorrection;
  } else {
    metadata.colorCorrection = { ...correction };
  }
  const extensions: Extensions = { ...(object.extensions ?? {}) };
  if (Object.keys(metadata).length === 0) delete extensions[STUDIO_EXTENSION];
  else extensions[STUDIO_EXTENSION] = metadata;
  return { ...object, extensions } as CourseObject;
}

/**
 * Sample an image's statistics from a small downscaled copy. Returns
 * null when the browser will not let us read the pixels (for example a
 * cross-origin image without CORS headers): Auto fix then falls back
 * to its conservative preset rather than guessing.
 */
export function sampleImageStatistics(
  img: HTMLImageElement,
): ImageStatistics | null {
  try {
    const maxSide = 64;
    const scale = Math.min(
      1,
      maxSide / Math.max(1, img.naturalWidth, img.naturalHeight),
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    return imageStatisticsFromPixels(data.data);
  } catch {
    return null;
  }
}

/**
 * Auto fix for an image object: load its image, sample its statistics,
 * and compute the correction from them. Any failure along the way
 * yields the conservative fallback preset from autoFixColorCorrection.
 */
export async function computeAutoFixForObject(
  object: CourseObject,
): Promise<ColorCorrection> {
  if (object.type !== "image") {
    // Footage frames are not drawn by any surface on this codebase yet,
    // so there is no frame to sample; be honest and use the preset.
    return autoFixColorCorrection(null);
  }
  const src = (object as { resource?: string }).resource;
  if (!src) return autoFixColorCorrection(null);
  const stats = await new Promise<ImageStatistics | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(sampleImageStatistics(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
  return autoFixColorCorrection(stats);
}

/**
 * A corrected copy of an image (or a video frame, once footage drawing
 * lands) as a canvas, with the canonical matrix applied per pixel.
 * Neutral corrections return null so callers draw the source directly
 * and untouched objects keep the exact pre-feature render path.
 */
export function correctedDrawableFor(
  source: CanvasImageSource & { width?: number; height?: number },
  width: number,
  height: number,
  correction: ColorCorrection,
): HTMLCanvasElement | null {
  if (isNeutralColorCorrection(correction)) return null;
  if (width <= 0 || height <= 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    applyColorMatrixToPixels(imageData.data, colorMatrixFor(correction));
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } catch {
    // A tainted canvas (cross-origin media) cannot be corrected per
    // pixel; the caller draws the source uncorrected rather than
    // failing the whole export.
    return null;
  }
}
