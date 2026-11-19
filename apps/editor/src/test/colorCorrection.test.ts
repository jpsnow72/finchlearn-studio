// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { CourseObject } from "@finch-studio/core";
import {
  getObjectColorCorrection,
  isColorCorrectableObject,
  withObjectColorCorrection,
} from "../colorCorrection.js";
import { NEUTRAL_COLOR_CORRECTION } from "@finch-studio/schema";
import { makeStudioImage, useStudioStore } from "../store.js";

const SAMPLE = {
  exposure: 20,
  contrast: 10,
  temperature: -15,
  tint: 5,
  saturation: 30,
};

beforeEach(() => {
  useStudioStore.getState().newProject();
});

describe("object colour correction metadata", () => {
  it("defaults to neutral with nothing stored on an untouched object", () => {
    const obj = makeStudioImage("photo.png");
    expect(getObjectColorCorrection(obj)).toEqual(NEUTRAL_COLOR_CORRECTION);
    expect(obj.extensions).toBeUndefined();
  });

  it("only imagery objects are correctable", () => {
    expect(isColorCorrectableObject(makeStudioImage("a.png"))).toBe(true);
    expect(
      isColorCorrectableObject({
        id: "v1",
        type: "video",
        resource: "clip.mp4",
      } as CourseObject),
    ).toBe(true);
    expect(
      isColorCorrectableObject({
        id: "t1",
        type: "text",
        content: "hi",
      } as CourseObject),
    ).toBe(false);
  });

  it("round trips through the extension and through JSON", () => {
    const obj = makeStudioImage("photo.png");
    const corrected = withObjectColorCorrection(obj, SAMPLE);
    expect(getObjectColorCorrection(corrected)).toEqual(SAMPLE);
    const revived = JSON.parse(JSON.stringify(corrected)) as CourseObject;
    expect(getObjectColorCorrection(revived)).toEqual(SAMPLE);
    // Other studio metadata on the object survives alongside.
    const withLane = {
      ...corrected,
      extensions: {
        "x-finch-studio": {
          ...(corrected.extensions?.["x-finch-studio"] ?? {}),
          timelineLane: "main",
        },
      },
    } as CourseObject;
    const reset = withObjectColorCorrection(withLane, null);
    expect(reset.extensions?.["x-finch-studio"]?.timelineLane).toBe("main");
    expect(getObjectColorCorrection(reset)).toEqual(NEUTRAL_COLOR_CORRECTION);
  });

  it("reset removes the metadata so the object serializes as untouched", () => {
    const obj = makeStudioImage("photo.png");
    const corrected = withObjectColorCorrection(obj, SAMPLE);
    const reset = withObjectColorCorrection(corrected, null);
    expect(reset.extensions).toBeUndefined();
    const neutralSet = withObjectColorCorrection(
      corrected,
      NEUTRAL_COLOR_CORRECTION,
    );
    expect(neutralSet.extensions).toBeUndefined();
  });
});

describe("store integration", () => {
  it("sets, persists, undoes, and resets a correction via the shared undo stack", () => {
    const store = useStudioStore.getState();
    const image = makeStudioImage("photo.png", "Photo");
    store.addObject(image);

    useStudioStore.getState().setObjectColorCorrection(image.id, SAMPLE);
    let obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(getObjectColorCorrection(obj)).toEqual(SAMPLE);
    const raw = localStorage.getItem("ocf.video-studio.project.v1");
    expect(raw).toContain("colorCorrection");

    useStudioStore.getState().undo();
    obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(getObjectColorCorrection(obj)).toEqual(NEUTRAL_COLOR_CORRECTION);

    useStudioStore.getState().redo();
    useStudioStore.getState().setObjectColorCorrection(image.id, null);
    obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(getObjectColorCorrection(obj)).toEqual(NEUTRAL_COLOR_CORRECTION);
    expect(obj.extensions?.["x-finch-studio"]?.colorCorrection).toBeUndefined();
  });
});
