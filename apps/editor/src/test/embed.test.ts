/**
 * Embed handoff service (issue #49): signed handoff verification,
 * create vs edit mode open, the Finish return payload shape, and the
 * render-pending return that completes when the render lands.
 */
import { describe, expect, it } from "vitest";
import type { VideoProject } from "@finch-studio/core";
import {
  EMBED_FINISH_MESSAGE_TYPE,
  buildFinishPayload,
  completePendingReturn,
  deliverFinish,
  embedPendingStorageKey,
  embedReturnStorageKey,
  loadPendingReturn,
  mintHandoff,
  parseFinishPayload,
  resolveEmbed,
  verifyHandoff,
  type EmbedContext,
  type FinishRenderResult,
  type HandoffClaims,
} from "../embed";

const SECRET = "test-handoff-secret";
const NOW = 1_800_000_000;

function claims(overrides: Partial<HandoffClaims> = {}): HandoffClaims {
  return {
    v: 1,
    iss: "finchlearn",
    aud: "finchlearn-studio",
    sub: "user-1",
    courseId: "course-1",
    blockId: "block-1",
    mode: "create",
    returnOrigin: "https://finchlearn.com",
    iat: NOW - 60,
    exp: NOW + 540,
    nonce: "nonce-1",
    ...overrides,
  };
}

function projectWithSpeech(): VideoProject {
  return {
    id: "proj-1",
    name: "Safety intro",
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        durationMs: 5000,
        objects: [
          {
            id: "char-1",
            type: "character",
            characterId: "student",
            speech: [{ id: "line-1", text: "Hello there.", start: 0, duration: 2000 }],
          },
        ],
      },
    ],
  } as unknown as VideoProject;
}

const context: EmbedContext = {
  userId: "user-1",
  courseId: "course-1",
  blockId: "block-1",
  mode: "create",
  projectId: null,
  returnOrigin: "https://finchlearn.com",
  returnUrl: null,
  nonce: "nonce-1",
  issuedAt: NOW - 60,
  expiresAt: NOW + 540,
};

const renderResult: FinishRenderResult = {
  exportId: "export-1",
  assetId: "export-1",
  objectKey: "s/user-1/safety-intro.mp4",
  mp4Url: "https://media.example/s/user-1/safety-intro.mp4?sig=abc",
  posterUrl: null,
  durationMs: 5000,
};

describe("handoff verification", () => {
  it("accepts a correctly signed, in-window handoff", async () => {
    const token = await mintHandoff(claims(), SECRET);
    const result = await verifyHandoff(token, { secret: SECRET, nowSeconds: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.userId).toBe("user-1");
    expect(result.context.courseId).toBe("course-1");
    expect(result.context.blockId).toBe("block-1");
    expect(result.context.mode).toBe("create");
    expect(result.context.returnOrigin).toBe("https://finchlearn.com");
  });

  it("accepts the two part token form when minted as two parts", async () => {
    // A two part token signs the payload segment alone; it is a
    // different minting, not a three part token with the header cut off.
    const payloadSegment = await mintHandoff(claims(), SECRET).then(
      (t) => t.split(".")[1]!,
    );
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadSegment)),
    );
    let binary = "";
    for (const byte of signature) binary += String.fromCharCode(byte);
    const signatureSegment = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = await verifyHandoff(`${payloadSegment}.${signatureSegment}`, {
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a userId claim as the sub alias", async () => {
    const { sub: _sub, ...rest } = claims();
    const token = await mintHandoff({ ...rest, userId: "user-9" }, SECRET);
    const result = await verifyHandoff(token, { secret: SECRET, nowSeconds: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.userId).toBe("user-9");
  });

  it("rejects a tampered payload", async () => {
    const token = await mintHandoff(claims(), SECRET);
    const [header, , signature] = token.split(".");
    const forgedBytes = new TextEncoder().encode(
      JSON.stringify(claims({ courseId: "course-2" })),
    );
    let binary = "";
    for (const byte of forgedBytes) binary += String.fromCharCode(byte);
    const forgedPayload = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const forged = `${header}.${forgedPayload}.${signature}`;
    const result = await verifyHandoff(forged, { secret: SECRET, nowSeconds: NOW });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects the wrong secret and a garbage token", async () => {
    const token = await mintHandoff(claims(), SECRET);
    expect(
      await verifyHandoff(token, { secret: "other-secret", nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyHandoff("not-a-token", { secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects an expired handoff", async () => {
    const token = await mintHandoff(claims({ iat: NOW - 1200, exp: NOW - 600 }), SECRET);
    expect(await verifyHandoff(token, { secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a handoff addressed to someone else", async () => {
    const token = await mintHandoff(claims({ aud: "someone-else" }), SECRET);
    expect(await verifyHandoff(token, { secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "wrong_audience",
    });
  });

  it("rejects a handoff with a missing course or block claim", async () => {
    const { blockId: _blockId, ...rest } = claims();
    const token = await mintHandoff(rest as HandoffClaims, SECRET);
    expect(await verifyHandoff(token, { secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "missing_claim",
    });
  });

  it("rejects an over-long handoff lifetime", async () => {
    const token = await mintHandoff(claims({ exp: NOW + 7200 }), SECRET);
    expect(await verifyHandoff(token, { secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "lifetime_too_long",
    });
  });

  it("fails closed when no secret is configured", async () => {
    const token = await mintHandoff(claims(), SECRET);
    expect(await verifyHandoff(token, { secret: "", nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});

describe("embed resolution: create vs edit mode", () => {
  it("opens create mode from a create handoff", async () => {
    const token = await mintHandoff(claims({ mode: "create" }), SECRET);
    const resolved = await resolveEmbed(`?embed=finchlearn&handoff=${token}`, {
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(resolved.kind).toBe("handoff");
    if (resolved.kind !== "handoff") return;
    expect(resolved.context.mode).toBe("create");
    expect(resolved.context.projectId).toBeNull();
  });

  it("opens edit mode with the bound project id", async () => {
    const token = await mintHandoff(claims({ mode: "edit", projectId: "proj-1" }), SECRET);
    const resolved = await resolveEmbed(`?embed=finchlearn&handoff=${token}`, {
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(resolved.kind).toBe("handoff");
    if (resolved.kind !== "handoff") return;
    expect(resolved.context.mode).toBe("edit");
    expect(resolved.context.projectId).toBe("proj-1");
  });

  it("rejects an edit handoff with no project id", async () => {
    const token = await mintHandoff(claims({ mode: "edit" }), SECRET);
    const resolved = await resolveEmbed(`?handoff=${token}`, {
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(resolved).toEqual({ kind: "invalid", reason: "missing_claim" });
  });

  it("fails closed on an embed surface with no handoff", async () => {
    const resolved = await resolveEmbed("?embed=finchlearn&courseId=c&blockId=b", {
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(resolved.kind).toBe("invalid");
  });

  it("keeps the legacy local bridge and the standalone surface", async () => {
    expect(await resolveEmbed("?embed=obj-7", { secret: SECRET })).toEqual({
      kind: "legacy",
      objectId: "obj-7",
    });
    expect(await resolveEmbed("", { secret: SECRET })).toEqual({ kind: "none" });
  });
});

describe("Finish return payload", () => {
  it("builds the ready payload with the full pinned shape", () => {
    const payload = buildFinishPayload({
      context,
      project: projectWithSpeech(),
      renderState: "ready",
      render: renderResult,
    });
    expect(payload.type).toBe(EMBED_FINISH_MESSAGE_TYPE);
    expect(payload.version).toBe(1);
    expect(payload.courseId).toBe("course-1");
    expect(payload.blockId).toBe("block-1");
    expect(payload.projectId).toBe("proj-1");
    expect(payload.renderState).toBe("ready");
    expect(payload.assetId).toBe("export-1");
    expect(payload.exportId).toBe("export-1");
    expect(payload.objectKey).toBe("s/user-1/safety-intro.mp4");
    expect(payload.mp4Url).toContain(".mp4");
    expect(payload.posterUrl).toBeNull();
    expect(payload.durationMs).toBe(5000);
    expect(payload.captions.map((c) => c.format)).toEqual(["vtt", "srt"]);
    expect(payload.captions[0]?.content).toContain("Hello there.");
    expect(payload.captionFiles).toEqual(payload.captions);
    expect(parseFinishPayload(payload)).toEqual(payload);
  });

  it("refuses a ready payload without a finished render", () => {
    expect(() =>
      buildFinishPayload({ context, project: projectWithSpeech(), renderState: "ready" }),
    ).toThrow();
    expect(() =>
      buildFinishPayload({
        context,
        project: projectWithSpeech(),
        renderState: "ready",
        render: { ...renderResult, mp4Url: "" },
      }),
    ).toThrow();
  });

  it("rejects malformed payloads on the receiving mirror", () => {
    expect(parseFinishPayload(null)).toBeNull();
    expect(parseFinishPayload({ type: "something-else" })).toBeNull();
    const ready = buildFinishPayload({
      context,
      project: projectWithSpeech(),
      renderState: "ready",
      render: renderResult,
    });
    expect(parseFinishPayload({ ...ready, mp4Url: null })).toBeNull();
    expect(parseFinishPayload({ ...ready, blockId: "" })).toBeNull();
  });
});

describe("render-pending return", () => {
  it("builds a rendering payload that binds the project with null asset fields", () => {
    const payload = buildFinishPayload({
      context,
      project: projectWithSpeech(),
      renderState: "rendering",
    });
    expect(payload.renderState).toBe("rendering");
    expect(payload.projectId).toBe("proj-1");
    expect(payload.assetId).toBeNull();
    expect(payload.mp4Url).toBeNull();
    expect(payload.durationMs).toBeNull();
    expect(parseFinishPayload(payload)).toEqual(payload);
  });

  it("completes the pending payload when the render lands", () => {
    const pending = buildFinishPayload({
      context,
      project: projectWithSpeech(),
      renderState: "rendering",
    });
    const done = completePendingReturn(pending, context, projectWithSpeech(), renderResult);
    expect(done?.renderState).toBe("ready");
    expect(done?.assetId).toBe("export-1");
    expect(done?.mp4Url).toBe(renderResult.mp4Url);
    const other = { ...projectWithSpeech(), id: "proj-2" };
    expect(completePendingReturn(pending, context, other, renderResult)).toBeNull();
  });

  it("delivers to the opener at the exact return origin and persists the pending return", () => {
    const pending = buildFinishPayload({
      context,
      project: projectWithSpeech(),
      renderState: "rendering",
    });
    const posted: { message: unknown; origin: string }[] = [];
    const target = {
      postMessage: (message: unknown, origin: string) => {
        posted.push({ message, origin });
      },
    };
    const entries = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => void entries.set(k, v),
      getItem: (k: string) => entries.get(k) ?? null,
    };
    const delivery = deliverFinish(pending, context, target, storage);
    expect(delivery).toBe("opener+stored");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.origin).toBe("https://finchlearn.com");
    expect(posted[0]?.message).toEqual(pending);
    expect(JSON.parse(entries.get(embedReturnStorageKey("block-1")) ?? "{}")).toEqual(pending);
    expect(entries.has(embedPendingStorageKey("block-1"))).toBe(true);
    expect(loadPendingReturn("block-1", storage)).toEqual(pending);
  });
});
