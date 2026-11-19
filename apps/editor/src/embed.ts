/**
 * embed.ts — FinchLearn embed handoff service (issue #49, Phase 3).
 *
 * The Studio side of the signed handoff contract (the Canva handoff
 * pattern; design issue #9, shell routing issue #67):
 *
 *  1. FinchLearn mints a signed, short lived handoff token carrying the
 *     user, course, and block context and opens Studio in a popup:
 *       https://studio.finchlearn.com/?embed=finchlearn&handoff=<token>
 *  2. Studio verifies the token BEFORE anything opens. Verification
 *     fails closed: an expired, tampered, wrongly addressed, or
 *     unverifiable handoff renders an error surface and no editor.
 *  3. The editor opens in create mode (a fresh project bound to the
 *     block) or edit mode (the project already bound to the block).
 *  4. On Finish ("Save and Return to Course"), Studio renders the
 *     project, saves the file to the user's media library through the
 *     shipped cloud save path, and posts the return payload to the
 *     opener window at the handoff's return origin (never "*"). If the
 *     render is still running when Finish is pressed, a first payload
 *     with renderState "rendering" goes back immediately (the course
 *     block shows the render state and keeps the project binding), and
 *     a second payload with renderState "ready" follows when the render
 *     lands. The payload is also persisted under a localStorage return
 *     key, the same copy-back channel the legacy embed bridge uses, so
 *     the return survives the popup closing early. The project itself
 *     is never lost: it autosaves locally and syncs to studio_projects.
 *
 * Token format: an HS256 compact JWS (JWT shape),
 *   base64url(header) "." base64url(payload) "." base64url(signature)
 * with header { alg: "HS256", typ: "JWT" }. A two part form
 * (base64url(payload) "." base64url(signature)) is also accepted so the
 * two sides can be reconciled at ship time without a flag day; the
 * signature is HMAC-SHA256 over the signing input either way. The
 * shared secret is build config (VITE_STUDIO_HANDOFF_SECRET), the same
 * trust class as the render and narration app keys already shipped in
 * this bundle. With no secret configured, every handoff is rejected.
 *
 * Payload claims (JSON, camelCase):
 *   v: 1, iss: "finchlearn", aud: "finchlearn-studio",
 *   sub: FinchLearn user id (a "userId" claim is accepted as an alias),
 *   courseId, blockId, mode: "create" | "edit",
 *   projectId: required in edit mode, optional in create mode,
 *   returnOrigin: the exact origin Finish payloads are posted to,
 *   returnUrl: optional deep link back to the course (display only),
 *   iat, exp: seconds since epoch; exp is required and short lived
 *   (minting side guidance: 10 minutes), nonce: single open id.
 *
 * Return payload: see StudioFinishPayload below and
 * docs/embed-contract.md. Field names are pinned there for the
 * FinchLearn side (open-course-format #629) to consume verbatim.
 */
import type { VideoProject } from "@finch-studio/core";
import { formatCaptions } from "./exportPresets";

export const HANDOFF_VERSION = 1;
export const HANDOFF_ISSUER = "finchlearn";
export const HANDOFF_AUDIENCE = "finchlearn-studio";
export const EMBED_FINISH_MESSAGE_TYPE = "finchlearn-studio:finish";
export const EMBED_CANCEL_MESSAGE_TYPE = "finchlearn-studio:cancel";
/** Clock skew tolerated on iat when checking a handoff, in seconds. */
export const HANDOFF_CLOCK_SKEW_SECONDS = 60;
/** Longest handoff lifetime this side accepts, in seconds. */
export const HANDOFF_MAX_LIFETIME_SECONDS = 30 * 60;

const HANDOFF_SECRET =
  (import.meta.env.VITE_STUDIO_HANDOFF_SECRET as string | undefined) ?? "";

export type EmbedMode = "create" | "edit";

/** A verified handoff, normalized for the editor. */
export interface EmbedContext {
  userId: string;
  courseId: string;
  blockId: string;
  mode: EmbedMode;
  /** Bound Studio project id: the handoff's projectId in edit mode. */
  projectId: string | null;
  returnOrigin: string;
  returnUrl: string | null;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type HandoffRejectReason =
  | "not_configured"
  | "malformed"
  | "unsupported_algorithm"
  | "bad_signature"
  | "unsupported_version"
  | "wrong_issuer"
  | "wrong_audience"
  | "missing_claim"
  | "expired"
  | "not_yet_valid"
  | "lifetime_too_long";

export type HandoffVerification =
  | { ok: true; context: EmbedContext }
  | { ok: false; reason: HandoffRejectReason };

/** Raw claims as minted by FinchLearn (before normalization). */
export interface HandoffClaims {
  v: number;
  iss: string;
  aud: string;
  sub?: string;
  userId?: string;
  courseId: string;
  blockId: string;
  mode: EmbedMode;
  projectId?: string | null;
  returnOrigin: string;
  returnUrl?: string | null;
  iat: number;
  exp: number;
  nonce: string;
}

// ---------------------------------------------------------------------------
// base64url + HMAC-SHA256 (WebCrypto, available in browsers and Node 18+)
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, signingInput: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return new Uint8Array(signature);
}

function signaturesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Minting (test support and contract documentation; FinchLearn mints in
// production, with the same secret and shapes)
// ---------------------------------------------------------------------------

export async function mintHandoff(
  claims: HandoffClaims,
  secret: string,
): Promise<string> {
  const signingInput = `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson(claims)}`;
  const signature = await hmacSha256(secret, signingInput);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ---------------------------------------------------------------------------
// Verification (fail closed)
// ---------------------------------------------------------------------------

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function verifyHandoff(
  token: string,
  options: { secret?: string; nowSeconds?: number } = {},
): Promise<HandoffVerification> {
  const secret = options.secret ?? HANDOFF_SECRET;
  if (!secret) return { ok: false, reason: "not_configured" };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }
  const payloadPart = parts.length === 3 ? parts[1]! : parts[0]!;
  const signaturePart = parts[parts.length - 1]!;
  const signingInput = parts.slice(0, -1).join(".");

  if (parts.length === 3) {
    const headerBytes = base64UrlDecode(parts[0]!);
    const header = headerBytes ? decodeJson(headerBytes) : null;
    if (!header) return { ok: false, reason: "malformed" };
    if (header["alg"] !== "HS256") {
      return { ok: false, reason: "unsupported_algorithm" };
    }
  }

  const payloadBytes = base64UrlDecode(payloadPart);
  const signatureBytes = base64UrlDecode(signaturePart);
  if (!payloadBytes || !signatureBytes) return { ok: false, reason: "malformed" };

  const expected = await hmacSha256(secret, signingInput);
  if (!signaturesEqual(expected, signatureBytes)) {
    return { ok: false, reason: "bad_signature" };
  }

  const claims = decodeJson(payloadBytes);
  if (!claims) return { ok: false, reason: "malformed" };
  if (claims["v"] !== HANDOFF_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }
  if (claims["iss"] !== HANDOFF_ISSUER) return { ok: false, reason: "wrong_issuer" };
  if (claims["aud"] !== HANDOFF_AUDIENCE) {
    return { ok: false, reason: "wrong_audience" };
  }

  const userId = nonEmptyString(claims["sub"]) ?? nonEmptyString(claims["userId"]);
  const courseId = nonEmptyString(claims["courseId"]);
  const blockId = nonEmptyString(claims["blockId"]);
  const returnOrigin = nonEmptyString(claims["returnOrigin"]);
  const nonce = nonEmptyString(claims["nonce"]);
  const mode = claims["mode"];
  if (!userId || !courseId || !blockId || !returnOrigin || !nonce) {
    return { ok: false, reason: "missing_claim" };
  }
  if (mode !== "create" && mode !== "edit") {
    return { ok: false, reason: "missing_claim" };
  }
  let returnOriginUrl: URL;
  try {
    returnOriginUrl = new URL(returnOrigin);
  } catch {
    return { ok: false, reason: "missing_claim" };
  }
  if (returnOriginUrl.origin !== returnOrigin) {
    // Must be a bare origin (scheme + host + port), never a path: Finish
    // payloads are posted to exactly this origin.
    return { ok: false, reason: "missing_claim" };
  }
  const projectId = nonEmptyString(claims["projectId"]);
  if (mode === "edit" && !projectId) {
    return { ok: false, reason: "missing_claim" };
  }

  const iat = claims["iat"];
  const exp = claims["exp"];
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isFinite(iat) || !Number.isFinite(exp)) {
    return { ok: false, reason: "missing_claim" };
  }
  if (exp <= now) return { ok: false, reason: "expired" };
  if (iat > now + HANDOFF_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (exp - iat > HANDOFF_MAX_LIFETIME_SECONDS) {
    return { ok: false, reason: "lifetime_too_long" };
  }

  return {
    ok: true,
    context: {
      userId,
      courseId,
      blockId,
      mode,
      projectId,
      returnOrigin,
      returnUrl: nonEmptyString(claims["returnUrl"]),
      nonce,
      issuedAt: iat,
      expiresAt: exp,
    },
  };
}

/** Plain-language copy for a rejected handoff (no em dashes). */
export function handoffRejectMessage(reason: HandoffRejectReason): string {
  switch (reason) {
    case "expired":
      return "This course link has expired. Close this window and open the video block again from your course.";
    case "not_configured":
      return "Course embedding is not configured in this Studio build yet. Close this window and try again later.";
    default:
      return "This course link could not be verified. Close this window and open the video block again from your course.";
  }
}

// ---------------------------------------------------------------------------
// Opening: resolve the URL into an embed decision
// ---------------------------------------------------------------------------

export type EmbedResolution =
  | { kind: "none" }
  /** Legacy local bridge: ?embed=<objectId> with a stashed project. */
  | { kind: "legacy"; objectId: string }
  | { kind: "handoff"; context: EmbedContext }
  | { kind: "invalid"; reason: HandoffRejectReason };

export async function resolveEmbed(
  search: string,
  options: { secret?: string; nowSeconds?: number } = {},
): Promise<EmbedResolution> {
  const params = new URLSearchParams(search);
  const token = params.get("handoff");
  if (token) {
    const result = await verifyHandoff(token, options);
    return result.ok
      ? { kind: "handoff", context: result.context }
      : { kind: "invalid", reason: result.reason };
  }
  if (params.get("embed") === "finchlearn") {
    // The #67 surface names this mode, but without a signed handoff
    // there is no course context to trust. Fail closed.
    return { kind: "invalid", reason: "malformed" };
  }
  const legacy = params.get("embed");
  if (legacy) return { kind: "legacy", objectId: legacy };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Finish: the return payload
// ---------------------------------------------------------------------------

export type StudioRenderState = "ready" | "rendering";

export interface StudioCaptionFile {
  format: "vtt" | "srt";
  /** Hosted caption file URL when one exists; null when content is inline. */
  url: string | null;
  /** Full caption file text (VTT or SRT), always carried inline. */
  content: string;
}

export interface StudioFinishPayload {
  type: typeof EMBED_FINISH_MESSAGE_TYPE;
  version: number;
  courseId: string;
  blockId: string;
  mode: EmbedMode;
  /** The Studio project bound to the block. Present in every state, so
   * Edit again can reopen the same project even mid render. */
  projectId: string;
  renderState: StudioRenderState;
  /** studio_exports row id of the saved render; null while rendering. */
  exportId: string | null;
  /** Media library asset id (the R2 backed export record the course
   * video object references); null while rendering. On this side it is
   * the studio_exports row id, the same value as exportId. */
  assetId: string | null;
  /** R2 object key of the rendered file; null while rendering. */
  objectKey: string | null;
  /** MP4 URL for the rendered video; null while rendering. Plays signed
   * in or out (media identity independence): it is the finch-media
   * Worker download URL for the saved export. */
  mp4Url: string | null;
  /** Poster image URL; null until a poster exists for the export. */
  posterUrl: string | null;
  /** Rendered duration in milliseconds; null while rendering. */
  durationMs: number | null;
  captions: StudioCaptionFile[];
  /** Alias of captions, carried so either field name reconciles. */
  captionFiles: StudioCaptionFile[];
}

export interface FinishRenderResult {
  exportId: string;
  assetId: string;
  objectKey: string | null;
  mp4Url: string;
  posterUrl: string | null;
  durationMs: number;
}

function captionFilesFor(project: VideoProject): StudioCaptionFile[] {
  const files: StudioCaptionFile[] = [];
  for (const format of ["vtt", "srt"] as const) {
    const content = formatCaptions(project, format);
    const body = format === "vtt" ? content.replace(/^WEBVTT\s*/, "").trim() : content.trim();
    if (body.length > 0) files.push({ format, url: null, content });
  }
  return files;
}

export function buildFinishPayload(input: {
  context: EmbedContext;
  project: VideoProject;
  renderState: StudioRenderState;
  render?: FinishRenderResult | null;
}): StudioFinishPayload {
  const { context, project, renderState } = input;
  const render = input.render ?? null;
  if (renderState === "ready" && !render) {
    throw new Error("A ready Finish payload needs the finished render result.");
  }
  if (render && (!render.mp4Url || !render.assetId || !(render.durationMs > 0))) {
    throw new Error("The finished render result is missing its asset id, MP4 URL, or duration.");
  }
  const captions = captionFilesFor(project);
  return {
    type: EMBED_FINISH_MESSAGE_TYPE,
    version: HANDOFF_VERSION,
    courseId: context.courseId,
    blockId: context.blockId,
    mode: context.mode,
    projectId: project.id,
    renderState,
    exportId: render?.exportId ?? null,
    assetId: render?.assetId ?? null,
    objectKey: render?.objectKey ?? null,
    mp4Url: render?.mp4Url ?? null,
    posterUrl: render?.posterUrl ?? null,
    durationMs: render?.durationMs ?? null,
    captions,
    captionFiles: captions,
  };
}

/** Structural check for a Finish payload (the receiving side's mirror). */
export function parseFinishPayload(raw: unknown): StudioFinishPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p["type"] !== EMBED_FINISH_MESSAGE_TYPE) return null;
  if (p["version"] !== HANDOFF_VERSION) return null;
  if (!nonEmptyString(p["courseId"]) || !nonEmptyString(p["blockId"]) || !nonEmptyString(p["projectId"])) {
    return null;
  }
  if (p["mode"] !== "create" && p["mode"] !== "edit") return null;
  if (p["renderState"] !== "ready" && p["renderState"] !== "rendering") return null;
  if (p["renderState"] === "ready") {
    if (!nonEmptyString(p["assetId"]) || !nonEmptyString(p["mp4Url"])) return null;
    if (typeof p["durationMs"] !== "number" || !(p["durationMs"] > 0)) return null;
  }
  const captions = Array.isArray(p["captions"]) ? p["captions"] : Array.isArray(p["captionFiles"]) ? p["captionFiles"] : null;
  if (!captions) return null;
  for (const entry of captions) {
    if (!entry || typeof entry !== "object") return null;
    const c = entry as Record<string, unknown>;
    if (c["format"] !== "vtt" && c["format"] !== "srt") return null;
    if (typeof c["content"] !== "string") return null;
    if (c["url"] !== null && typeof c["url"] !== "string") return null;
  }
  const normalizedCaptions = captions as StudioCaptionFile[];
  return {
    type: EMBED_FINISH_MESSAGE_TYPE,
    version: HANDOFF_VERSION,
    courseId: p["courseId"] as string,
    blockId: p["blockId"] as string,
    mode: p["mode"] as EmbedMode,
    projectId: p["projectId"] as string,
    renderState: p["renderState"] as StudioRenderState,
    exportId: nonEmptyString(p["exportId"]),
    assetId: nonEmptyString(p["assetId"]),
    objectKey: nonEmptyString(p["objectKey"]),
    mp4Url: nonEmptyString(p["mp4Url"]),
    posterUrl: nonEmptyString(p["posterUrl"]),
    durationMs: typeof p["durationMs"] === "number" ? p["durationMs"] : null,
    captions: normalizedCaptions,
    captionFiles: normalizedCaptions,
  };
}

// ---------------------------------------------------------------------------
// Delivery: opener postMessage plus the persisted return channel
// ---------------------------------------------------------------------------

export function embedReturnStorageKey(blockId: string): string {
  return `ocf.video-studio.return.${blockId}`;
}

export function embedPendingStorageKey(blockId: string): string {
  return `finch-studio.embed-pending.${blockId}`;
}

interface MessageTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

export type FinishDelivery = "opener" | "stored" | "opener+stored";

/**
 * Deliver a Finish payload: postMessage to the opener at the handoff's
 * exact return origin (never "*"), and persist it under the return key
 * so the course editor can pick it up even if the popup closes first.
 * Returns which channels carried the payload.
 */
export function deliverFinish(
  payload: StudioFinishPayload,
  context: EmbedContext,
  target?: MessageTarget | null,
  storage?: Pick<Storage, "setItem"> | null,
): FinishDelivery {
  let posted = false;
  const opener =
    target ??
    (typeof window !== "undefined"
      ? (window.opener as unknown as MessageTarget | null)
      : null);
  if (opener && typeof opener.postMessage === "function") {
    opener.postMessage(payload, context.returnOrigin);
    posted = true;
  }
  let stored = false;
  const store =
    storage ??
    (typeof localStorage !== "undefined" ? localStorage : null);
  if (store) {
    try {
      store.setItem(embedReturnStorageKey(context.blockId), JSON.stringify(payload));
      if (payload.renderState === "rendering") {
        store.setItem(embedPendingStorageKey(context.blockId), JSON.stringify(payload));
      }
      stored = true;
    } catch {
      // Storage unavailable: the postMessage channel may still have landed.
    }
  }
  if (posted && stored) return "opener+stored";
  if (posted) return "opener";
  return "stored";
}

/** Read back a persisted pending (rendering) return for a block. */
export function loadPendingReturn(
  blockId: string,
  storage?: Pick<Storage, "getItem"> | null,
): StudioFinishPayload | null {
  const store =
    storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return null;
  try {
    const raw = store.getItem(embedPendingStorageKey(blockId));
    if (!raw) return null;
    const parsed = parseFinishPayload(JSON.parse(raw) as unknown);
    return parsed && parsed.renderState === "rendering" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Complete a pending return when its render lands: same binding fields,
 * renderState flips to "ready", asset fields fill in. Returns null when
 * the pending payload and the render disagree on the project.
 */
export function completePendingReturn(
  pending: StudioFinishPayload,
  context: EmbedContext,
  project: VideoProject,
  render: FinishRenderResult,
): StudioFinishPayload | null {
  if (pending.projectId !== project.id) return null;
  return buildFinishPayload({ context, project, renderState: "ready", render });
}
