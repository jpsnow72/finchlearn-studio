/**
 * Render planning and parity core (issues #8 and #48).
 *
 * The render spike decision (docs/render-spike.md): one shared scene
 * renderer feeds both export paths, so preview and export cannot drift.
 * This package holds the parts both paths share and the golden frame tests
 * exercise: the segment plan (scenes split for parallel server rendering
 * and caching) and the frame parity metric (the #8 exit criterion:
 * exported frames must match the stage canvas, pixel for pixel within a
 * tight tolerance, at sampled timestamps).
 */
import type { StudioProject } from "@finch-studio/schema";
import { projectTimeline } from "@finch-studio/schema";

export interface RenderSegment {
  sceneId: string;
  index: number;
  startMs: number;
  endMs: number;
  /** Cache key inputs: bump any of these and the segment re-renders. */
  cacheKey: string;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Split a project into per scene segments for parallel rendering + caching. */
export function planSegments(project: StudioProject): RenderSegment[] {
  const { scenes } = projectTimeline(project);
  return scenes.map((t, i) => ({
    sceneId: t.scene.id,
    index: i,
    startMs: t.startMs,
    endMs: t.endMs,
    cacheKey: `seg-${t.scene.id}-${hashString(JSON.stringify(t.scene))}`,
  }));
}

/** Which path a render takes, and why (the #48 promotion rule). */
export function chooseRenderPath(input: {
  hasFootage: boolean;
  heavyTracks: boolean;
  webCodecsSupported: boolean;
  headless: boolean;
}): { path: "client" | "server"; reason: string } {
  if (input.headless) return { path: "server", reason: "headless MCP batch render" };
  if (!input.webCodecsSupported) return { path: "server", reason: "WebCodecs unavailable in this browser" };
  if (input.heavyTracks) return { path: "server", reason: "heavy multi track footage" };
  if (input.hasFootage) return { path: "client", reason: "standard timeline with footage" };
  return { path: "client", reason: "standard timeline" };
}

// ---------------------------------------------------------------------------
// Frame parity (#8 exit criterion)
// ---------------------------------------------------------------------------

export interface FramePixels {
  width: number;
  height: number;
  /** RGBA bytes, width * height * 4. */
  data: Uint8ClampedArray;
}

export interface ParityResult {
  /** Mean absolute per channel difference, 0..255. */
  meanAbsDiff: number;
  /** Fraction of pixels differing by more than the per channel tolerance. */
  driftFraction: number;
  pass: boolean;
}

export function compareFrames(
  a: FramePixels,
  b: FramePixels,
  opts: { channelTolerance?: number; maxDriftFraction?: number } = {},
): ParityResult {
  const tol = opts.channelTolerance ?? 2;
  const maxDrift = opts.maxDriftFraction ?? 0.001;
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    return { meanAbsDiff: 255, driftFraction: 1, pass: false };
  }
  let sum = 0;
  let drifted = 0;
  const pixels = a.width * a.height;
  for (let p = 0; p < pixels; p++) {
    let pixelDrift = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]);
      sum += d;
      if (d > tol) pixelDrift = true;
    }
    if (pixelDrift) drifted++;
  }
  const driftFraction = pixels === 0 ? 0 : drifted / pixels;
  return {
    meanAbsDiff: pixels === 0 ? 0 : sum / (pixels * 4),
    driftFraction,
    pass: driftFraction <= maxDrift,
  };
}

/** Timestamps the golden frame suite samples for a project of totalMs. */
export function goldenSampleTimes(totalMs: number): number[] {
  if (totalMs <= 0) return [0];
  const times = new Set<number>([0, Math.floor(totalMs / 2), totalMs - 40]);
  const step = Math.max(500, Math.floor(totalMs / 8));
  for (let t = step; t < totalMs - 40; t += step) times.add(t);
  return [...times].sort((x, y) => x - y);
}
