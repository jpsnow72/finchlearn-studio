/**
 * finch-render — the FinchLearn Studio server renderer (issue #33).
 *
 * A deliberately small job service:
 *   POST /jobs            (x-render-key)  {project, width, height, captions}
 *                         -> {jobId, token}
 *   POST /jobs/:id/result (x-render-token) raw MP4 from the render page
 *   GET  /jobs/:id        (key or token)  -> {state, error, sizeBytes}
 *   GET  /jobs/:id/file   (?token=)       -> finished MP4
 *
 * Each job drives headless Chrome to the Studio app's /?render=1 page
 * (the app's own exportMp4Project does the frame + narration work, so
 * server and client renders cannot drift), receives the MP4 back, and
 * finishes it with FFmpeg: loudness normalization to -16 LUFS and
 * faststart. Jobs run one at a time; the box is small and renders are
 * CPU-bound, so a queue beats contention.
 *
 * Auth is a shared key that ships in the Studio client bundle (the
 * same trust class as the narration app key), plus per-job tokens for
 * callbacks and downloads. Caps: 10 minutes of project, 1080p max.
 *
 * Env: RENDER_KEY (required), PORT (8791), STUDIO_URL
 * (https://studio.finchlearn.com), CHROME_PATH
 * (/usr/bin/google-chrome-stable), JOB_DIR (/var/lib/finch-render/jobs),
 * PUBLIC_URL (https://render.finchlearn.com).
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.PORT ?? 8791);
const RENDER_KEY = process.env.RENDER_KEY ?? "";
const STUDIO_URL = (process.env.STUDIO_URL ?? "https://studio.finchlearn.com").replace(/\/$/, "");
const CHROME_PATH = process.env.CHROME_PATH ?? "/usr/bin/google-chrome-stable";
const JOB_DIR = process.env.JOB_DIR ?? "/var/lib/finch-render/jobs";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const MAX_TOTAL_MS = 600_000;
const RENDER_TIMEOUT_MS = 12 * 60_000;
const ALLOWED_ORIGINS = new Set([
  "https://studio.finchlearn.com",
  "https://finchlearn-studio.pages.dev",
  "http://localhost:5173",
]);

if (!RENDER_KEY) {
  console.error("RENDER_KEY is required");
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
    "access-control-allow-headers": "content-type, x-render-key, x-render-token, x-render-format",
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
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout = (stdout + d.toString()).slice(-65536);
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
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function processJob(job) {
  const dir = `${JOB_DIR}/${job.id}`;
  await mkdir(dir, { recursive: true });
  let browser;
  try {
    job.state = "rendering";
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--mute-audio",
        "--window-size=1280,800",
      ],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((projectJson) => {
      try {
        localStorage.setItem("ocf.video-studio.project.v1", projectJson);
      } catch {
        // storage unavailable: readiness check below will fail honestly
      }
    }, JSON.stringify(job.project));
    await page.goto(`${STUDIO_URL}/?render=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction("window.__studioRenderReady === true", { timeout: 60_000 });
    const result = await page.evaluate(
      (req) => window.__runStudioRender(req),
      {
        callbackUrl: `${PUBLIC_URL}/jobs/${job.id}/result`,
        token: job.token,
        width: job.width,
        height: job.height,
        captions: job.captions,
      },
    );
    if (!result?.ok) throw new Error(result?.error ?? "the render page reported failure");
    job.state = "processing";
    const rawPath = `${dir}/raw.${job.rawExt ?? "mp4"}`;
    await stat(rawPath); // the callback must have landed the file
    // Loudness-normalize when an audio stream exists; always faststart.
    let hasAudio = false;
    try {
      const probe = await run(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_streams", rawPath],
        30_000,
      );
      hasAudio = (JSON.parse(probe)?.streams ?? []).some((s) => s.codec_type === "audio");
    } catch {
      hasAudio = false;
    }
    const ffArgs = ["-y", "-i", rawPath];
    if (job.rawExt === "webm") {
      // Browser WebM (VP9 + Opus) becomes the delivery MP4 here.
      if (hasAudio) ffArgs.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
      ffArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k");
    } else if (hasAudio) ffArgs.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k");
    else ffArgs.push("-c", "copy");
    ffArgs.push("-movflags", "+faststart", `${dir}/final.mp4`);
    await run("ffmpeg", ffArgs, 5 * 60_000);
    job.sizeBytes = (await stat(`${dir}/final.mp4`)).size;
    job.state = "done";
  } catch (err) {
    job.state = "error";
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`job ${job.id} failed:`, job.error);
  } finally {
    if (browser) await browser.close().catch(() => {});
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

// Sweep finished job files after 2 hours.
setInterval(async () => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [id, job] of jobs) {
    if ((job.state === "done" || job.state === "error") && job.createdAt < cutoff) {
      jobs.delete(id);
      await rm(`${JOB_DIR}/${id}`, { recursive: true, force: true }).catch(() => {});
    }
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
      if (req.headers["x-render-key"] !== RENDER_KEY) {
        return sendJson(req, res, 401, { error: "render key required" });
      }
      const body = JSON.parse((await readBody(req, 32 * 1024 * 1024)).toString("utf8"));
      const project = body?.project;
      const width = Number(body?.width ?? 1280);
      const height = Number(body?.height ?? 720);
      if (!project || !Array.isArray(project.scenes) || project.scenes.length === 0) {
        return sendJson(req, res, 400, { error: "project with at least one scene is required" });
      }
      const totalMs = project.scenes.reduce((sum, s) => sum + (Number(s?.durationMs) || 0), 0);
      if (totalMs <= 0 || totalMs > MAX_TOTAL_MS) {
        return sendJson(req, res, 400, { error: `project length must be 1ms..${MAX_TOTAL_MS}ms` });
      }
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 160 || height < 160 || width > 1920 || height > 1920 || width % 2 || height % 2 || width * height > 1920 * 1080) {
        return sendJson(req, res, 400, { error: "width/height must be even, max 1920 per side and 1080p in total pixels" });
      }
      const job = {
        id: randomUUID(),
        token: randomBytes(18).toString("hex"),
        project,
        width,
        height,
        captions: body?.captions !== false,
        state: "queued",
        error: null,
        sizeBytes: null,
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      queue.push(job);
      void pump();
      return sendJson(req, res, 202, { jobId: job.id, token: job.token });
    }

    const resultMatch = url.pathname.match(/^\/jobs\/([\w-]+)\/result$/);
    if (req.method === "POST" && resultMatch) {
      const job = jobs.get(resultMatch[1]);
      if (!job) return sendJson(req, res, 404, { error: "no such job" });
      if (req.headers["x-render-token"] !== job.token) {
        return sendJson(req, res, 401, { error: "job token required" });
      }
      const data = await readBody(req, 1024 * 1024 * 1024);
      if (data.length === 0) return sendJson(req, res, 400, { error: "empty render" });
      job.rawExt = req.headers["x-render-format"] === "webm" ? "webm" : "mp4";
      const dir = `${JOB_DIR}/${job.id}`;
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/raw.${job.rawExt}`, data);
      return sendJson(req, res, 200, { ok: true, bytes: data.length });
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return sendJson(req, res, 404, { error: "no such job" });
      if (req.headers["x-render-key"] !== RENDER_KEY && req.headers["x-render-token"] !== job.token && url.searchParams.get("token") !== job.token) {
        return sendJson(req, res, 401, { error: "render key or job token required" });
      }
      return sendJson(req, res, 200, {
        jobId: job.id,
        state: job.state,
        error: job.error,
        sizeBytes: job.sizeBytes,
      });
    }

    const fileMatch = url.pathname.match(/^\/jobs\/([\w-]+)\/file$/);
    if (req.method === "GET" && fileMatch) {
      const job = jobs.get(fileMatch[1]);
      if (!job) return sendJson(req, res, 404, { error: "no such job" });
      if (url.searchParams.get("token") !== job.token && req.headers["x-render-token"] !== job.token) {
        return sendJson(req, res, 401, { error: "job token required" });
      }
      if (job.state !== "done") return sendJson(req, res, 409, { error: `job is ${job.state}` });
      const data = await readFile(`${JOB_DIR}/${job.id}/final.mp4`);
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": data.length,
        "content-disposition": 'attachment; filename="studio-video.mp4"',
        ...corsHeaders(req),
      });
      res.end(data);
      return;
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
  console.log(`finch-render listening on 127.0.0.1:${PORT} (studio: ${STUDIO_URL})`);
});
