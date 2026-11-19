/**
 * finch-asr — the FinchLearn Studio speech recognition service (#43).
 *
 * TARGET LOCATION (ship point): the InterServer VPS, alongside
 * finch-render, at /opt/finch-asr, public name asr.finchlearn.com.
 * This directory is the source of truth in the Studio repo; it is NOT
 * deployed by this lane. See README.md in this directory for the
 * deploy steps and the secret names that must be set.
 *
 * A deliberately small job service, shaped like finch-render:
 *   POST /jobs        (x-asr-key)  {clipId, contentHash, r2Key?,
 *                                   sourceUrl?, language?}
 *                     -> 202 {jobId}
 *   GET  /jobs/:id    (x-asr-key)  -> {jobId, state, error, transcript}
 *   GET  /health      -> {ok, queued, running}
 *
 * Job flow: fetch the clip bytes (sourceUrl, which in production is a
 * short lived signed URL the media worker mints for the r2Key), extract
 * a 16 kHz mono WAV with FFmpeg when the source is footage or a
 * container FFmpeg understands better than the engine, then call the
 * recognition engine behind the same port the client package defines
 * (@finch-studio/media transcript.ts, TranscriptionEngine). The first
 * binding is an OpenAI Whisper style endpoint (verbose_json with word
 * timestamps). One job at a time: the box is small and ASR is
 * CPU and network bound, so a queue beats contention.
 *
 * The transcript returned on a finished job is the canonical
 * ClipTranscript (word level start/end in ms into the source clip,
 * confidence only where the engine reports it, plus the content hash
 * the job was queued with, so the caller can verify it still matches
 * the clip before storing it).
 *
 * Env (values come from the service env file, never from code):
 *   ASR_KEY            (required) shared key the editor / media worker present
 *   OPENAI_API_KEY     (required for the whisper-api binding) engine key
 *   WHISPER_API_URL    engine base URL, default https://api.openai.com/v1
 *   WHISPER_MODEL      default whisper-1
 *   PORT               default 8799
 *   JOB_DIR            default /var/lib/finch-asr/jobs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8799);
const ASR_KEY = process.env.ASR_KEY ?? "";
const ENGINE_BASE = (process.env.WHISPER_API_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const ENGINE_KEY = process.env.OPENAI_API_KEY ?? "";
const ENGINE_MODEL = process.env.WHISPER_MODEL ?? "whisper-1";
const ENGINE_ID = "whisper-api";
const JOB_DIR = process.env.JOB_DIR ?? "/var/lib/finch-asr/jobs";
const MAX_CLIP_BYTES = 512 * 1024 * 1024;
const JOB_TIMEOUT_MS = 15 * 60_000;
const ALLOWED_ORIGINS = new Set([
  "https://studio.finchlearn.com",
  "https://finchlearn-studio.pages.dev",
  "http://localhost:5173",
]);

if (!ASR_KEY) {
  console.error("ASR_KEY is required");
  process.exit(1);
}
if (!ENGINE_KEY) {
  console.error("OPENAI_API_KEY is required for the whisper-api binding");
  process.exit(1);
}

const jobs = new Map();
const queue = [];
let running = false;

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-asr-key",
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

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
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
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

const sToMs = (s) => Math.round(s * 1000);

/** Map Whisper verbose_json onto the ClipTranscript contract. This
 * mirrors mapWhisperResponse in @finch-studio/media (transcript.ts);
 * the service is plain Node with no build step, so the mapping is
 * kept here in step with that module. Confidence is carried only
 * where the engine reports it. */
function mapWhisperResponse(raw, job) {
  const words = (raw.words ?? []).map((w) => {
    const word = { word: w.word, startMs: sToMs(w.start), endMs: sToMs(w.end) };
    const confidence = w.confidence ?? w.probability;
    if (typeof confidence === "number") word.confidence = confidence;
    return word;
  });
  const segments = (raw.segments ?? []).map((seg, i) => {
    const startMs = sToMs(seg.start);
    const endMs = sToMs(seg.end);
    let wordStartIndex = words.findIndex((w) => w.startMs >= startMs);
    if (wordStartIndex < 0) wordStartIndex = words.length;
    let wordEndIndex = words.length;
    for (let j = wordStartIndex; j < words.length; j++) {
      if (words[j].endMs > endMs) {
        wordEndIndex = j;
        break;
      }
      wordEndIndex = j + 1;
    }
    const out = {
      id: `seg-${seg.id ?? i}`,
      startMs,
      endMs,
      text: String(seg.text ?? "").trim(),
      wordStartIndex,
      wordEndIndex,
    };
    if (typeof seg.speaker === "string") out.speaker = seg.speaker;
    if (typeof seg.avg_logprob === "number") {
      out.confidence = Math.min(1, Math.max(0, Math.exp(seg.avg_logprob)));
    }
    return out;
  });
  if (segments.length === 0 && words.length > 0) {
    segments.push({
      id: "seg-0",
      startMs: words[0].startMs,
      endMs: words[words.length - 1].endMs,
      text: String(raw.text ?? words.map((w) => w.word).join(" ")).trim(),
      wordStartIndex: 0,
      wordEndIndex: words.length,
    });
  }
  const now = new Date().toISOString();
  return {
    version: 1,
    status: "ready",
    clipId: job.clipId,
    r2Key: job.r2Key,
    contentHash: job.contentHash,
    engine: ENGINE_ID,
    language: raw.language,
    durationMs: typeof raw.duration === "number" ? sToMs(raw.duration) : undefined,
    words,
    segments,
    text: String(raw.text ?? words.map((w) => w.word).join(" ")).trim(),
    createdAt: now,
    updatedAt: now,
    attempts: 1,
  };
}

async function transcribeWithWhisper(audioPath, fileName, language) {
  const bytes = await readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), fileName);
  form.append("model", ENGINE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);
  const res = await fetch(`${ENGINE_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${ENGINE_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Transcription engine returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

async function processJob(job) {
  const dir = `${JOB_DIR}/${job.id}`;
  await mkdir(dir, { recursive: true });
  try {
    job.state = "transcribing";
    if (!job.sourceUrl) {
      throw new Error("job has no sourceUrl: the caller must mint a signed URL for the r2Key");
    }
    const res = await fetch(job.sourceUrl);
    if (!res.ok) throw new Error(`clip fetch returned ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error("clip is empty");
    if (bytes.length > MAX_CLIP_BYTES) throw new Error("clip exceeds the ASR size cap");
    const sourcePath = `${dir}/source`;
    await writeFile(sourcePath, bytes);
    // Normalize to 16 kHz mono WAV: footage containers become plain
    // audio, and the engine gets the format Whisper handles best.
    const audioPath = `${dir}/audio.wav`;
    await run(
      "ffmpeg",
      ["-y", "-v", "error", "-i", sourcePath, "-vn", "-ar", "16000", "-ac", "1", audioPath],
      JOB_TIMEOUT_MS,
    );
    await stat(audioPath);
    const raw = await transcribeWithWhisper(audioPath, "audio.wav", job.language);
    job.transcript = mapWhisperResponse(raw, job);
    job.state = "done";
  } catch (err) {
    job.state = "error";
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`job ${job.id} failed:`, job.error);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
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

// Sweep finished job records after 2 hours (transcripts are stored
// back onto the project by the caller long before that).
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [id, job] of jobs) {
    if ((job.state === "done" || job.state === "error") && job.createdAt < cutoff) jobs.delete(id);
  }
}, 600_000).unref();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      if (req.headers["x-asr-key"] !== ASR_KEY) {
        return sendJson(req, res, 401, { error: "asr key required" });
      }
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8"));
      const clipId = typeof body?.clipId === "string" ? body.clipId : "";
      const contentHash = typeof body?.contentHash === "string" ? body.contentHash : "";
      if (!clipId || !contentHash) {
        return sendJson(req, res, 400, { error: "clipId and contentHash are required" });
      }
      if (!body?.r2Key && !body?.sourceUrl) {
        return sendJson(req, res, 400, { error: "r2Key or sourceUrl is required" });
      }
      // Idempotent queueing: an identical in-flight job is returned,
      // never duplicated. A ready result is the caller's to store; a
      // changed clip arrives with a different contentHash and queues.
      for (const existing of jobs.values()) {
        if (
          existing.clipId === clipId &&
          existing.contentHash === contentHash &&
          (existing.state === "queued" || existing.state === "transcribing")
        ) {
          return sendJson(req, res, 202, { jobId: existing.id });
        }
      }
      const job = {
        id: randomUUID(),
        clipId,
        contentHash,
        r2Key: typeof body.r2Key === "string" ? body.r2Key : undefined,
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
        state: "queued",
        error: null,
        transcript: null,
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      queue.push(job);
      void pump();
      return sendJson(req, res, 202, { jobId: job.id });
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && jobMatch) {
      if (req.headers["x-asr-key"] !== ASR_KEY) {
        return sendJson(req, res, 401, { error: "asr key required" });
      }
      const job = jobs.get(jobMatch[1]);
      if (!job) return sendJson(req, res, 404, { error: "no such job" });
      return sendJson(req, res, 200, {
        jobId: job.id,
        state: job.state,
        error: job.error,
        transcript: job.state === "done" ? job.transcript : null,
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
  console.log(`finch-asr listening on 127.0.0.1:${PORT} (engine: ${ENGINE_ID} at ${ENGINE_BASE})`);
});
