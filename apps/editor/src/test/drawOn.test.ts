import { describe, expect, it } from "vitest";
import type { CourseObject, VideoScene } from "@finch-studio/core";
import {
  drawOnForObject,
  sampleDrawOnForObject,
  whiteboardForScene,
  whiteboardSurfaceForScene,
  withDrawOn,
  withSceneWhiteboard,
} from "../drawOn.js";

function shape(patch: Partial<CourseObject> = {}): CourseObject {
  return {
    id: "sh-1",
    type: "shape",
    position: { x: 10, y: 10, w: 200, h: 100 },
    shape: "rect",
    fill: "#1d4ed8",
    timing: { start: 0.5, duration: 4 },
    ...patch,
  } as CourseObject;
}

function scene(patch: Partial<VideoScene> = {}): VideoScene {
  return {
    id: "sc-1",
    name: "Scene",
    durationMs: 5000,
    background: "#eeeeee",
    objects: [],
    ...patch,
  };
}

describe("draw-on metadata", () => {
  it("round trips a treatment through the object extension", () => {
    const withTreatment = withDrawOn(shape(), {
      durationMs: 2000,
      handStyle: "marker",
      eraseDelayMs: 250,
      eraseDurationMs: 750,
    });
    expect(drawOnForObject(withTreatment)).toEqual({
      durationMs: 2000,
      handStyle: "marker",
      eraseDelayMs: 250,
      eraseDurationMs: 750,
    });
    const cleared = withDrawOn(withTreatment, undefined);
    expect(drawOnForObject(cleared)).toBeUndefined();
  });

  it("preserves other studio metadata when setting draw-on", () => {
    const base = shape({
      extensions: { "x-finch-studio": { timelineLane: "overlay" } },
    } as Partial<CourseObject>);
    const next = withDrawOn(base, { durationMs: 1000 });
    expect(next.extensions?.["x-finch-studio"]?.timelineLane).toBe("overlay");
    expect(drawOnForObject(next)).toEqual({ durationMs: 1000 });
  });

  it("ignores malformed treatment data", () => {
    const bad = shape({
      extensions: { "x-finch-studio": { drawOn: "yes" } },
    } as Partial<CourseObject>);
    expect(drawOnForObject(bad)).toBeUndefined();
    const partial = shape({
      extensions: {
        "x-finch-studio": { drawOn: { durationMs: "soon", handStyle: "spray" } },
      },
    } as Partial<CourseObject>);
    expect(drawOnForObject(partial)).toEqual({});
  });

  it("leaves legacy objects without metadata unaffected", () => {
    const legacy = shape();
    expect(drawOnForObject(legacy)).toBeUndefined();
    expect(sampleDrawOnForObject(legacy, { startMs: 500, durationMs: 4000 }, 1000)).toBeNull();
  });
});

describe("draw-on sampling for editor objects", () => {
  const treated = withDrawOn(shape(), { durationMs: 2000 });
  const range = { startMs: 500, durationMs: 4000 };

  it("resolves the same progress the motion engine resolves", () => {
    expect(sampleDrawOnForObject(treated, range, 400)?.visible).toBe(false);
    expect(sampleDrawOnForObject(treated, range, 1500)?.progress).toBeCloseTo(0.5);
    expect(sampleDrawOnForObject(treated, range, 2500)?.progress).toBe(1);
    expect(sampleDrawOnForObject(treated, range, 9000)?.progress).toBe(1);
  });

  it("does not apply to kinds the whiteboard style does not support", () => {
    const character = withDrawOn(
      { id: "ch-1", type: "character" } as unknown as CourseObject,
      { durationMs: 1000 },
    );
    expect(sampleDrawOnForObject(character, range, 1000)).toBeNull();
  });
});

describe("whiteboard scene style", () => {
  it("round trips through the scene extension", () => {
    const styled = withSceneWhiteboard(scene(), { surface: "#fdfdf8" });
    expect(whiteboardForScene(styled)).toEqual({ surface: "#fdfdf8" });
    expect(whiteboardSurfaceForScene(styled)).toBe("#fdfdf8");
    const cleared = withSceneWhiteboard(styled, undefined);
    expect(whiteboardForScene(cleared)).toBeUndefined();
    expect(whiteboardSurfaceForScene(cleared)).toBeUndefined();
  });

  it("falls back to the scene background for the board surface", () => {
    const styled = withSceneWhiteboard(scene(), {});
    expect(whiteboardSurfaceForScene(styled)).toBe("#eeeeee");
    expect(whiteboardSurfaceForScene(scene())).toBeUndefined();
  });
});
