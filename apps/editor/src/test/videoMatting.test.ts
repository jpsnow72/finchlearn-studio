/**
 * Video matting editor glue (issue #122): metadata round trip through
 * the x-finch-studio extension, the finch-matte job client
 * against a fake fetch, and the shared composite used by both paths.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { VideoObject } from "@finch-studio/core";
import { createFakeMattingAdapter, computeMatteFrames } from "@finch-studio/media";
import {
  getBackgroundRemoval,
  registerMatteAlphaProvider,
  matteAlphaProviderFor,
  requestMatteJob,
  withBackgroundRemoval,
  type BackgroundRemovalSetting,
} from "../videoMatting";

const clip = (): VideoObject => ({
  id: "footage-1",
  type: "video",
  name: "Lesson footage",
  resource: "media/clip.mp4",
  position: { x: 0, y: 0, w: 1280, h: 720 },
  timing: { start: 0, duration: 6 },
  extensions: { "x-finch-studio": { timelineLane: "main" } },
});

const setting: BackgroundRemovalSetting = {
  matteAssetId: "matte:footage-1:abc:rvm-mobilenetv3-1.0.0",
  matteR2Key: "mattes/matte/footage-1/abc/rvm-mobilenetv3-1.0.0.mp4",
  matteJobId: "job-1",
  matteJobToken: "tok-1",
  modelVersion: "rvm-mobilenetv3-1.0.0",
  replacement: { kind: "color", color: "#224466" },
  status: "ready",
};

describe("background removal metadata", () => {
  it("round trips and preserves other extension keys, and clears cleanly", () => {
    const updated = withBackgroundRemoval(clip(), setting);
    expect(getBackgroundRemoval(updated)).toEqual(setting);
    expect(updated.extensions?.["x-finch-studio"]?.timelineLane).toBe("main");
    const cleared = withBackgroundRemoval(updated, null);
    expect(getBackgroundRemoval(cleared)).toBeNull();
    expect(getBackgroundRemoval(clip())).toBeNull();
  });

  it("registers and clears a matte alpha provider per object", () => {
    const provider = { alphaAt: () => new Uint8ClampedArray(4) };
    registerMatteAlphaProvider("footage-1", provider);
    expect(matteAlphaProviderFor("footage-1")).toBe(provider);
    registerMatteAlphaProvider("footage-1", null);
    expect(matteAlphaProviderFor("footage-1")).toBeUndefined();
  });
});

describe("matte pipeline with a fake adapter", () => {
  it("produces alpha frames the shared composite consumes", async () => {
    const adapter = createFakeMattingAdapter((_f, i) => (i === 0 ? 255 : 0));
    const frames = [{ width: 2, height: 1, data: new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 255]) }];
    const alphas = await computeMatteFrames(adapter, frames);
    expect(Array.from(alphas[0])).toEqual([255, 0]);
  });
});

describe("finch-matte job client (live service contract)", () => {
  const base = "https://render.finchlearn.com";
  it("posts raw source bytes to /matte-jobs, polls with the job token, and builds the descriptor from the job response", async () => {
    const calls: { url: string; init?: Record<string, unknown> }[] = [];
    let polls = 0;
    const fetchFn = async (url: string, init?: Record<string, unknown>) => {
      calls.push({ url, init });
      if (url === `${base}/matte-jobs`) {
        return { ok: true, status: 202, json: async () => ({ jobId: "job-1", token: "tok-1", cached: false, cacheKey: "sha1-rvm_mobilenetv3_fp32@v1.0.0" }) };
      }
      polls += 1;
      if (polls === 1) return { ok: true, status: 200, json: async () => ({ state: "matting", cacheKey: "sha1-rvm_mobilenetv3_fp32@v1.0.0" }) };
      return { ok: true, status: 200, json: async () => ({ state: "done", cacheKey: "sha1-rvm_mobilenetv3_fp32@v1.0.0", cached: false, frames: 30, width: 2, height: 1, fps: 30, modelVersion: "rvm_mobilenetv3_fp32@v1.0.0" }) };
    };
    const blob = new Blob(["clip-bytes"], { type: "video/mp4" });
    const statuses: string[] = [];
    const result = await requestMatteJob(
      { sourceAssetId: "a1", sourceBlob: blob, replacement: { kind: "color", color: "#112233" } },
      (t) => statuses.push(t),
      fetchFn as never,
      async () => {},
      base,
    );
    expect(calls[0].url).toBe(`${base}/matte-jobs`);
    const post = calls[0].init as { method: string; headers: Record<string, string>; body: unknown };
    expect(post.method).toBe("POST");
    expect(post.headers["x-render-key"]).toBeDefined();
    expect(post.headers["content-type"]).toBe("video/mp4");
    expect(post.body).toBe(blob);
    expect(calls[1].url).toBe(`${base}/matte-jobs/job-1`);
    expect(calls[2].url).toBe(`${base}/matte-jobs/job-1`);
    const poll = calls[1].init as { headers: Record<string, string> };
    expect(poll.headers["x-render-token"]).toBe("tok-1");
    expect(result.jobId).toBe("job-1");
    expect(result.token).toBe("tok-1");
    expect(result.matte).toEqual({
      id: "job-1",
      kind: "matte",
      sourceAssetId: "a1",
      sourceContentHash: undefined,
      modelVersion: "rvm_mobilenetv3_fp32@v1.0.0",
      r2Key: "sha1-rvm_mobilenetv3_fp32@v1.0.0",
      jobId: "job-1",
      jobToken: "tok-1",
      width: 2,
      height: 1,
      fps: 30,
      durationMs: 1000,
      frameCount: 30,
    });
    expect(statuses.length).toBeGreaterThan(0);
  });

  it("posts the sourceUrl JSON shape when only a fetchable URL is available", async () => {
    const calls: { url: string; init?: Record<string, unknown> }[] = [];
    const fetchFn = async (url: string, init?: Record<string, unknown>) => {
      calls.push({ url, init });
      if (url === `${base}/matte-jobs`) {
        return { ok: true, status: 202, json: async () => ({ jobId: "job-3", token: "tok-3", cached: true, cacheKey: "sha3-model" }) };
      }
      return { ok: true, status: 200, json: async () => ({ state: "done", cacheKey: "sha3-model", frames: 20, width: 320, height: 240, fps: 20 }) };
    };
    const result = await requestMatteJob(
      { sourceAssetId: "a1", sourceUrl: "https://cdn.example/clip.mp4", replacement: { kind: "color", color: "#112233" } },
      () => {},
      fetchFn as never,
      async () => {},
      base,
    );
    const post = calls[0].init as { headers: Record<string, string>; body: string };
    expect(post.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(post.body)).toEqual({ sourceUrl: "https://cdn.example/clip.mp4" });
    expect(result.matte.r2Key).toBe("sha3-model");
    expect(result.matte.jobId).toBe("job-3");
    expect(result.matte.jobToken).toBe("tok-3");
    expect(result.matte.frameCount).toBe(20);
    expect(result.matte.durationMs).toBe(1000);
    expect(result.matte.modelVersion).toBe("rvm_mobilenetv3_fp32@v1.0.0");
  });

  it("surfaces a job error instead of faking a matte", async () => {
    const fetchFn = async (url: string) => {
      if (url.endsWith("/matte-jobs")) {
        return { ok: true, status: 202, json: async () => ({ jobId: "job-2", token: "tok-2" }) };
      }
      return { ok: true, status: 200, json: async () => ({ state: "error", error: "RVM model is not installed on this render host" }) };
    };
    await expect(
      requestMatteJob({ sourceAssetId: "a1", sourceBlob: new Blob(["x"]), replacement: { kind: "color", color: "#112233" } }, () => {}, fetchFn as never, async () => {}, base),
    ).rejects.toThrow(/not installed/);
  });

  it("refuses a source asset id the service cannot resolve, without calling the service", async () => {
    let called = 0;
    const fetchFn = async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; };
    await expect(
      requestMatteJob({ sourceAssetId: "a1", replacement: { kind: "color", color: "#112233" } }, () => {}, fetchFn as never, async () => {}, base),
    ).rejects.toThrow(/could not be resolved/);
    expect(called).toBe(0);
  });

  it("resolves clip resources bytes-first, with a sourceUrl fallback for http resources", async () => {
    const { resolveMatteSource } = await import("../videoMatting");
    const bytes = new Blob(["vid"], { type: "video/mp4" });
    const blobFetch = async () => ({ ok: true, status: 200, json: async () => ({}), blob: async () => bytes });
    const httpBytes = await resolveMatteSource("https://cdn.example/clip.mp4", blobFetch as never);
    expect(httpBytes.sourceBlob).toBe(bytes);
    const httpFallback = await resolveMatteSource("https://cdn.example/clip.mp4", (async () => { throw new Error("browser fetch failed"); }) as never);
    expect(httpFallback).toEqual({ sourceUrl: "https://cdn.example/clip.mp4" });
    const local = await resolveMatteSource("blob:take-1", blobFetch as never);
    expect(local.sourceBlob).toBe(bytes);
    const missing = await resolveMatteSource(undefined, blobFetch as never);
    expect(missing).toEqual({});
  });

  it("surfaces the matte service refusal detail instead of only the status", async () => {
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: "sourceUrl fetch failed: 403" }) });
    await expect(
      requestMatteJob({ sourceAssetId: "a1", sourceUrl: "https://cdn.example/clip.mp4", replacement: { kind: "color", color: "#112233" } }, () => {}, fetchFn as never, async () => {}, base),
    ).rejects.toThrow(/400.*sourceUrl fetch failed: 403/);
  });
});

describe("stored matte loader", () => {
  it("turns matte luminance into alpha and picks the nearest frame", async () => {
    const { alphaFromMattePixels, matteFrameIndexAt, createStoredMatteProvider, loadMatteAlphaProvider, registerMatteAlphaProvider: reg } = await import("../videoMatting");
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(alphaFromMattePixels(px, 2, 1))).toEqual([255, 0]);
    expect(matteFrameIndexAt(0, 10, 30)).toBe(0);
    expect(matteFrameIndexAt(1050, 10, 30)).toBe(11);
    expect(matteFrameIndexAt(999999, 10, 30)).toBe(29);
    const provider = createStoredMatteProvider(
      { fps: 10, frameCount: 2, width: 2, height: 1 },
      [new Uint8ClampedArray([255, 0]), new Uint8ClampedArray([0, 255])],
    );
    expect(Array.from(provider.alphaAt(0, 2, 1) ?? [])).toEqual([255, 0]);
    expect(Array.from(provider.alphaAt(100, 2, 1) ?? [])).toEqual([0, 255]);
    // Resampling to a wider target repeats the nearest source pixel.
    expect(Array.from(provider.alphaAt(0, 4, 1) ?? [])).toEqual([255, 255, 0, 0]);
    reg("loader-clip", null);
    const descriptor = {
      id: "matte:loader-clip", kind: "matte" as const, sourceAssetId: "loader-clip",
      modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "https://example.test/matte.mp4",
      width: 2, height: 1, fps: 10, durationMs: 200, frameCount: 2,
    };
    const progresses: number[] = [];
    const loaded = await loadMatteAlphaProvider("loader-clip", descriptor, {
      grabFrames: async (_url, _plan, onProgress) => {
        onProgress?.(0.5);
        onProgress?.(1);
        return { frames: [new Uint8ClampedArray([255, 0]), new Uint8ClampedArray([0, 255])], width: 2, height: 1 };
      },
      onProgress: (p) => progresses.push(p),
    });
    expect(progresses).toEqual([0.5, 1]);
    const { matteAlphaProviderFor: lookup } = await import("../videoMatting");
    expect(lookup("loader-clip")).toBe(loaded);
    expect(Array.from(loaded.alphaAt(100, 2, 1) ?? [])).toEqual([0, 255]);
    reg("loader-clip", null);
  });

  it("fails honestly and registers nothing when the matte has no readable address", async () => {
    const { loadMatteAlphaProvider, matteAlphaProviderFor: lookup } = await import("../videoMatting");
    const descriptor = {
      id: "matte:orphan", kind: "matte" as const, sourceAssetId: "orphan",
      modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "mattes/matte/orphan.mp4",
      width: 2, height: 1, fps: 10, durationMs: 200, frameCount: 2,
    };
    await expect(loadMatteAlphaProvider("orphan", descriptor, {})).rejects.toThrow(/no readable address/);
    expect(lookup("orphan")).toBeUndefined();
  });

  it("builds the live finch-matte file URL with the job token", async () => {
    const { matteJobFileUrl } = await import("../videoMatting");
    expect(matteJobFileUrl("job 1", "tok/2", "https://matte.example.test")).toBe(
      "https://matte.example.test/matte-jobs/job%201/file?token=tok%2F2",
    );
  });

  it("resolves a descriptor with job id and token to the matte file URL, and a legacy descriptor to no address", async () => {
    const { matteFileUrlForDescriptor } = await import("../videoMatting");
    const withJob = {
      id: "job-9", kind: "matte" as const, sourceAssetId: "clip-9",
      modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "sha9-model",
      jobId: "job-9", jobToken: "tok-9",
      width: 2, height: 1, fps: 10, durationMs: 200, frameCount: 2,
    };
    expect(matteFileUrlForDescriptor(withJob, "https://matte.example.test")).toBe(
      "https://matte.example.test/matte-jobs/job-9/file?token=tok-9",
    );
    const legacy = { ...withJob, jobId: undefined, jobToken: undefined };
    expect(matteFileUrlForDescriptor(legacy, "https://matte.example.test", "")).toBeNull();
    const partial = { ...withJob, jobToken: undefined };
    expect(matteFileUrlForDescriptor(partial, "https://matte.example.test", "")).toBeNull();
  });

  it("shares one decode between concurrent loads of the same object", async () => {
    const { loadMatteAlphaProvider, registerMatteAlphaProvider: reg } = await import("../videoMatting");
    reg("dedupe-clip", null);
    const descriptor = {
      id: "job-dedupe", kind: "matte" as const, sourceAssetId: "dedupe-clip",
      modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "https://example.test/matte.mp4",
      width: 2, height: 1, fps: 10, durationMs: 200, frameCount: 2,
    };
    let grabs = 0;
    const grabFrames = async () => {
      grabs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { frames: [new Uint8ClampedArray([255, 0])], width: 2, height: 1 };
    };
    const [a, b] = await Promise.all([
      loadMatteAlphaProvider("dedupe-clip", descriptor, { grabFrames }),
      loadMatteAlphaProvider("dedupe-clip", descriptor, { grabFrames }),
    ]);
    expect(grabs).toBe(1);
    expect(b).toBe(a);
    reg("dedupe-clip", null);
  });

  it("clears a failed load so a later retry can succeed", async () => {
    const { loadMatteAlphaProvider, matteAlphaProviderFor: lookup, registerMatteAlphaProvider: reg } = await import("../videoMatting");
    reg("retry-clip", null);
    const descriptor = {
      id: "job-retry", kind: "matte" as const, sourceAssetId: "retry-clip",
      modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "https://example.test/matte.mp4",
      width: 2, height: 1, fps: 10, durationMs: 200, frameCount: 2,
    };
    await expect(loadMatteAlphaProvider("retry-clip", descriptor, {
      grabFrames: async () => { throw new Error("the stored matte video stalled (no seeked within 10s)"); },
    })).rejects.toThrow(/stalled/);
    expect(lookup("retry-clip")).toBeUndefined();
    const loaded = await loadMatteAlphaProvider("retry-clip", descriptor, {
      grabFrames: async () => ({ frames: [new Uint8ClampedArray([255, 0])], width: 2, height: 1 }),
    });
    expect(lookup("retry-clip")).toBe(loaded);
    reg("retry-clip", null);
  });

  it("loads a matte through the job file URL stored on its descriptor", async () => {
    const { loadMatteAlphaProvider, registerMatteAlphaProvider: reg } = await import("../videoMatting");
    reg("job-clip", null);
    const descriptor = {
      id: "job-9", kind: "matte" as const, sourceAssetId: "job-clip",
      modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "sha9-model",
      jobId: "job-9", jobToken: "tok-9",
      width: 2, height: 1, fps: 10, durationMs: 200, frameCount: 2,
    };
    const seenUrls: string[] = [];
    const loaded = await loadMatteAlphaProvider("job-clip", descriptor, {
      matteBase: "https://matte.example.test",
      grabFrames: async (url) => {
        seenUrls.push(url);
        return { frames: [new Uint8ClampedArray([255, 0])], width: 2, height: 1 };
      },
    });
    expect(seenUrls).toEqual(["https://matte.example.test/matte-jobs/job-9/file?token=tok-9"]);
    expect(Array.from(loaded.alphaAt(0, 2, 1) ?? [])).toEqual([255, 0]);
    reg("job-clip", null);
  });
});
