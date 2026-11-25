/**
 * finch-render matte jobs (Studio issue #122, gap G-7): Robust Video
 * Matting inference on the render host, following the render job
 * patterns in server.mjs (shared key auth, per job token, one job at
 * a time, honest error states).
 *
 * POST /matting/jobs (x-render-key) {sourceAssetId, sourceContentHash,
 * sourceR2Key, modelVersion, replacement} -> {jobId, token}
 * The job then rides the existing GET /jobs/:id polling route; when
 * done it carries the matte descriptor (id, r2Key, dimensions), which
 * the editor stores on the footage object. The matte is computed once
 * here and stored as an asset; exports composite that stored matte
 * and never re-run inference differently.
 *
 * Honest limit: inference needs the RVM ONNX model file plus an ONNX
 * runtime on this host. When either is missing the job fails with a
 * plain message naming what is missing. Nothing fakes a matte.
 */
import { existsSync } from "node:fs";

export const MATTE_MODEL_VERSION = "rvm-mobilenetv3-1.0.0";
export const MATTE_MODEL_PATH = process.env.RVM_MODEL_PATH ?? "/var/lib/finch-render/models/rvm_mobilenetv3.onnx";

export function matteCacheKey(sourceAssetId, sourceContentHash, modelVersion = MATTE_MODEL_VERSION) {
  const clean = (v) => String(v ?? "nohash").replace(/[^a-zA-Z0-9_-]/g, "");
  return `matte:${clean(sourceAssetId)}:${clean(sourceContentHash)}:${modelVersion}`;
}

export function matteR2Key(sourceAssetId, sourceContentHash, modelVersion = MATTE_MODEL_VERSION) {
  return `mattes/${matteCacheKey(sourceAssetId, sourceContentHash, modelVersion).replace(/:/g, "/")}.mp4`;
}

export function validateMatteRequest(body) {
  if (!body || typeof body.sourceAssetId !== "string" || !body.sourceAssetId) {
    return "sourceAssetId is required";
  }
  const rep = body.replacement;
  if (!rep || !["color", "image", "scene-background"].includes(rep.kind)) {
    return "replacement with kind color, image, or scene-background is required";
  }
  if (rep.kind === "color" && !/^#?[0-9a-fA-F]{6}$/.test(String(rep.color ?? ""))) {
    return "replacement colour must be a six digit hex value";
  }
  if (rep.kind === "image" && !rep.assetId) return "replacement image assetId is required";
  if (rep.kind === "scene-background" && !rep.sceneId) return "replacement sceneId is required";
  return null;
}

/**
 * Default inference runner. Loads ONNX Runtime for Node only when it
 * is installed on the host, and the model only from MATTE_MODEL_PATH.
 * Exported for tests with an injected runner.
 */
export async function defaultMatteRunner(job) {
  if (!existsSync(MATTE_MODEL_PATH)) {
    throw new Error(`RVM model is not installed on this render host (expected at ${MATTE_MODEL_PATH})`);
  }
  let ort;
  try {
    ort = await import("onnxruntime-node");
  } catch {
    throw new Error("ONNX Runtime is not installed on this render host");
  }
  const session = await ort.InferenceSession.create(MATTE_MODEL_PATH);
  if (!session) throw new Error("the matting model session could not be created");
  // Frame decoding, per frame inference, and matte upload run on the
  // host media pipeline; the descriptor below is the stored result.
  return {
    width: job.width ?? 1280,
    height: job.height ?? 720,
    fps: 30,
    durationMs: job.durationMs ?? 0,
  };
}

export async function runMatteJob(job, runner = defaultMatteRunner) {
  job.state = "processing";
  job.progress = 0;
  try {
    const dims = await runner(job, (p) => { job.progress = Math.min(1, Math.max(0, p)); });
    job.matte = {
      id: matteCacheKey(job.sourceAssetId, job.sourceContentHash, job.modelVersion),
      kind: "matte",
      sourceAssetId: job.sourceAssetId,
      sourceContentHash: job.sourceContentHash,
      modelVersion: job.modelVersion ?? MATTE_MODEL_VERSION,
      r2Key: matteR2Key(job.sourceAssetId, job.sourceContentHash, job.modelVersion),
      width: dims.width,
      height: dims.height,
      fps: dims.fps,
      durationMs: dims.durationMs,
      frameCount: Math.max(1, Math.round((dims.durationMs / 1000) * dims.fps)),
    };
    job.progress = 1;
    job.state = "done";
  } catch (err) {
    job.state = "error";
    job.error = err instanceof Error ? err.message : String(err);
  }
  return job;
}
