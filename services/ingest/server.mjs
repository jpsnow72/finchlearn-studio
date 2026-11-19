/**
 * finch-ingest — the FinchLearn Studio ingest worker (issue #7).
 *
 * A deliberately small job service in the finch-render shape:
 *   POST /jobs              (x-ingest-key)  {sourceR2Key, sourceUrl,
 *                          contentHash, kind, width, height, durationMs}
 *                         -> {jobId, token, status, deduped}
 *   GET  /jobs/:id          (key or token)  -> {jobId, status, attempts,
 *                          error, outputs}
 *   GET  /jobs/:id/file/:name (?token=)     -> one artefact file
 *                          (proxy-720p.mp4 | peaks.json | thumbs-strip.jpg)
 *   GET  /health
 *
 * For each job FFmpeg produces, from the ORIGINAL source bytes:
 *   1. proxy-720p.mp4  a 720p H.264/AAC proxy for editor scrubbing
 *      (video only; never used for export, see the contract in
 *      packages/media/src/ingest.ts),
 *   2. peaks.json      waveform peaks in the canonical packages/media
 *      shape ({ min, max } pairs from computePeaks, normalized 0..1),
 *   3. thumbs-strip.jpg  one sprite strip for timeline/scrubber display.
 *
 * Identity is the content hash: the job id and every derived key derive
 * from it, so re-ingesting unchanged media returns the existing job
 * instead of re-running (dedupe). Jobs run one at a time; the box is
 * small and FFmpeg is CPU-bound, so a queue beats contention (the same
 * call finch-render makes).
 *
 * The service never holds R2 credentials. The caller (editor via the
 * finch-media Worker, or the media worker itself at upload time) passes
 * a short-lived signed sourceUrl for the original; finished artefacts
 * are served back under their derived R2 keys (see derivedIngestKey in
 * the contract) for the caller / ship-point sync to store in R2.
 *
 * Env: INGEST_KEY (required), PORT (8799), JOB_DIR
 * (/var/lib/finch-ingest/jobs), PUBLIC_URL (https://ingest.finchlearn.com).
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8799);
const INGEST_KEY = process.env.INGEST_KEY ?? "";
const JOB_DIR = process.env.JOB_DIR ?? "/var/lib/finch-ingest/jobs";
const MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 10 * 60_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://studio.finchlearn.com",
  "https://finchlearn-studio.pages.dev",
  "http://localhost:5173",
]);

if (!INGEST_KEY) {
  console.error("INGEST_KEY is required");
  process.exit(1);
}

const jobs = new Map();
const queue = [];
let running = false;

// ---------------------------------------------------------------------------
// Contract mirrors. The canonical contract lives in
// packages/media/src/ingest.ts (job id, derived keys, plan, peaks math);
// this service is plain .mjs outside the workspace, so the small pure
// pieces are mirrored here and kept in step with it. The media package
// tests pin the canonical behaviour.
// ---------------------------------------------------------------------------

function ingestJobId(contentHash) {
  return `ingest-${contentHash.slice(0, 32)}`;
}

function derivedIngestKey(contentHash, artefact) {
  return `derived/${contentHash.slice(0, 2)}/${contentHash}/${artefact}`;
}

/** Mirrors planIngest in packages/media/src/media.ts. */
function planIngest(asset) {
  if (asset.kind === "image") {
    return { proxies: [{ width: 1280, label: "web" }, { width: 480, label: "thumb" }], thumbnailStrip: { count: 1, width: 480 }, waveform: false };
  }
  if (asset.kind === "audio") {
    return { proxies: [], thumbnailStrip: { count: 0, width: 0 }, waveform: true };
  }
  const w = asset.width ?? 1920;
  const proxies = [{ width: 1280, label: "720p" }];
  if (w > 1280) proxies.push({ width: 1920, label: "1080p" });
  proxies.push({ width: 480, label: "thumb" });
  const count = Math.max(4, Math.min(40, Math.round((asset.durationMs ?? 10000) / 5000)));
  return { proxies, thumbnailStrip: { count, width: 320 }, waveform: true };
}

/** Mirrors peaksBucketCount in packages/media/src/ingest.ts. */
function peaksBucketCount(durationMs) {
  if (!durationMs || durationMs <= 0) return 100;
  return Math.max(20, Math.min(2000, Math.round(durationMs / 100)));
}

/** Mirrors computePeaks in packages/media/src/media.ts exactly:
 * one normalized { min, max } pair per bucket over the samples. */
function computePeaks(samples, buckets) {
  const out = [];
  if (buckets <= 0 || samples.length === 0) return out;
  const per = samples.length / buckets;
  let peak = 0;
  const mins = [];
  const maxs = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.floor((b + 1) * per));
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    mins.push(min === Infinity ? 0 : min);
    maxs.push(max === -Infinity ? 0 : max);
    peak = Math.max(peak, Math.abs(maxs[b]), Math.abs(mins[b]));
  }
  const norm = peak > 0 ? 1 / peak : 1;
  for (let b = 0; b < buckets; b++) out.push({ min: mins[b] * norm, max: maxs[b] * norm });
  return out;
}

// ---------------------------------------------------------------------------
// HTTP helpers (finch-render pattern)
// ---------------------------------------------------------------------------

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-ingest-key, x-ingest-token",
    vary: "Origin",
  };
}

function sendJson(req, res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    ...corsHeaders(req),
  });
  res.end(text);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function run(cmd, args, timeoutMs, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const chunks = [];
    child.stdout.on("data", (d) => {
      if (binary) chunks.push(d);
      else chunks.push(d);
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// The FFmpeg work
// ---------------------------------------------------------------------------

async function processJob(job) {
  const dir = `${JOB_DIR}/${job.id}`;
  await mkdir(dir, { recursive: true });
  const input = job.input;
  try {
    job.status = "running";
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    job.error = undefined;

    // Fetch the ORIGINAL bytes via the caller's short-lived signed URL.
    const res = await fetch(input.sourceUrl);
    if (!res.ok) throw new Error(`the source could not be fetched (${res.status})`);
    const sourceBuf = Buffer.from(await res.arrayBuffer());
    if (sourceBuf.length === 0) throw new Error("the source is empty");
    if (sourceBuf.length > MAX_SOURCE_BYTES) throw new Error("the source is too large");
    const sourcePath = `${dir}/source`;
    await writeFile(sourcePath, sourceBuf);

    // Probe the real dimensions and duration; claims at ingest can lie.
    const probe = JSON.parse(
      (await run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", sourcePath], 30_000)).toString("utf8"),
    );
    const streams = probe?.streams ?? [];
    const videoStream = streams.find((s) => s.codec_type === "video");
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    const probed = {
      width: videoStream?.width ?? input.width,
      height: videoStream?.height ?? input.height,
      durationMs: probe?.format?.duration ? Math.round(Number(probe.format.duration) * 1000) : input.durationMs,
    };
    const plan = planIngest({ ...input, width: probed.width, durationMs: probed.durationMs });
    const outputs = { probed };

    if (input.kind === "video") {
      // 1. Proxy: 720p, downscale only, H.264 + AAC, faststart.
      const proxyPath = `${dir}/proxy-720p.mp4`;
      const ffArgs = ["-y", "-i", sourcePath, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast"];
      if (hasAudio) ffArgs.push("-c:a", "aac", "-b:a", "128k");
      else ffArgs.push("-an");
      ffArgs.push("-movflags", "+faststart", proxyPath);
      await run("ffmpeg", ffArgs, JOB_TIMEOUT_MS);
      const proxyProbe = JSON.parse(
        (await run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", proxyPath], 30_000)).toString("utf8"),
      );
      const proxyVideo = (proxyProbe?.streams ?? []).find((s) => s.codec_type === "video");
      outputs.proxy = {
        r2Key: derivedIngestKey(input.contentHash, "proxy-720p.mp4"),
        label: "720p",
        width: proxyVideo?.width ?? Math.min(1280, probed.width ?? 1280),
        height: proxyVideo?.height,
        codec: "h264",
        container: "mp4",
      };

      // 3. Thumbnail strip: one sprite, frames at segment centres.
      const count = plan.thumbnailStrip.count;
      const durationSec = Math.max(1, (probed.durationMs ?? 10_000) / 1000);
      await run(
        "ffmpeg",
        ["-y", "-i", sourcePath, "-vf", `fps=${(count / durationSec).toFixed(6)},scale=${plan.thumbnailStrip.width}:-1,tile=${count}x1`, "-frames:v", "1", `${dir}/thumbs-strip.jpg`],
        JOB_TIMEOUT_MS,
      );
      outputs.thumbnails = {
        stripR2Key: derivedIngestKey(input.contentHash, "thumbs-strip.jpg"),
        frameWidth: plan.thumbnailStrip.width,
        frameAtMs: Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) / count) * (probed.durationMs ?? 10_000))),
      };
    }

    if (input.kind === "image") {
      await run("ffmpeg", ["-y", "-i", sourcePath, "-vf", `scale=${plan.thumbnailStrip.width}:-1`, "-frames:v", "1", `${dir}/thumbs-strip.jpg`], 60_000);
      outputs.thumbnails = {
        stripR2Key: derivedIngestKey(input.contentHash, "thumbs-strip.jpg"),
        frameWidth: plan.thumbnailStrip.width,
        frameAtMs: [0],
      };
    }

    // 2. Waveform peaks: decode mono PCM, bucket with the canonical math.
    if (plan.waveform && hasAudio) {
      const pcm = await run(
        "ffmpeg",
        ["-v", "error", "-i", sourcePath, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"],
        JOB_TIMEOUT_MS,
        { binary: true },
      );
      const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
      const buckets = peaksBucketCount(probed.durationMs);
      const peaks = computePeaks(samples, buckets);
      const peaksOutput = {
        version: 1,
        buckets: peaks.length,
        bucketMs: probed.durationMs ? Math.round(probed.durationMs / Math.max(1, peaks.length)) : undefined,
        peaks,
      };
      outputs.peaks = peaksOutput;
      await writeFile(
        `${dir}/peaks.json`,
        JSON.stringify({ contentHash: input.contentHash, sourceR2Key: input.sourceR2Key, ...peaksOutput }),
      );
    } else if (plan.waveform && !hasAudio) {
      throw new Error("the source has no audio stream to compute peaks from");
    }

    job.outputs = outputs;
    job.status = "done";
    job.updatedAt = new Date().toISOString();
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = new Date().toISOString();
    console.error(`job ${job.id} failed (attempt ${job.attempts}):`, job.error);
  }
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  try {
    await processJob(job);
  } finally {
    running = false;
    void pump();
  }
}

// Sweep finished job files after 24 hours (artefacts live in R2 by then
// in the deployed flow; the local copies are the handoff, not the store).
setInterval(async () => {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [id, job] of jobs) {
    if ((job.status === "done" || job.status === "failed") && Date.parse(job.updatedAt) < cutoff) {
      jobs.delete(id);
      await rm(`${JOB_DIR}/${id}`, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 600_000).unref();

const ARTEFACT_FILES = new Set(["proxy-720p.mp4", "peaks.json", "thumbs-strip.jpg"]);
const ARTEFACT_TYPES = { "proxy-720p.mp4": "video/mp4", "peaks.json": "application/json", "thumbs-strip.jpg": "image/jpeg" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      if (req.headers["x-ingest-key"] !== INGEST_KEY) {
        return sendJson(req, res, 401, { error: "ingest key required" });
      }
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8"));
      const { sourceR2Key, sourceUrl, contentHash, kind } = body ?? {};
      if (!sourceR2Key || typeof sourceR2Key !== "string") return sendJson(req, res, 400, { error: "sourceR2Key is required" });
      if (!sourceUrl || typeof sourceUrl !== "string" || !sourceUrl.startsWith("https://")) {
        return sendJson(req, res, 400, { error: "a signed https sourceUrl is required" });
      }
      if (!contentHash || !/^[a-f0-9]{32,64}$/.test(contentHash)) {
        return sendJson(req, res, 400, { error: "contentHash must be hex, 32 to 64 chars" });
      }
      if (kind !== "video" && kind !== "audio" && kind !== "image") {
        return sendJson(req, res, 400, { error: "kind must be video, audio, or image" });
      }

      // Dedupe by content hash: unchanged media never re-runs.
      const id = ingestJobId(contentHash);
      const existing = jobs.get(id);
      if (existing && existing.input.contentHash === contentHash) {
        if (existing.status === "done" || existing.status === "queued" || existing.status === "running") {
          return sendJson(req, res, 200, { jobId: existing.id, token: existing.token, status: existing.status, deduped: true });
        }
        if (existing.status === "failed" && existing.attempts < MAX_ATTEMPTS) {
          existing.status = "queued";
          existing.error = undefined;
          existing.updatedAt = new Date().toISOString();
          queue.push(existing);
          void pump();
          return sendJson(req, res, 202, { jobId: existing.id, token: existing.token, status: existing.status, deduped: true, retried: true });
        }
        if (existing.status === "failed") {
          return sendJson(req, res, 409, { error: `ingest for this content has failed ${MAX_ATTEMPTS} times`, jobId: existing.id, status: existing.status });
        }
      }

      const now = new Date().toISOString();
      const job = {
        id,
        token: randomBytes(18).toString("hex"),
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        error: undefined,
        outputs: undefined,
        input: {
          assetId: body.assetId,
          sourceR2Key,
          sourceUrl,
          contentHash,
          kind,
          width: Number.isFinite(body.width) ? body.width : undefined,
          height: Number.isFinite(body.height) ? body.height : undefined,
          durationMs: Number.isFinite(body.durationMs) ? body.durationMs : undefined,
        },
      };
      jobs.set(job.id, job);
      queue.push(job);
      void pump();
      return sendJson(req, res, 202, { jobId: job.id, token: job.token, status: job.status, deduped: false });
    }

    const fileMatch = url.pathname.match(/^\/jobs\/([\w-]+)\/file\/([\w.-]+)$/);
    if (req.method === "GET" && fileMatch) {
      const job = jobs.get(fileMatch[1]);
      if (!job) return sendJson(req, res, 404, { error: "no such job" });
      if (url.searchParams.get("token") !== job.token && req.headers["x-ingest-token"] !== job.token) {
        return sendJson(req, res, 401, { error: "job token required" });
      }
      const name = fileMatch[2];
      if (!ARTEFACT_FILES.has(name)) return sendJson(req, res, 404, { error: "no such artefact" });
      if (job.status !== "done") return sendJson(req, res, 409, { error: `job is ${job.status}` });
      try {
        await stat(`${JOB_DIR}/${job.id}/${name}`);
      } catch {
        return sendJson(req, res, 404, { error: "this job did not produce that artefact" });
      }
      const data = await readFile(`${JOB_DIR}/${job.id}/${name}`);
      res.writeHead(200, {
        "content-type": ARTEFACT_TYPES[name],
        "content-length": data.length,
        ...corsHeaders(req),
      });
      res.end(data);
      return;
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return sendJson(req, res, 404, { error: "no such job" });
      if (req.headers["x-ingest-key"] !== INGEST_KEY && req.headers["x-ingest-token"] !== job.token && url.searchParams.get("token") !== job.token) {
        return sendJson(req, res, 401, { error: "ingest key or job token required" });
      }
      return sendJson(req, res, 200, {
        jobId: job.id,
        status: job.status,
        attempts: job.attempts,
        error: job.error ?? null,
        outputs: job.outputs ?? null,
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(req, res, 200, { ok: true, queued: queue.length, running });
    }
    return sendJson(req, res, 404, { error: "not found" });
  } catch (err) {
    return sendJson(req, res, 500, { error: err instanceof Error ? err.message : "internal error" });
  }
});

await mkdir(JOB_DIR, { recursive: true });
server.listen(PORT, "127.0.0.1", () => {
  console.log(`finch-ingest listening on 127.0.0.1:${PORT}`);
});
