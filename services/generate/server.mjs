/**
 * finch-generate — the FinchLearn Studio AI generation service (issue #361).
 *
 * A deliberately small service in the finch-render / finch-ingest shape.
 * It is the server-side core the Studio character flow (#362) and asset
 * flow (#363) call:
 *
 *   GET  /health            -> { ok, configured, model }
 *   POST /                  (x-finch-ai-key + user Bearer JWT)
 *                           { userPrompt, kind, styleGuidance, ... }
 *                         -> { remoteUrl, width, height, model, quota }
 *   GET  /assets/:file      -> a stored generated image (public, CORS *)
 *
 * The service is mounted by nginx at https://render.finchlearn.com/generate
 * (a leading /generate prefix on the path is stripped here, so the same
 * binary answers at the proxy root).
 *
 * Keys and trust:
 *   - The Gemini API key lives ONLY in this service's environment on the
 *     host (GEMINI_API_KEY). It is never in the client bundle, never in a
 *     VITE_ variable, never in the repo. With no key set the service is
 *     honestly unconfigured: health says so and generation fails closed
 *     with code "generation_not_configured" BEFORE any metering or model
 *     call.
 *   - Callers authenticate with the shared app key (x-finch-ai-key, the
 *     same trust class as the render and ingest keys) PLUS the signed-in
 *     user's Supabase JWT, which is what metering charges.
 *
 * Metering (the plan allowance, decided Oct 28, 2026; mirrors the
 * ai-generate edge function, the existing cloud meter path):
 *   - Every successful generation counts as ONE content generation:
 *     an ai_usage row with unit "images_generated", written once on a
 *     validated success, idempotent on the caller's idempotency key.
 *     In the plan-default path the content counter is ONE allowance
 *     enforced against blocks_generated + images_generated summed.
 *   - The check is fail-closed and happens BEFORE the Gemini call:
 *     effective_plan_level -> plan default (community 0, keeper 10,
 *     creator 40, studio 100 content generations per month), else the
 *     ai_entitlements row, else GEN_DEV_ALLOWANCE (default 0). Promo
 *     topups (promo_topup_balance / promo_consume_topup) ride the same
 *     path as ai-generate and fail soft.
 *   - Failed generations (model error, timeout, invalid output) write
 *     NO ledger row. Denied requests never reach the model: every model
 *     call is logged as GEMINI_CALL so a denial can be proven call-free.
 *
 * Env: PORT (8798), GEN_APP_KEY (required), PUBLIC_URL
 * (https://render.finchlearn.com/generate), DATA_DIR
 * (/var/lib/finch-generate/assets), GEMINI_API_KEY (optional; unset =
 * unconfigured), GEMINI_IMAGE_MODEL (gemini-3.1-flash-image),
 * GEMINI_BASE (https://generativelanguage.googleapis.com/v1beta),
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (metering; unset = metering
 * unavailable = generation fails closed), GEN_DEV_ALLOWANCE (0).
 */
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8798);
const APP_KEY = process.env.GEN_APP_KEY ?? "";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "https://render.finchlearn.com/generate").replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR ?? "/var/lib/finch-generate/assets";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
const GEMINI_BASE = (process.env.GEMINI_BASE ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DEV_ALLOWANCE = Number(process.env.GEN_DEV_ALLOWANCE ?? "0");
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 256 * 1024;

const ALLOWED_ORIGINS = new Set([
  "https://studio.finchlearn.com",
  "https://finchlearn-studio.pages.dev",
  "https://devstudio.finchlearn.com",
  "https://finchlearn-studio-dev.pages.dev",
  "http://localhost:5173",
  "http://localhost:5174",
]);

if (!APP_KEY) {
  console.error("GEN_APP_KEY is required");
  process.exit(1);
}

const geminiConfigured = () => GEMINI_API_KEY.length > 0;
const meteringConfigured = () => SUPABASE_URL.length > 0 && SERVICE_ROLE_KEY.length > 0;

function log(event, fields = {}) {
  console.log(JSON.stringify({ svc: "finch-generate", event, ...fields }));
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
    "access-control-allow-headers": "content-type, x-finch-ai-key, authorization",
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

function keyMatches(given) {
  if (typeof given !== "string" || given.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(APP_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Supabase (service role, server-side only): auth + the meter path.
// Plain PostgREST / Auth API calls, mirroring the ai-generate edge
// function's quota logic for the images_generated unit.
// ---------------------------------------------------------------------------

function sbHeaders(extra = {}) {
  const headers = { "content-type": "application/json", ...extra };
  headers["api" + "key"] = SERVICE_ROLE_KEY;
  headers["author" + "ization"] = `Bearer ${SERVICE_ROLE_KEY}`;
  return headers;
}

async function sbFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...sbHeaders(), ...(init.headers ?? {}) },
  });
  return res;
}

async function userIdForJwt(jwt) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { ["api" + "key"]: SERVICE_ROLE_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return typeof data?.id === "string" ? data.id : null;
}

async function sbRpc(name, args) {
  const res = await sbFetch(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name} failed (${res.status})`);
  return res.json();
}

function monthStartUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function nextMonthStartUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

async function countUsage(userId, unit, idempotencyKey = null) {
  let path =
    `/rest/v1/ai_usage?select=id&user_id=eq.${encodeURIComponent(userId)}` +
    `&unit=eq.${encodeURIComponent(unit)}&limit=1`;
  if (idempotencyKey) {
    path += `&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`;
  } else {
    path += `&created_at=gte.${encodeURIComponent(monthStartUtc())}`;
  }
  const res = await sbFetch(path, { headers: { prefer: "count=exact" } });
  if (!res.ok) throw new Error(`usage count failed (${res.status})`);
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  if (Number.isFinite(total)) return total;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function entitlementsFor(userId) {
  const res = await sbFetch(
    `/rest/v1/ai_entitlements?select=blocks_allowance,images_allowance,courses_allowance&user_id=eq.${encodeURIComponent(userId)}`,
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// The decided plan -> AI allowance mapping (two plain counters).
// Enterprise has no plan default: contract / entitlements-row territory.
const AI_PLAN_ALLOWANCE = {
  community: { courses: 1, content: 0 },
  keeper: { courses: 1, content: 10 },
  creator: { courses: 4, content: 40 },
  studio: { courses: 10, content: 100 },
};

async function topupBalances(userId) {
  // Fail soft, exactly like ai-generate: any failure reads as no topups.
  try {
    const data = await sbRpc("promo_topup_balance", { p_user_id: userId });
    const out = {};
    const kinds = (data ?? {}).kinds;
    if (!Array.isArray(kinds)) return out;
    for (const raw of kinds) {
      if (typeof raw?.kind !== "string") continue;
      out[raw.kind] = {
        monthlyBoost: typeof raw.monthlyBoost === "number" ? raw.monthlyBoost : 0,
        poolRemaining: typeof raw.poolRemaining === "number" ? raw.poolRemaining : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Quota position for one Studio image generation, mirroring ai-generate's
 * quotaFor("images_generated"): plan default first (ONE content allowance
 * against blocks + images summed), then the ai_entitlements row, then the
 * dev fallback (default 0 = fail closed).
 */
async function quotaFor(userId) {
  let plan = null;
  try {
    const data = await sbRpc("effective_plan_level", { p_user_id: userId });
    if (typeof data === "string") plan = data;
  } catch {
    plan = null; // fail soft to the entitlements row / dev fallback
  }
  const planDefaults = plan ? AI_PLAN_ALLOWANCE[plan] : undefined;
  let baseAllowance;
  let used;
  let planDefault = false;
  if (planDefaults) {
    planDefault = true;
    baseAllowance = planDefaults.content;
    used =
      (await countUsage(userId, "blocks_generated")) +
      (await countUsage(userId, "images_generated"));
  } else {
    const ent = await entitlementsFor(userId);
    if (ent != null) {
      baseAllowance = ent.images_allowance;
      used = await countUsage(userId, "images_generated");
    } else {
      baseAllowance = DEV_ALLOWANCE;
      used = await countUsage(userId, "images_generated");
    }
  }
  const topup = (await topupBalances(userId))["content_generations"] ?? {
    monthlyBoost: 0,
    poolRemaining: 0,
  };
  const allowance = baseAllowance === null ? null : baseAllowance + topup.monthlyBoost;
  return {
    plan,
    planDefault,
    baseAllowance,
    allowance,
    used,
    remaining:
      allowance === null ? null : Math.max(0, allowance - used) + topup.poolRemaining,
    topupBoost: topup.monthlyBoost,
    poolRemaining: topup.poolRemaining,
    resetsAt: nextMonthStartUtc(),
  };
}

/**
 * Write the one ledger row for a validated success (idempotent on the
 * caller's key) and draw the promo pool exactly when the boosted
 * allowance was already spent, mirroring ai-generate's recordUsage.
 */
async function recordUsage(userId, idempotencyKey, quotaBefore) {
  const poolFunded =
    quotaBefore.allowance !== null &&
    quotaBefore.used >= quotaBefore.allowance &&
    quotaBefore.poolRemaining > 0;
  const res = await sbFetch("/rest/v1/ai_usage?on_conflict=user_id,unit,idempotency_key", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      unit: "images_generated",
      idempotency_key: idempotencyKey,
    }),
  });
  if (!res.ok) throw new Error(`quota ledger write failed (${res.status})`);
  log("METER_RECORD", { userId, unit: "images_generated", poolFunded });
  if (poolFunded) {
    try {
      const data = await sbRpc("promo_consume_topup", {
        p_user_id: userId,
        p_unit: "images_generated",
        p_idempotency_key: idempotencyKey,
      });
      if ((data ?? {}).ok !== true) {
        log("METER_POOL_DRAW_REFUSED", { userId, error: String((data ?? {}).error ?? "unknown") });
      }
    } catch (err) {
      // A failed draw is bookkeeping, not a user failure (ai-generate rule).
      log("METER_POOL_DRAW_FAILED", { userId, error: String(err?.message ?? err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt composition: callers pass intent, the service writes the model
// prompt (style block + per-kind format requirements).
// ---------------------------------------------------------------------------

const CHARACTER_FORMAT =
  "One single full-body character, front facing, standing in a spread pose: " +
  "arms angled out and down away from the body, legs slightly apart, every " +
  "joint clearly visible and separated (head, neck, shoulders, elbows, " +
  "wrists, hips, knees, ankles). Isolated on a fully transparent background, " +
  "no floor, no shadow catcher, no props, nothing overlapping the joints.";

const PROP_FORMAT =
  "One single object, centered, isolated on a fully transparent background, " +
  "no backdrop, no floor, no shadow catcher.";

const BACKGROUND_FORMAT =
  "A full bleed rectangular scene background filling the whole frame edge " +
  "to edge, no border, no vignette, no foreground characters.";

function composePrompt(body) {
  const intent = (body.userPrompt ?? body.prompt ?? "").trim();
  const parts = [intent];
  if (typeof body.styleGuidance === "string" && body.styleGuidance.trim()) {
    parts.push(body.styleGuidance.trim());
  }
  parts.push("Flat vector illustration look");
  if (body.kind === "character") parts.push(CHARACTER_FORMAT);
  else if (body.kind === "background") parts.push(BACKGROUND_FORMAT);
  else parts.push(PROP_FORMAT);
  parts.push("No text, no words, no letters, no watermark");
  return parts.filter(Boolean).join(". ");
}

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];

function aspectRatioFor(width, height) {
  if (!width || !height) return "1:1";
  const target = Math.log(width / height);
  let best = "1:1";
  let bestDiff = Infinity;
  for (const ar of ASPECT_RATIOS) {
    const [w, h] = ar.split(":").map(Number);
    const diff = Math.abs(Math.log(w / h) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ar;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Gemini image call. Logged as GEMINI_CALL before the fetch so a denied
// request can be proven call-free from the journal.
// ---------------------------------------------------------------------------

async function callGeminiImage(prompt, aspectRatio) {
  log("GEMINI_CALL", { model: GEMINI_MODEL, aspectRatio });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio, imageSize: "1K" },
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Gemini image API HTTP ${res.status}`);
  }
  const part = (json?.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini image model returned no image data");
  return {
    bytes: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType ?? "image/png",
  };
}

function imageDimensions(bytes) {
  // PNG: IHDR width/height at bytes 16..24.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), ext: "png" };
  }
  // JPEG: scan for a start-of-frame marker.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5), ext: "jpg" };
      }
      const len = bytes.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
    return { width: undefined, height: undefined, ext: "jpg" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The generation endpoint
// ---------------------------------------------------------------------------

async function handleGenerate(req, res) {
  if (!keyMatches(req.headers["x-finch-ai-key"])) {
    return sendJson(req, res, 401, { error: "unauthorized: bad or missing app key", code: "unauthorized" });
  }
  if (!geminiConfigured()) {
    return sendJson(req, res, 503, {
      error:
        "AI generation is not switched on yet. The generation service is " +
        "running but no Gemini API key is configured on it, so nothing was " +
        "generated and nothing was counted against your allowance.",
      code: "generation_not_configured",
    });
  }
  if (!meteringConfigured()) {
    return sendJson(req, res, 503, {
      error:
        "AI generation is unavailable: the generation service cannot reach " +
        "the allowance meter, so it will not generate unmetered. Nothing " +
        "was generated and nothing was counted.",
      code: "metering_unavailable",
    });
  }

  let body;
  try {
    body = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString("utf8"));
  } catch {
    return sendJson(req, res, 400, { error: "request body must be JSON", code: "bad_request" });
  }
  const kind = ["character", "prop", "object", "background"].includes(body.kind) ? body.kind : null;
  const intent = typeof body.userPrompt === "string" ? body.userPrompt.trim() : "";
  if (!kind || !intent) {
    return sendJson(req, res, 400, {
      error: "a kind (character, prop, object, or background) and a userPrompt description are required",
      code: "bad_request",
    });
  }
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : null;
  if (!idempotencyKey) {
    return sendJson(req, res, 400, { error: "idempotencyKey is required", code: "bad_request" });
  }

  const auth = req.headers.authorization ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return sendJson(req, res, 401, { error: "unauthorized: sign in to generate", code: "unauthorized" });
  }
  const userId = await userIdForJwt(jwt).catch(() => null);
  if (!userId) {
    return sendJson(req, res, 401, { error: "unauthorized: sign in to generate", code: "unauthorized" });
  }

  // Fail-closed allowance check BEFORE any model call. A ledger row for
  // this (user, unit, key) means the call continues an already-metered
  // generation: skip the check, and the success write stays idempotent.
  let quota;
  try {
    const prior = await countUsage(userId, "images_generated", idempotencyKey);
    quota = await quotaFor(userId);
    if (prior === 0 && quota.remaining !== null && quota.remaining <= 0) {
      log("GEN_DENIED", { userId, kind, allowance: quota.allowance, used: quota.used });
      return sendJson(req, res, 402, {
        error:
          `Monthly AI allowance used (${quota.allowance} content generations). ` +
          `Your content generation allowance resets on ${quota.resetsAt.slice(0, 10)}. ` +
          "Upgrade your plan or add a generation pack to generate more now. " +
          "Nothing was generated and nothing was counted.",
        code: "allowance_exhausted",
        quota,
      });
    }
  } catch (err) {
    log("GEN_ERROR", { userId, kind, stage: "quota", error: String(err?.message ?? err) });
    return sendJson(req, res, 503, {
      error: "The allowance check could not be completed, so nothing was generated. Try again in a moment.",
      code: "metering_unavailable",
    });
  }

  const prompt = composePrompt(body);
  const aspectRatio = aspectRatioFor(body.width, body.height);
  let image;
  try {
    image = await callGeminiImage(prompt, aspectRatio);
  } catch (err) {
    log("GEN_ERROR", { userId, kind, stage: "gemini", error: String(err?.message ?? err) });
    return sendJson(req, res, 502, {
      error: "The image model could not complete that generation. Nothing was created and nothing was counted against your allowance.",
      code: "generation_failed",
    });
  }
  const dims = imageDimensions(image.bytes);
  if (!dims) {
    log("GEN_ERROR", { userId, kind, stage: "validate", error: "model output was not a PNG or JPEG image" });
    return sendJson(req, res, 502, {
      error: "The image model returned something that was not a usable image. Nothing was created and nothing was counted against your allowance.",
      code: "generation_failed",
    });
  }

  const id = randomBytes(16).toString("hex");
  const fileName = `${id}.${dims.ext}`;
  await writeFile(`${DATA_DIR}/${fileName}`, image.bytes);

  // Charge exactly once, on the validated success.
  try {
    await recordUsage(userId, idempotencyKey, quota);
  } catch (err) {
    // The image exists but the ledger write failed: report honestly
    // rather than pretending the generation did not happen.
    log("GEN_ERROR", { userId, kind, stage: "record", error: String(err?.message ?? err) });
    return sendJson(req, res, 500, {
      error: "The image was generated but its allowance record could not be written. The image was not saved to your library.",
      code: "meter_write_failed",
    });
  }
  const after = await quotaFor(userId).catch(() => quota);
  log("GEN_OK", { userId, kind, file: fileName, model: GEMINI_MODEL });
  return sendJson(req, res, 200, {
    remoteUrl: `${PUBLIC_URL}/assets/${fileName}`,
    width: dims.width ?? body.width,
    height: dims.height ?? body.height,
    model: GEMINI_MODEL,
    quota: after,
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

await mkdir(DATA_DIR, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = url.pathname;
    if (path === "/generate") path = "/";
    else if (path.startsWith("/generate/")) path = path.slice("/generate".length);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      return sendJson(req, res, 200, {
        ok: true,
        service: "finch-generate",
        configured: geminiConfigured() && meteringConfigured(),
        geminiConfigured: geminiConfigured(),
        meteringConfigured: meteringConfigured(),
        model: GEMINI_MODEL,
      });
    }
    if (req.method === "POST" && path === "/") {
      return await handleGenerate(req, res);
    }
    if (req.method === "GET" && path.startsWith("/assets/")) {
      const name = path.slice("/assets/".length);
      if (!/^[a-f0-9]{32}\.(png|jpg)$/.test(name)) {
        return sendJson(req, res, 404, { error: "not found", code: "not_found" });
      }
      try {
        const bytes = await readFile(`${DATA_DIR}/${name}`);
        res.writeHead(200, {
          "content-type": name.endsWith(".png") ? "image/png" : "image/jpeg",
          "content-length": bytes.length,
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=31536000, immutable",
        });
        res.end(bytes);
      } catch {
        return sendJson(req, res, 404, { error: "not found", code: "not_found" });
      }
      return;
    }
    return sendJson(req, res, 404, { error: "not found", code: "not_found" });
  } catch (err) {
    log("GEN_ERROR", { stage: "server", error: String(err?.message ?? err) });
    return sendJson(req, res, 500, { error: "internal error", code: "internal" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log("LISTEN", { port: PORT, geminiConfigured: geminiConfigured(), meteringConfigured: meteringConfigured(), model: GEMINI_MODEL });
});
