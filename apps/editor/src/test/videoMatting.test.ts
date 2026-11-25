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
