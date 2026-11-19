import { describe, expect, it } from "vitest";
import { makeStudioProject, makeStudioScene } from "@finch-studio/schema";
import { chooseRenderPath, compareFrames, goldenSampleTimes, planSegments, type FramePixels } from "./render.js";

function frame(fill: number, w = 4, h = 4): FramePixels {
  const data = new Uint8ClampedArray(w * h * 4).fill(fill);
  return { width: w, height: h, data };
}

describe("segments", () => {
  it("plans one segment per scene with stable cache keys", () => {
    const p = makeStudioProject("X");
    p.scenes.push(makeStudioScene("B"));
    const segs = planSegments(p);
    expect(segs).toHaveLength(2);
    expect(planSegments(p)[0].cacheKey).toBe(segs[0].cacheKey);
  });
});

describe("path choice", () => {
  it("headless always goes server", () => {
    expect(chooseRenderPath({ hasFootage: false, heavyTracks: false, webCodecsSupported: true, headless: true }).path).toBe("server");
  });
  it("standard timelines go client", () => {
    expect(chooseRenderPath({ hasFootage: true, heavyTracks: false, webCodecsSupported: true, headless: false }).path).toBe("client");
  });
  it("heavy tracks go server", () => {
    expect(chooseRenderPath({ hasFootage: true, heavyTracks: true, webCodecsSupported: true, headless: false }).path).toBe("server");
  });
});

describe("parity", () => {
  it("identical frames pass", () => {
    const r = compareFrames(frame(120), frame(120));
    expect(r.pass).toBe(true);
    expect(r.meanAbsDiff).toBe(0);
  });
  it("a shifted frame fails", () => {
    const r = compareFrames(frame(120), frame(200));
    expect(r.pass).toBe(false);
    expect(r.driftFraction).toBe(1);
  });
  it("size mismatch fails closed", () => {
    expect(compareFrames(frame(0, 4, 4), frame(0, 8, 8)).pass).toBe(false);
  });
  it("samples cover start, middle, and end", () => {
    const times = goldenSampleTimes(10000);
    expect(times[0]).toBe(0);
    expect(times).toContain(5000);
    expect(times[times.length - 1]).toBe(9960);
  });
});
