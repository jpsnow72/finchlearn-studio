/**
 * Video matting core (Studio issue #122, gap G-7): background removal
 * for recorded footage, built on Robust Video Matting (RVM).
 *
 * Design (decided 2026-11-22, G7-G8-SERVICE-DECISIONS.md option 1):
 * the matte is computed ONCE and stored as a media asset, keyed to the
 * source footage plus the model version. Compositing is a pure pixel
 * function in this module, shared by the WebCodecs preview path and
 * the server FFmpeg export path, so preview and export cannot drift:
 * both composite the same stored matte over the same replacement.
 *
 * Processing model: preview inference runs in the browser through
 * ONNX Runtime Web behind the MattingAdapter seam; export inference
 * runs on finch-render through the same seam (services/render matte
 * jobs). Neither path re-runs inference differently at composite time:
 * compositing only ever consumes the stored matte asset.
 *
 * The RVM model file is NOT bundled. It loads as an external asset
 * through the existing media asset mechanism (RVM_MODEL_ASSET_KEY),
 * and the inference session sits behind MattingAdapter so tests drive
 * the whole pipeline with a fake adapter. Nothing here fakes a model:
 * an adapter that cannot load the model fails honestly.
 */

export const RVM_MODEL_VERSION = "rvm-mobilenetv3-1.0.0";
/** R2 style asset key the RVM ONNX model is served from. */
export const RVM_MODEL_ASSET_KEY = "models/rvm/rvm_mobilenetv3.onnx";
export const RVM_MODEL_INPUT_SIZE = 512;

export interface RvmModelDescriptor {
  version: string;
  assetKey: string;
  /** Square inference input edge the model is fed at. */
  inputSize: number;
  /** ONNX input names, in feed order: src, r1i, r2i, r3i, r4i, downsample ratio. */
  inputs: readonly string[];
  /** ONNX output names: fgr, pha (alpha), r1o, r2o, r3o, r4o. */
  outputs: readonly string[];
}

export const RVM_MODEL: RvmModelDescriptor = {
  version: RVM_MODEL_VERSION,
  assetKey: RVM_MODEL_ASSET_KEY,
  inputSize: RVM_MODEL_INPUT_SIZE,
  inputs: ["src", "r1i", "r2i", "r3i", "r4i", "downsample_ratio"],
  outputs: ["fgr", "pha", "r1o", "r2o", "r3o", "r4o"],
};

/** What replaces a removed background. */
export type MatteReplacement =
  | { kind: "color"; color: string }
  | { kind: "image"; assetId: string; r2Key?: string }
  | { kind: "scene-background"; sceneId: string; background?: string };

export const MATTE_REPLACEMENT_KINDS = ["color", "image", "scene-background"] as const;

export type MatteJobState = "idle" | "queued" | "processing" | "ready" | "error";

export interface MatteJob {
  state: MatteJobState;
  /** 0 to 1 across the whole clip, clamped by the transition helper. */
  progress: number;
  error?: string;
  matte?: MatteAssetDescriptor;
}

export interface MatteRequest {
  sourceAssetId: string;
  /** Content hash of the source footage, from MediaAsset.contentHash at ingest. */
  sourceContentHash?: string;
  sourceR2Key?: string;
  modelVersion?: string;
  replacement: MatteReplacement;
}

/**
 * A computed matte, stored as an asset. The alpha track is a grayscale
 * video or frame sequence asset in R2; this descriptor is the record
 * every render path resolves, keyed by matteCacheKey.
 */
export interface MatteAssetDescriptor {
  id: string;
  kind: "matte";
  sourceAssetId: string;
  sourceContentHash?: string;
  modelVersion: string;
  r2Key: string;
  /** Matte service job that produced this matte, when it came from one. */
  jobId?: string;
  /** Per job token for the matte service file route, paired with jobId. */
  jobToken?: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  frameCount: number;
}

/** Deterministic cache key: same source plus same model, same matte. */
export function matteCacheKey(source: { sourceAssetId: string; sourceContentHash?: string }, modelVersion: string = RVM_MODEL_VERSION): string {
  const hash = (source.sourceContentHash ?? "nohash").replace(/[^a-zA-Z0-9_-]/g, "");
  const asset = source.sourceAssetId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `matte:${asset}:${hash}:${modelVersion}`;
}

/** R2 key a matte for this request is stored under. */
export function matteR2Key(request: MatteRequest): string {
  return `mattes/${matteCacheKey(request, request.modelVersion ?? RVM_MODEL_VERSION).replace(/:/g, "/")}.mp4`;
}

export function createMatteAssetDescriptor(
  request: MatteRequest,
  dims: { width: number; height: number; fps: number; durationMs: number },
  job?: { jobId: string; jobToken: string },
): MatteAssetDescriptor {
  const modelVersion = request.modelVersion ?? RVM_MODEL_VERSION;
  const fps = Math.max(1, Math.round(dims.fps || 30));
  return {
    id: matteCacheKey(request, modelVersion),
    kind: "matte",
    sourceAssetId: request.sourceAssetId,
    sourceContentHash: request.sourceContentHash,
    modelVersion,
    r2Key: matteR2Key(request),
    jobId: job?.jobId,
    jobToken: job?.jobToken,
    width: Math.max(1, Math.round(dims.width)),
    height: Math.max(1, Math.round(dims.height)),
    fps,
    durationMs: Math.max(0, Math.round(dims.durationMs)),
    frameCount: Math.max(1, Math.round((Math.max(0, dims.durationMs) / 1000) * fps)),
  };
}

export function createMatteJob(): MatteJob {
  return { state: "idle", progress: 0 };
}

const JOB_FLOW: Record<MatteJobState, readonly MatteJobState[]> = {
  idle: ["queued", "error"],
  queued: ["processing", "error"],
  processing: ["ready", "error"],
  ready: [],
  error: ["queued"],
};

/** Advance a matte job, rejecting illegal transitions instead of drifting. */
export function transitionMatteJob(job: MatteJob, next: MatteJobState, patch: Partial<MatteJob> = {}): MatteJob {
  if (!JOB_FLOW[job.state].includes(next)) {
    throw new Error(`matte job cannot move from ${job.state} to ${next}`);
  }
  return {
    ...job,
    ...patch,
    state: next,
    progress: Math.min(1, Math.max(0, patch.progress ?? job.progress)),
  };
}

// ---------------------------------------------------------------------------
// Inference seam. A frame is plain RGBA bytes so the seam runs in the
// browser, on the render host, and in tests with no DOM or ONNX types.
// ---------------------------------------------------------------------------

export interface RgbaFrame {
  width: number;
  height: number;
  /** RGBA bytes, width times height times 4. */
  data: Uint8ClampedArray;
}

export interface MattingAdapter {
  /** "browser-onnx" for preview, "finch-render" for export, "fake" in tests. */
  id: string;
  modelVersion: string;
  /**
   * Alpha for one frame: one byte per pixel, 0 background to 255
   * foreground. Recurrent state is the adapter's own business (RVM
   * carries four recurrent tensors between frames).
   */
  inferAlpha(frame: RgbaFrame): Promise<Uint8ClampedArray>;
  reset(): void;
}

/** Deterministic fake adapter for tests: alpha from a caller supplied rule. */
export function createFakeMattingAdapter(
  rule: (frame: RgbaFrame, pixelIndex: number) => number,
  modelVersion: string = RVM_MODEL_VERSION,
): MattingAdapter {
  return {
    id: "fake",
    modelVersion,
    reset() {},
    async inferAlpha(frame) {
      const out = new Uint8ClampedArray(frame.width * frame.height);
      for (let i = 0; i < out.length; i++) {
        out[i] = Math.min(255, Math.max(0, Math.round(rule(frame, i))));
      }
      return out;
    },
  };
}

/** Run an adapter over frames, reporting progress, returning alpha tracks. */
export async function computeMatteFrames(
  adapter: MattingAdapter,
  frames: RgbaFrame[],
  onProgress?: (progress: number) => void,
): Promise<Uint8ClampedArray[]> {
  adapter.reset();
  const out: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames.length; i++) {
    const alpha = await adapter.inferAlpha(frames[i]);
    if (alpha.length !== frames[i].width * frames[i].height) {
      throw new Error(`matting adapter returned ${alpha.length} alpha bytes for a ${frames[i].width}x${frames[i].height} frame`);
    }
    out.push(alpha);
    onProgress?.((i + 1) / Math.max(1, frames.length));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compositing: THE shared path. Preview and export both call
// compositeFrame with the stored matte; there is no second formula.
// ---------------------------------------------------------------------------

export function parseHexColor(color: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** One pixel of alpha compositing: foreground over background by alpha. */
export function compositePixel(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
  alpha: number,
): { r: number; g: number; b: number } {
  const a = Math.min(1, Math.max(0, alpha));
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
}

/**
 * Composite one source frame over a replacement using a stored alpha
 * matte. The replacement is either a solid RGB triple or a background
 * frame of the same size (an image or another scene background,
 * already drawn to frame size by the caller through the same asset
 * mechanism both paths use).
 */
export function compositeFrame(
  source: RgbaFrame,
  alpha: Uint8ClampedArray,
  replacement: { r: number; g: number; b: number } | RgbaFrame,
): RgbaFrame {
  if (alpha.length !== source.width * source.height) {
    throw new Error("matte alpha size does not match the source frame");
  }
  const bgFrame = "data" in replacement ? replacement : null;
  if (bgFrame && (bgFrame.width !== source.width || bgFrame.height !== source.height)) {
    throw new Error("replacement frame size does not match the source frame");
  }
  const out = new Uint8ClampedArray(source.data.length);
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const bg = bgFrame
      ? { r: bgFrame.data[i], g: bgFrame.data[i + 1], b: bgFrame.data[i + 2] }
      : (replacement as { r: number; g: number; b: number });
    const px = compositePixel(
      { r: source.data[i], g: source.data[i + 1], b: source.data[i + 2] },
      bg,
      alpha[p] / 255,
    );
    out[i] = px.r;
    out[i + 1] = px.g;
    out[i + 2] = px.b;
    out[i + 3] = 255;
  }
  return { width: source.width, height: source.height, data: out };
}

/** Validate a replacement pick before any inference time is spent. */
export function validateMatteReplacement(replacement: MatteReplacement): string | null {
  if (replacement.kind === "color") {
    return /^#?[0-9a-fA-F]{6}$/.test(replacement.color.trim())
      ? null
      : "Pick a replacement colour as a six digit hex value.";
  }
  if (replacement.kind === "image") {
    return replacement.assetId.trim() ? null : "Pick a replacement image from the media library first.";
  }
  return replacement.sceneId.trim() ? null : "Pick which scene background to use first.";
}

export const MATTE_HONEST_NOTE = "Background removal works best for people on camera. Other subjects may keep rough edges.";
