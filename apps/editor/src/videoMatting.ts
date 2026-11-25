/**
 * videoMatting: editor glue for footage background removal (issue
 * #122, gap G-7), following the footageEditing.ts pattern. The setting
 * lives under the video object's x-finch-studio extension so it
 * persists with the project JSON and shares the store's one undo
 * stack, and it mirrors the @finch-studio/schema FootageElement
 * backgroundRemoval field.
 *
 * Processing model (stated for the issue's build notes): preview
 * inference runs in the browser through ONNX Runtime Web behind the
 * media package's MattingAdapter seam, with the RVM model loaded as an
 * external asset (RVM_MODEL_ASSET_KEY), never bundled. Export side
 * inference runs as a finch-render matte job (requestMatteJob below),
 * following serverRender.ts auth and polling patterns. Either way the
 * matte is computed once and stored as an asset keyed to the source
 * footage plus the model version, and BOTH render paths composite
 * that stored matte through compositeFrame in @finch-studio/media.
 * No divergent preview versus export matting exists in this design.
 */
import type { Extensions, VideoObject } from "@finch-studio/core";
import {
  RVM_MODEL,
  compositeFrame,
  parseHexColor,
  validateMatteReplacement,
  type MatteAssetDescriptor,
  type MatteReplacement,
  type MattingAdapter,
  type RgbaFrame,
} from "@finch-studio/media";
import type { FootageBackgroundRemoval } from "@finch-studio/schema";

export type BackgroundRemovalSetting = FootageBackgroundRemoval;
export type { MatteReplacement };

const EXT = "x-finch-studio";
const RENDER_URL = (import.meta.env.VITE_RENDER_URL as string | undefined) ?? "";
const RENDER_KEY = (import.meta.env.VITE_RENDER_KEY as string | undefined) ?? "";
export const matteRenderConfigured = Boolean(RENDER_URL && RENDER_KEY);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getBackgroundRemoval(object: VideoObject): BackgroundRemovalSetting | null {
  const raw = object.extensions?.[EXT];
  if (!isRecord(raw) || !isRecord(raw.backgroundRemoval)) return null;
  const rep = raw.backgroundRemoval.replacement;
  if (!isRecord(rep)) return null;
  const status = raw.backgroundRemoval.status;
  return {
    matteAssetId: typeof raw.backgroundRemoval.matteAssetId === "string" ? raw.backgroundRemoval.matteAssetId : undefined,
    matteR2Key: typeof raw.backgroundRemoval.matteR2Key === "string" ? raw.backgroundRemoval.matteR2Key : undefined,
    modelVersion: typeof raw.backgroundRemoval.modelVersion === "string" ? raw.backgroundRemoval.modelVersion : RVM_MODEL.version,
    replacement: rep as unknown as MatteReplacement,
    status: status === "ready" || status === "error" ? status : "processing",
    error: typeof raw.backgroundRemoval.error === "string" ? raw.backgroundRemoval.error : undefined,
  };
}

/** Set or clear (null) the background removal setting on an object. */
export function withBackgroundRemoval(object: VideoObject, setting: BackgroundRemovalSetting | null): VideoObject {
  const existing: Record<string, unknown> = { ...(object.extensions?.[EXT] ?? {}) };
  if (setting === null) delete existing.backgroundRemoval;
  else existing.backgroundRemoval = setting;
  const extensions: Extensions = { ...(object.extensions ?? {}) };
  extensions[EXT] = existing;
  return { ...object, extensions };
}

export function replacementValidationError(replacement: MatteReplacement): string | null {
  return validateMatteReplacement(replacement);
}

// ---------------------------------------------------------------------------
// Inference adapters.
// ---------------------------------------------------------------------------

interface OnnxTensorLike { data: Float32Array; dims: number[] }
interface OnnxSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}
interface OnnxRuntimeLike {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OnnxTensorLike;
  InferenceSession: { create(source: string | Uint8Array): Promise<OnnxSessionLike> };
}

/**
 * Browser preview adapter: ONNX Runtime Web plus the RVM model loaded
 * from the media asset URL the caller resolves from RVM_MODEL_ASSET_KEY.
 * The runtime is imported dynamically so no model or runtime ships in
 * the editor bundle, and a build without the runtime fails honestly.
 */
export async function createBrowserOnnxAdapter(modelUrl: string): Promise<MattingAdapter> {
  let ort: OnnxRuntimeLike;
  try {
    // A variable specifier on purpose: the runtime is an external
    // asset for builds that enable preview matting, never a bundle
    // dependency, so Vite and TypeScript must not resolve it here.
    const specifier: string = "onnxruntime-web";
    ort = (await import(/* @vite-ignore */ specifier)) as unknown as OnnxRuntimeLike;
  } catch {
    throw new Error("ONNX Runtime Web is not available in this build, so preview matting cannot run here. The finch-render matte job remains available for exports.");
  }
  const session = await ort.InferenceSession.create(modelUrl);
  let recurrent: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1), new Float32Array(1)];
  const size = RVM_MODEL.inputSize;
  return {
    id: "browser-onnx",
    modelVersion: RVM_MODEL.version,
    reset() {
      recurrent = [new Float32Array(1), new Float32Array(1), new Float32Array(1), new Float32Array(1)];
    },
    async inferAlpha(frame: RgbaFrame) {
      const src = new Float32Array(3 * size * size);
      for (let p = 0, i = 0, s = 0; p < size * size; p++, i += 4) {
        src[s++] = frame.data[i] / 255;
        src[size * size + p] = frame.data[i + 1] / 255;
        src[2 * size * size + p] = frame.data[i + 2] / 255;
      }
      const feeds: Record<string, unknown> = {
        src: new ort.Tensor("float32", src, [1, 3, size, size]),
        r1i: new ort.Tensor("float32", recurrent[0], [1, 1, 1, 1]),
        r2i: new ort.Tensor("float32", recurrent[1], [1, 1, 1, 1]),
        r3i: new ort.Tensor("float32", recurrent[2], [1, 1, 1, 1]),
        r4i: new ort.Tensor("float32", recurrent[3], [1, 1, 1, 1]),
        downsample_ratio: new ort.Tensor("float32", new Float32Array([0.25]), [1]),
      };
      const out = await session.run(feeds);
      const pha = out.pha?.data;
      if (!pha) throw new Error("the matting model returned no alpha output");
      const alpha = new Uint8ClampedArray(frame.width * frame.height);
      const n = Math.min(alpha.length, pha.length);
      for (let i = 0; i < n; i++) alpha[i] = Math.round(Math.min(1, Math.max(0, pha[i])) * 255);
      return alpha;
    },
  };
}

// ---------------------------------------------------------------------------
// finch-render matte job client: same key, token, and polling shape as
// serverRender.ts, against POST /matting/jobs on the render service.
// ---------------------------------------------------------------------------

export interface MatteJobResult { jobId: string; matte: MatteAssetDescriptor }

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function requestMatteJob(
  request: { sourceAssetId: string; sourceContentHash?: string; sourceR2Key?: string; replacement: MatteReplacement },
  onStatus: (text: string) => void,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<MatteJobResult> {
  if (!matteRenderConfigured && fetchFn === (fetch as unknown as FetchLike)) {
    throw new Error("Server matting is not configured in this build.");
  }
  const invalid = validateMatteReplacement(request.replacement);
  if (invalid) throw new Error(invalid);
  const begin = await fetchFn(`${RENDER_URL}/matting/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-render-key": RENDER_KEY },
    body: JSON.stringify({ ...request, modelVersion: RVM_MODEL.version }),
  });
  if (!begin.ok) throw new Error(`the render service refused the matte job (${begin.status})`);
  const { jobId, token } = (await begin.json()) as { jobId: string; token: string };
  onStatus("Matte job queued. CPU matting can take a while on long clips.");
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("the matte job timed out (30 minutes)");
    await sleep(3000);
    const poll = await fetchFn(`${RENDER_URL}/jobs/${jobId}`, { headers: { "x-render-token": token } });
    if (!poll.ok) continue;
    const state = (await poll.json()) as { state: string; error?: string | null; matte?: MatteAssetDescriptor; progress?: number };
    if (state.state === "done" && state.matte) return { jobId, matte: state.matte };
    if (state.state === "error") throw new Error(state.error ?? "the matte job failed");
    onStatus(state.progress !== undefined ? `Matte is ${Math.round(state.progress * 100)} percent done.` : "Matte is processing on the render service.");
  }
}

// ---------------------------------------------------------------------------
// Shared canvas compositing. The stage preview helper and the export
// renderer both call drawMattedFrame, which is compositeFrame from the
// media package plus a drawImage: one formula, two surfaces.
// ---------------------------------------------------------------------------

export interface MatteAlphaProvider {
  /** Alpha bytes for the source frame nearest sourceMs, or null. */
  alphaAt(sourceMs: number, width: number, height: number): Uint8ClampedArray | null;
}

const alphaProviders = new Map<string, MatteAlphaProvider>();
export function registerMatteAlphaProvider(objectId: string, provider: MatteAlphaProvider | null): void {
  if (provider) alphaProviders.set(objectId, provider);
  else alphaProviders.delete(objectId);
}
export function matteAlphaProviderFor(objectId: string): MatteAlphaProvider | undefined {
  return alphaProviders.get(objectId);
}

/** Replacement background as pixels: a colour, or a caller drawn frame. */
export function drawMattedFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { width: number; height: number },
  alpha: Uint8ClampedArray,
  replacement: MatteReplacement,
  backgroundFrame: RgbaFrame | null,
  dest: { x: number; y: number; w: number; h: number },
  scratch?: HTMLCanvasElement,
): boolean {
  const w = Math.round(dest.w);
  const h = Math.round(dest.h);
  if (w <= 0 || h <= 0) return false;
  const canvas = scratch ?? document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const sctx = canvas.getContext("2d");
  if (!sctx) return false;
  sctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  const imageData = sctx.getImageData(0, 0, w, h);
  const frame: RgbaFrame = { width: w, height: h, data: imageData.data };
  let bg: { r: number; g: number; b: number } | RgbaFrame;
  if (backgroundFrame) bg = backgroundFrame;
  else if (replacement.kind === "color") bg = parseHexColor(replacement.color);
  else bg = parseHexColor("#ffffff");
  if (alpha.length !== w * h) return false;
  const out = compositeFrame(frame, alpha, bg);
  imageData.data.set(out.data);
  sctx.putImageData(imageData, 0, 0);
  ctx.drawImage(canvas, dest.x, dest.y, dest.w, dest.h);
  return true;
}
