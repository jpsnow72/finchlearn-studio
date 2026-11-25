import { describe, expect, it } from "vitest";
import {
  RVM_MODEL,
  compositeFrame,
  compositePixel,
  computeMatteFrames,
  createFakeMattingAdapter,
  createMatteAssetDescriptor,
  createMatteJob,
  matteCacheKey,
  matteR2Key,
  parseHexColor,
  transitionMatteJob,
  validateMatteReplacement,
  type RgbaFrame,
} from "./videoMatting.js";

const frame = (pixels: number[]): RgbaFrame => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray(pixels),
});

describe("video matting core (issue #122)", () => {
  it("keys the matte to the source footage plus the model version", () => {
    const a = matteCacheKey({ sourceAssetId: "clip-1", sourceContentHash: "abc123" });
    const b = matteCacheKey({ sourceAssetId: "clip-1", sourceContentHash: "abc123" });
    const c = matteCacheKey({ sourceAssetId: "clip-1", sourceContentHash: "other" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain(RVM_MODEL.version);
    const req = { sourceAssetId: "clip-1", sourceContentHash: "abc123", replacement: { kind: "color", color: "#112233" } as const };
    expect(matteR2Key(req)).toBe(`mattes/matte/clip-1/abc123/${RVM_MODEL.version}.mp4`);
    const desc = createMatteAssetDescriptor(req, { width: 1280, height: 720, fps: 30, durationMs: 4000 });
    expect(desc).toMatchObject({ kind: "matte", sourceAssetId: "clip-1", frameCount: 120, r2Key: matteR2Key(req) });
  });

  it("composites foreground over replacement by alpha, the one shared formula", () => {
    expect(compositePixel({ r: 200, g: 0, b: 0 }, { r: 0, g: 0, b: 100 }, 1)).toEqual({ r: 200, g: 0, b: 0 });
    expect(compositePixel({ r: 200, g: 0, b: 0 }, { r: 0, g: 0, b: 100 }, 0)).toEqual({ r: 0, g: 0, b: 100 });
    expect(compositePixel({ r: 200, g: 100, b: 0 }, { r: 0, g: 100, b: 200 }, 0.5)).toEqual({ r: 100, g: 100, b: 100 });
    const src = frame([200, 0, 0, 255, 0, 200, 0, 255]);
    const out = compositeFrame(src, new Uint8ClampedArray([255, 0]), parseHexColor("#000064"));
    expect(Array.from(out.data)).toEqual([200, 0, 0, 255, 0, 0, 100, 255]);
    const bg = frame([10, 20, 30, 255, 40, 50, 60, 255]);
    const out2 = compositeFrame(src, new Uint8ClampedArray([0, 255]), bg);
    expect(Array.from(out2.data)).toEqual([10, 20, 30, 255, 0, 200, 0, 255]);
    expect(() => compositeFrame(src, new Uint8ClampedArray([1]), parseHexColor("#000000"))).toThrow(/does not match/);
  });

  it("runs a fake adapter over frames with progress and size checks", async () => {
    const adapter = createFakeMattingAdapter((_f, i) => (i === 0 ? 255 : 0));
    const seen: number[] = [];
    const alphas = await computeMatteFrames(adapter, [frame([1, 2, 3, 255, 4, 5, 6, 255]), frame([7, 8, 9, 255, 10, 11, 12, 255])], (p) => seen.push(p));
    expect(alphas.map((a) => Array.from(a))).toEqual([[255, 0], [255, 0]]);
    expect(seen).toEqual([0.5, 1]);
    const bad = createFakeMattingAdapter(() => 0);
    bad.inferAlpha = async () => new Uint8ClampedArray(1);
    await expect(computeMatteFrames(bad, [frame([0, 0, 0, 255, 0, 0, 0, 255])])).rejects.toThrow(/alpha bytes/);
  });

  it("walks the job state machine and rejects illegal moves", () => {
    let job = createMatteJob();
    job = transitionMatteJob(job, "queued");
    job = transitionMatteJob(job, "processing", { progress: 0.4 });
    job = transitionMatteJob(job, "ready", { progress: 7 });
    expect(job.state).toBe("ready");
    expect(job.progress).toBe(1);
    expect(() => transitionMatteJob(createMatteJob(), "ready")).toThrow(/cannot move/);
  });

  it("validates replacement picks before inference", () => {
    expect(validateMatteReplacement({ kind: "color", color: "#112233" })).toBeNull();
    expect(validateMatteReplacement({ kind: "color", color: "blue" })).toMatch(/hex/);
    expect(validateMatteReplacement({ kind: "image", assetId: "" })).toMatch(/image/);
    expect(validateMatteReplacement({ kind: "image", assetId: "img-1" })).toBeNull();
    expect(validateMatteReplacement({ kind: "scene-background", sceneId: "" })).toMatch(/scene/);
    expect(validateMatteReplacement({ kind: "scene-background", sceneId: "s2" })).toBeNull();
  });
});
