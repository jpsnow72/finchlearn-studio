/**
 * Video matting editor glue (issue #122): metadata round trip through
 * the x-finch-studio extension, the finch-render matte job client
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

describe("finch-render matte job client", () => {
  it("posts with the render key, polls with the job token, and returns the matte", async () => {
    const calls: { url: string; init?: Record<string, unknown> }[] = [];
    const matte = { id: "matte:x", kind: "matte", sourceAssetId: "a1", modelVersion: "rvm-mobilenetv3-1.0.0", r2Key: "mattes/x.mp4", width: 2, height: 1, fps: 30, durationMs: 1000, frameCount: 30 };
    const fetchFn = async (url: string, init?: Record<string, unknown>) => {
      calls.push({ url, init });
      if (url.endsWith("/matting/jobs")) {
        return { ok: true, status: 202, json: async () => ({ jobId: "job-1", token: "tok-1" }) };
      }
      return { ok: true, status: 200, json: async () => ({ state: "done", matte }) };
    };
    const statuses: string[] = [];
    const result = await requestMatteJob(
      { sourceAssetId: "a1", replacement: { kind: "color", color: "#112233" } },
      (t) => statuses.push(t),
      fetchFn as never,
      async () => {},
    );
    expect(result.matte.r2Key).toBe("mattes/x.mp4");
    const post = calls[0].init as { headers: Record<string, string> };
    expect(post.headers["x-render-key"]).toBeDefined();
    const poll = calls[1].init as { headers: Record<string, string> };
    expect(poll.headers["x-render-token"]).toBe("tok-1");
    expect(statuses.length).toBeGreaterThan(0);
  });

  it("surfaces a job error instead of faking a matte", async () => {
    const fetchFn = async (url: string) => {
      if (url.endsWith("/matting/jobs")) {
        return { ok: true, status: 202, json: async () => ({ jobId: "job-2", token: "tok-2" }) };
      }
      return { ok: true, status: 200, json: async () => ({ state: "error", error: "RVM model is not installed on this render host" }) };
    };
    await expect(
      requestMatteJob({ sourceAssetId: "a1", replacement: { kind: "color", color: "#112233" } }, () => {}, fetchFn as never, async () => {}),
    ).rejects.toThrow(/not installed/);
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
});
