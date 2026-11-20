import { describe, expect, it } from "vitest";
import {
  drawProgressAt,
  drawTipPoint,
  handStrokeWidth,
  polylineLength,
  resolveDrawDurationMs,
  sampleDrawOn,
  shapeOutlineStrokes,
  strokeDashFor,
  totalStrokeLength,
  visiblePolyline,
  visibleStrokes,
  wipeClipPath,
  wipeVisibleRect,
  type DrawOnTreatment,
} from "./whiteboard.js";

describe("draw progress as a function of time", () => {
  const treatment: DrawOnTreatment = { durationMs: 1000 };

  it("is zero before and at the start, one at and after the end", () => {
    expect(drawProgressAt(treatment, 500, 4000, 0)).toBe(0);
    expect(drawProgressAt(treatment, 500, 4000, 499)).toBe(0);
    expect(drawProgressAt(treatment, 500, 4000, 500)).toBe(0);
    expect(drawProgressAt(treatment, 500, 4000, 1000)).toBeCloseTo(0.5);
    expect(drawProgressAt(treatment, 500, 4000, 1500)).toBe(1);
    expect(drawProgressAt(treatment, 500, 4000, 99999)).toBe(1);
  });

  it("reports phases and visibility across the bounds", () => {
    expect(sampleDrawOn(treatment, 500, 4000, 250)).toEqual({
      progress: 0, phase: "before", visible: false,
    });
    expect(sampleDrawOn(treatment, 500, 4000, 750).phase).toBe("drawing");
    expect(sampleDrawOn(treatment, 500, 4000, 750).visible).toBe(true);
    expect(sampleDrawOn(treatment, 500, 4000, 2000)).toEqual({
      progress: 1, phase: "holding", visible: true,
    });
  });

  it("is deterministic: the same timestamp always samples the same", () => {
    const a = sampleDrawOn(treatment, 500, 4000, 1234);
    const b = sampleDrawOn(treatment, 500, 4000, 1234);
    expect(a).toEqual(b);
  });

  it("defaults the draw duration to the clip duration", () => {
    expect(resolveDrawDurationMs({}, 3000)).toBe(3000);
    expect(drawProgressAt({}, 0, 3000, 1500)).toBeCloseTo(0.5);
    expect(drawProgressAt({}, 0, 3000, 3000)).toBe(1);
  });

  it("clamps an authored duration longer than the clip to the clip", () => {
    expect(resolveDrawDurationMs({ durationMs: 9000 }, 3000)).toBe(3000);
    expect(drawProgressAt({ durationMs: 9000 }, 0, 3000, 3000)).toBe(1);
  });

  it("eases when an easing is authored", () => {
    const eased = drawProgressAt({ durationMs: 1000, easing: "ease-in" }, 0, 4000, 500);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(0.5);
  });
});

describe("erase and replace", () => {
  const treatment: DrawOnTreatment = {
    durationMs: 1000,
    eraseDelayMs: 500,
    eraseDurationMs: 1000,
  };

  it("holds, then erases back to zero and stays gone", () => {
    expect(sampleDrawOn(treatment, 0, 8000, 1200)).toEqual({
      progress: 1, phase: "holding", visible: true,
    });
    expect(sampleDrawOn(treatment, 0, 8000, 2000).phase).toBe("erasing");
    expect(sampleDrawOn(treatment, 0, 8000, 2000).progress).toBeCloseTo(0.5);
    expect(sampleDrawOn(treatment, 0, 8000, 2500)).toEqual({
      progress: 0, phase: "erased", visible: false,
    });
    expect(sampleDrawOn(treatment, 0, 8000, 7000).visible).toBe(false);
  });

  it("never erases without an erase duration", () => {
    expect(sampleDrawOn({ durationMs: 100 }, 0, 8000, 7000).progress).toBe(1);
  });
});

describe("hand styles", () => {
  it("scale stroke width by style and never go below one", () => {
    expect(handStrokeWidth("marker", 4)).toBe(4);
    expect(handStrokeWidth("chalk", 4)).toBeCloseTo(6.8);
    expect(handStrokeWidth("pen", 4)).toBeCloseTo(2.2);
    expect(handStrokeWidth(undefined, 4)).toBe(4);
    expect(handStrokeWidth("pen", 1)).toBe(1);
  });
});

describe("stroke reveal math", () => {
  const strokes = shapeOutlineStrokes("rect", 100, 50);

  it("builds a rect as four strokes in drawing order", () => {
    expect(strokes).toHaveLength(4);
    expect(strokes[0]).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(totalStrokeLength(strokes)).toBe(300);
    expect(polylineLength(strokes[0])).toBe(100);
  });

  it("reveals stroke by stroke, proportional to length", () => {
    expect(visibleStrokes(strokes, 0)).toEqual([]);
    // First edge is 100 of 300 total: one third completes it exactly.
    expect(visibleStrokes(strokes, 1 / 3)).toEqual([strokes[0]]);
    // Half way: first edge whole, second edge (50 long) whole too.
    expect(visibleStrokes(strokes, 0.5)).toEqual([strokes[0], strokes[1]]);
    expect(visibleStrokes(strokes, 1)).toEqual(strokes);
  });

  it("interpolates the partial stroke tip", () => {
    const partial = visibleStrokes(strokes, 1 / 6);
    expect(partial).toHaveLength(1);
    expect(partial[0][partial[0].length - 1].x).toBeCloseTo(50);
    expect(drawTipPoint(strokes, 1 / 6)).toEqual({ x: 50, y: 0 });
    expect(drawTipPoint(strokes, 0)).toBeNull();
    expect(drawTipPoint(strokes, 1)).toEqual({ x: 0, y: 0 });
  });

  it("clips a polyline at a visible length", () => {
    const line = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];
    expect(visiblePolyline(line, 0)).toEqual([]);
    expect(visiblePolyline(line, 30)).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }]);
    const mid = visiblePolyline(line, 50);
    expect(mid[mid.length - 1]).toEqual({ x: 30, y: 20 });
    expect(visiblePolyline(line, 999)).toEqual(line);
  });

  it("gives dash values that hide then reveal a single path", () => {
    expect(strokeDashFor(200, 0)).toEqual({ strokeDasharray: "200", strokeDashoffset: 200 });
    expect(strokeDashFor(200, 0.25).strokeDashoffset).toBe(150);
    expect(strokeDashFor(200, 1).strokeDashoffset).toBe(0);
  });

  it("builds ellipse, line, and arrow outlines", () => {
    const ellipse = shapeOutlineStrokes("ellipse", 80, 40);
    expect(ellipse).toHaveLength(1);
    expect(ellipse[0].length).toBe(49);
    expect(ellipse[0][0].x).toBeCloseTo(40);
    expect(ellipse[0][0].y).toBeCloseTo(0);
    expect(shapeOutlineStrokes("line", 100, 50)).toEqual([
      [{ x: 0, y: 50 }, { x: 100, y: 0 }],
    ]);
    expect(shapeOutlineStrokes("arrow", 100, 40)).toHaveLength(3);
  });
});

describe("wipe reveal for text and images", () => {
  it("matches the timeline wipe semantics: reveal from the left", () => {
    expect(wipeClipPath(0)).toBe("inset(0 100% 0 0)");
    expect(wipeClipPath(0.5)).toBe("inset(0 50% 0 0)");
    expect(wipeClipPath(1)).toBe("inset(0 0% 0 0)");
    expect(wipeClipPath(0.25, "down")).toBe("inset(0 0 75% 0)");
  });

  it("gives the matching canvas rect", () => {
    expect(wipeVisibleRect(0.5, 200, 100)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(wipeVisibleRect(0.25, 200, 100, "left")).toEqual({ x: 150, y: 0, w: 50, h: 100 });
    expect(wipeVisibleRect(2, 200, 100)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
});
