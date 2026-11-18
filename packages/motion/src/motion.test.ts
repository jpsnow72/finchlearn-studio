import { describe, expect, it } from "vitest";
import { cubicBezierAt, EASING_BEZIERS, easeValue, presetTracks, samplePath, sampleTrack, sampleTracks } from "./motion.js";

describe("easing", () => {
  it("linear passes through", () => {
    expect(easeValue("linear", 0.25)).toBeCloseTo(0.25);
  });
  it("bezier endpoints are exact and ease-in starts slow", () => {
    expect(cubicBezierAt(EASING_BEZIERS["ease-in"], 0)).toBe(0);
    expect(cubicBezierAt(EASING_BEZIERS["ease-in"], 1)).toBe(1);
    expect(cubicBezierAt(EASING_BEZIERS["ease-in"], 0.5)).toBeLessThan(0.5);
    expect(cubicBezierAt(EASING_BEZIERS["ease-out"], 0.5)).toBeGreaterThan(0.5);
  });
});

describe("keyframe tracks", () => {
  it("interpolates and holds edges", () => {
    const t = { property: "x" as const, keyframes: [{ atMs: 100, value: 0 }, { atMs: 300, value: 100 }] };
    expect(sampleTrack(t, 0)).toBe(0);
    expect(sampleTrack(t, 200)).toBeCloseTo(50);
    expect(sampleTrack(t, 999)).toBe(100);
  });
});

describe("paths", () => {
  it("samples straight segments by time", () => {
    const p = { smooth: false, waypoints: [{ x: 0, y: 0, atMs: 0 }, { x: 100, y: 50, atMs: 1000 }] };
    const mid = samplePath(p, 500);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(25);
  });
  it("spline passes through waypoints", () => {
    const p = { smooth: true, waypoints: [{ x: 0, y: 0, atMs: 0 }, { x: 50, y: 80, atMs: 500 }, { x: 100, y: 0, atMs: 1000 }] };
    const at = samplePath(p, 500);
    expect(at.x).toBeCloseTo(50);
    expect(at.y).toBeCloseTo(80);
  });
});

describe("presets", () => {
  it("fade-in ends at full opacity", () => {
    const tracks = presetTracks("fade-in", { durationMs: 400 });
    expect(sampleTracks(tracks, 400).opacity).toBeCloseTo(1);
    expect(sampleTracks(tracks, 0).opacity).toBeCloseTo(0);
  });
});
