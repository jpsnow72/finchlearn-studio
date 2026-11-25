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
 * inference runs as a finch-matte job (requestMatteJob below, POST
 * /matte-jobs on VITE_MATTE_URL), following serverRender.ts auth and
 * polling patterns. Either way the
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
const RENDER_KEY = (import.meta.env.VITE_RENDER_KEY as string | undefined) ?? "";
const MATTE_URL = ((import.meta.env.VITE_MATTE_URL as string | undefined) ?? "").replace(/\/$/, "");
const MATTE_ASSET_BASE = ((import.meta.env.VITE_MATTE_ASSET_BASE as string | undefined) ?? "").replace(/\/$/, "");
/** Model version string the live finch-matte service reports. */
export const MATTE_SERVICE_MODEL_VERSION = "rvm_mobilenetv3_fp32@v1.0.0";
export const matteRenderConfigured = Boolean(MATTE_URL && RENDER_KEY);
export const matteJobConfigured = matteRenderConfigured;

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
    matteJobId: typeof raw.backgroundRemoval.matteJobId === "string" ? raw.backgroundRemoval.matteJobId : undefined,
    matteJobToken: typeof raw.backgroundRemoval.matteJobToken === "string" ? raw.backgroundRemoval.matteJobToken : undefined,
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
// finch-matte job client: the live matte service on VITE_MATTE_URL
// (https://render.finchlearn.com in the canonical build env, proxied
// to finch-matte). Contract, verified end to end through the public
// route in session 56: POST /matte-jobs with the render key creates a
// job from the raw source footage bytes, or from a JSON sourceUrl
// body when only a fetchable URL is available, and returns 202 with
// { jobId, token, cached, cacheKey }. GET /matte-jobs/<id> with the
// per job token polls; a done response carries state, cacheKey,
// frames, width, height and fps. The matte file itself is fetched
// through matteJobFileUrl below (GET /matte-jobs/<id>/file?token=).
// The stored descriptor keeps the host cache key as its r2Key: no R2
// credential or signed path is fabricated here, and the R2 matte
// storage gap stays recorded on issue #122.
// ---------------------------------------------------------------------------

export interface MatteJobResult { jobId: string; token: string; matte: MatteAssetDescriptor }

export interface MatteJobRequest {
  sourceAssetId: string;
  sourceContentHash?: string;
  /** Source footage bytes, resolved from the clip asset. Preferred. */
  sourceBlob?: Blob;
  /** Fetchable source URL, used only when no bytes are available. */
  sourceUrl?: string;
  replacement: MatteReplacement;
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; blob?: () => Promise<Blob>; text?: () => Promise<string> }>;

/** Live finch-matte poll response shape (fields the service returns). */
export interface MatteJobState {
  state: string;
  error?: string | null;
  cacheKey?: string;
  cached?: boolean;
  frames?: number;
  frameCount?: number;
  width?: number;
  height?: number;
  fps?: number;
  durationMs?: number;
  modelVersion?: string;
  model?: string;
  progress?: number;
}

/**
 * Build the stored matte descriptor from a done job response, in the
 * exact MatteAssetDescriptor shape the matte alpha loader and the
 * preview compositing already consume: id from the job id, r2Key
 * from the returned cacheKey, dimensions and frame count from the
 * job state, modelVersion from the response when it carries one.
 */
export function buildMatteDescriptorFromJobState(
  request: Pick<MatteJobRequest, "sourceAssetId" | "sourceContentHash">,
  jobId: string,
  state: MatteJobState,
  jobToken?: string,
): MatteAssetDescriptor {
  if (!state.cacheKey) throw new Error("the matte job finished without a cache key");
  const fps = Math.max(1, Math.round(state.fps || 30));
  const frameCount = Math.max(0, Math.round(state.frameCount ?? state.frames ?? 0));
  const durationMs = state.durationMs !== undefined
    ? Math.max(0, Math.round(state.durationMs))
    : frameCount > 0 ? Math.round((frameCount / fps) * 1000) : 0;
  return {
    id: jobId,
    kind: "matte",
    sourceAssetId: request.sourceAssetId,
    sourceContentHash: request.sourceContentHash,
    modelVersion: state.modelVersion ?? state.model ?? MATTE_SERVICE_MODEL_VERSION,
    r2Key: state.cacheKey,
    jobId,
    jobToken,
    width: Math.max(1, Math.round(state.width || 1)),
    height: Math.max(1, Math.round(state.height || 1)),
    fps,
    durationMs,
    frameCount,
  };
}

/**
 * Resolve a clip resource to the source the matte service accepts,
 * through the editor's existing media resolution: the resource is
 * fetched exactly as the export path fetches it. Bytes come first
 * for every resource, including http and https resources: the editor
 * uploads the raw bytes it fetched, so a matte job never depends on
 * the matte service being able to fetch the same URL itself (the
 * service answers 400 "sourceUrl fetch failed" for URLs its host
 * cannot fetch, for example hosts that refuse non-browser agents).
 * Only when the editor cannot fetch the bytes does an http or https
 * resource fall back to a fetchable sourceUrl for the service to
 * try. An unresolvable resource returns neither, and
 * requestMatteJob then fails honestly instead of sending an asset
 * id the service cannot resolve.
 */
export async function resolveMatteSource(
  resource: string | undefined,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<{ sourceBlob?: Blob; sourceUrl?: string }> {
  if (!resource) return {};
  const isHttp = /^https?:\/\//i.test(resource);
  try {
    const res = await fetchFn(resource, {});
    if (res.ok && typeof res.blob === "function") return { sourceBlob: await res.blob() };
  } catch {
    // Fall through to the sourceUrl fallback for http resources.
  }
  if (isHttp) return { sourceUrl: resource };
  return {};
}

/**
 * Best-effort detail from a refused matte job response: the service
 * answers JSON with an error or detail field (for example
 * "sourceUrl fetch failed: 403"), or plain text. Returns an empty
 * string when the body carries no readable detail.
 */
async function matteRefusalDetail(res: { json(): Promise<unknown>; text?: () => Promise<string> }): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body)) {
      for (const key of ["error", "detail", "message"]) {
        const value = body[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    if (typeof body === "string" && body.trim()) return body.trim();
  } catch {
    // Not JSON; try plain text below.
  }
  try {
    if (typeof res.text === "function") {
      const text = await res.text();
      if (text && text.trim()) return text.trim();
    }
  } catch {
    // No readable detail.
  }
  return "";
}

export async function requestMatteJob(
  request: MatteJobRequest,
  onStatus: (text: string) => void,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  baseUrl: string = MATTE_URL,
): Promise<MatteJobResult> {
  if (!baseUrl && fetchFn === (fetch as unknown as FetchLike)) {
    throw new Error("Server matting is not configured in this build.");
  }
  const invalid = validateMatteReplacement(request.replacement);
  if (invalid) throw new Error(invalid);
  const sourceUrl = request.sourceUrl ?? (/^https?:\/\//i.test(request.sourceAssetId) ? request.sourceAssetId : undefined);
  let beginInit: Record<string, unknown>;
  if (request.sourceBlob) {
    beginInit = {
      method: "POST",
      headers: { "x-render-key": RENDER_KEY, "content-type": request.sourceBlob.type || "video/mp4" },
      body: request.sourceBlob,
    };
  } else if (sourceUrl) {
    beginInit = {
      method: "POST",
      headers: { "x-render-key": RENDER_KEY, "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl }),
    };
  } else {
    throw new Error("The clip source could not be resolved to footage bytes or a fetchable URL, so no matte job was requested.");
  }
  const begin = await fetchFn(`${baseUrl}/matte-jobs`, beginInit);
  if (!begin.ok) {
    const detail = await matteRefusalDetail(begin);
    throw new Error(detail ? `the matte service refused the matte job (${begin.status}): ${detail}` : `the matte service refused the matte job (${begin.status})`);
  }
  const { jobId, token } = (await begin.json()) as { jobId: string; token: string };
  if (!jobId || !token) throw new Error("the matte service returned no job id or token");
  onStatus("Matte job queued. CPU matting can take a while on long clips.");
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("the matte job timed out (30 minutes)");
    await sleep(3000);
    const poll = await fetchFn(`${baseUrl}/matte-jobs/${encodeURIComponent(jobId)}`, { headers: { "x-render-token": token } });
    if (!poll.ok) continue;
    const state = (await poll.json()) as MatteJobState;
    if (state.state === "done") return { jobId, token, matte: buildMatteDescriptorFromJobState(request, jobId, state, token) };
    if (state.state === "error" || state.state === "failed") throw new Error(state.error ?? "the matte job failed");
    onStatus(state.progress !== undefined ? `Matte is ${Math.round(state.progress * 100)} percent done.` : "Matte is processing on the matte service.");
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

// ---------------------------------------------------------------------------
// Matte alpha loader (issue #122, gap G-7 remainder): fetch and decode
// the stored matte asset into the alpha provider registry above, so
// the stage preview and the export path composite the SAME stored
// matte through drawMattedFrame. The matte asset is the grayscale MP4
// the finch-matte service produces (white is foreground), served by
// the live service shape: GET /matte-jobs/<id> for state and
// GET /matte-jobs/<id>/file?token=<job token> for the matte file,
// following the finch-render auth pattern (render key to create, per
// job token to read). A stored matte descriptor can also be resolved
// to a direct asset URL when the build configures a matte asset base
// (VITE_MATTE_ASSET_BASE). No credential or signed URL is invented
// here: when neither route is configured the loader fails honestly
// and the R2 matte storage gap recorded on issue #122 stays the
// blocker for that route.
// ---------------------------------------------------------------------------

export const matteServiceConfigured = Boolean(MATTE_URL);

/** Live finch-matte file URL for a finished job (job token required). */
export function matteJobFileUrl(jobId: string, token: string, base: string = MATTE_URL): string {
  return `${base}/matte-jobs/${encodeURIComponent(jobId)}/file?token=${encodeURIComponent(token)}`;
}

/**
 * Resolve a stored matte descriptor to a fetchable URL, or null when
 * this build has no sanctioned read path for stored mattes. A matte
 * key that is already an absolute URL is used as is; otherwise the
 * configured matte asset base prefixes the stored key.
 */
export function matteAssetUrlForDescriptor(descriptor: Pick<MatteAssetDescriptor, "r2Key">, base: string = MATTE_ASSET_BASE): string | null {
  if (/^https?:\/\//i.test(descriptor.r2Key)) return descriptor.r2Key;
  if (!base) return null;
  return `${base}/${descriptor.r2Key.replace(/^\//, "")}`;
}

/**
 * Resolve a stored matte descriptor to its matte service file URL
 * when the descriptor carries the job id and per job token from the
 * completed job, using the matteJobFileUrl shape on the configured
 * matte service base. Descriptors stored before job wiring (cache
 * key only, no job id or token) fall back to the direct asset URL
 * resolution, which returns null when no asset base is configured,
 * so the loader keeps reporting no readable address for them.
 */
export function matteFileUrlForDescriptor(
  descriptor: Pick<MatteAssetDescriptor, "r2Key" | "jobId" | "jobToken">,
  base: string = MATTE_URL,
  assetBase: string = MATTE_ASSET_BASE,
): string | null {
  if (descriptor.jobId && descriptor.jobToken) {
    if (!base) return null;
    return matteJobFileUrl(descriptor.jobId, descriptor.jobToken, base);
  }
  return matteAssetUrlForDescriptor(descriptor, assetBase);
}

/** Alpha bytes from one decoded matte frame: matte luminance is alpha. */
export function alphaFromMattePixels(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  if (data.length !== width * height * 4) {
    throw new Error(`matte frame has ${data.length} bytes for a ${width}x${height} frame`);
  }
  const alpha = new Uint8ClampedArray(width * height);
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    alpha[p] = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
  }
  return alpha;
}

/** Index of the matte frame nearest a source time, clamped in range. */
export function matteFrameIndexAt(sourceMs: number, fps: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  const idx = Math.round((Math.max(0, sourceMs) / 1000) * Math.max(1, fps));
  return Math.min(frameCount - 1, Math.max(0, idx));
}

/** Nearest neighbour resample of an alpha plane to a target size. */
export function scaleAlphaFrame(alpha: Uint8ClampedArray, srcW: number, srcH: number, dstW: number, dstH: number): Uint8ClampedArray {
  if (alpha.length !== srcW * srcH) throw new Error("matte alpha size does not match its frame size");
  if (srcW === dstW && srcH === dstH) return alpha;
  const out = new Uint8ClampedArray(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = alpha[sy * srcW + sx];
    }
  }
  return out;
}

/**
 * An alpha provider over decoded matte frames: alphaAt returns the
 * frame nearest the source time, resampled to the size the caller is
 * compositing at, or null before the first frame exists.
 */
export function createStoredMatteProvider(
  descriptor: Pick<MatteAssetDescriptor, "fps" | "frameCount" | "width" | "height">,
  frames: Uint8ClampedArray[],
): MatteAlphaProvider {
  return {
    alphaAt(sourceMs: number, width: number, height: number) {
      if (frames.length === 0) return null;
      const idx = matteFrameIndexAt(sourceMs, descriptor.fps, Math.min(descriptor.frameCount, frames.length));
      const frame = frames[idx];
      if (!frame) return null;
      return scaleAlphaFrame(frame, descriptor.width, descriptor.height, width, height);
    },
  };
}

export interface DecodedMatte {
  frames: Uint8ClampedArray[];
  width: number;
  height: number;
}

/** Decodes a matte video source into per frame alpha planes. */
export type MatteFrameGrabber = (
  sourceUrl: string,
  plan: { fps: number; frameCount: number; durationMs: number },
  onProgress?: (progress: number) => void,
) => Promise<DecodedMatte>;

function waitForEvent(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("the stored matte video could not be loaded")); };
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent);
    target.addEventListener("error", onError);
  });
}

/**
 * Default grabber: seek a muted matte video element frame by frame
 * and read luminance as alpha. Browser only; tests inject a fake.
 */
export const decodeMatteVideoWithDom: MatteFrameGrabber = async (sourceUrl, planIn, onProgress) => {
  const plan = {
    fps: Math.max(1, planIn.fps || 30),
    frameCount: planIn.frameCount > 0 ? planIn.frameCount : 0,
    durationMs: planIn.durationMs > 0 ? planIn.durationMs : 0,
  };
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = sourceUrl;
  await waitForEvent(video, "loadedmetadata");
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("the stored matte video has no picture");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas is not available to decode the stored matte");
  if (!plan.durationMs && Number.isFinite(video.duration)) plan.durationMs = Math.round(video.duration * 1000);
  if (!plan.frameCount) plan.frameCount = Math.max(1, Math.round((plan.durationMs / 1000) * plan.fps));
  const frames: Uint8ClampedArray[] = [];
  const total = Math.max(1, plan.frameCount);
  for (let i = 0; i < total; i++) {
    video.currentTime = Math.min(Math.max(0, plan.durationMs / 1000 - 0.001), i / Math.max(1, plan.fps));
    await waitForEvent(video, "seeked");
    ctx.drawImage(video, 0, 0, width, height);
    frames.push(alphaFromMattePixels(ctx.getImageData(0, 0, width, height).data, width, height));
    onProgress?.((i + 1) / total);
  }
  video.removeAttribute("src");
  video.load();
  return { frames, width, height };
};

type MatteFetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>;

/**
 * Fetch a stored matte, decode it, and register the resulting alpha
 * provider for the object. Progress reports the decode position for
 * long CPU era clips. Any failure throws with a plain reason and
 * leaves the registry untouched, so callers show the failure state
 * and the footage keeps rendering uncomposited.
 */
export type StoredMatteRef = Pick<MatteAssetDescriptor, "r2Key"> & Partial<MatteAssetDescriptor>;

export async function loadMatteAlphaProvider(
  objectId: string,
  descriptor: StoredMatteRef,
  opts: {
    url?: string | null;
    job?: { jobId: string; token: string };
    matteBase?: string;
    fetchFn?: MatteFetchLike;
    grabFrames?: MatteFrameGrabber;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<MatteAlphaProvider> {
  const existing = matteAlphaProviderFor(objectId);
  if (existing) return existing;
  let sourceUrl = opts.url ?? null;
  let objectUrl: string | null = null;
  if (opts.job) {
    if (!MATTE_URL && !opts.fetchFn) throw new Error("The matte service is not configured in this build, so the stored matte cannot be fetched.");
    const fetchFn = opts.fetchFn ?? (fetch as unknown as MatteFetchLike);
    const res = await fetchFn(matteJobFileUrl(opts.job.jobId, opts.job.token), {});
    if (!res.ok) throw new Error(`the matte service refused the matte file (${res.status})`);
    objectUrl = URL.createObjectURL(await res.blob());
    sourceUrl = objectUrl;
  }
  if (!sourceUrl) sourceUrl = matteFileUrlForDescriptor(descriptor, opts.matteBase ?? MATTE_URL);
  if (!sourceUrl) {
    throw new Error("The stored matte has no readable address in this build yet. Matte storage wiring is still open on issue #122.");
  }
  try {
    const grab = opts.grabFrames ?? decodeMatteVideoWithDom;
    const decoded = await grab(
      sourceUrl,
      { fps: descriptor.fps ?? 30, frameCount: descriptor.frameCount ?? 0, durationMs: descriptor.durationMs ?? 0 },
      opts.onProgress,
    );
    if (decoded.frames.length === 0) throw new Error("the stored matte decoded to no frames");
    const provider = createStoredMatteProvider(
      { fps: descriptor.fps ?? 30, frameCount: descriptor.frameCount ?? decoded.frames.length, width: decoded.width, height: decoded.height },
      decoded.frames,
    );
    registerMatteAlphaProvider(objectId, provider);
    return provider;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
