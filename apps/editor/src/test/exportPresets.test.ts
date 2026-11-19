import { describe, expect, it } from "vitest";
import type { CharacterObject, VideoProject, VideoScene } from "@finch-studio/core";
import {
  EXPORT_PRESETS,
  exportDimensionsForAspect,
  exportFileBaseName,
  formatCaptions,
  getExportPreset,
  getRenderViewport,
  resolveExportPreset,
} from "../exportPresets";
import {
  captionEditKey,
  getCaptionAt,
  getCaptionCues,
  getCaptionStyle,
  type CaptionProject,
} from "../captions";

function speechScene(
  name: string,
  speech: CharacterObject["speech"] = [],
  transition: VideoScene["transition"] = "cut",
): VideoScene {
  return {
    id: name,
    name,
    durationMs: 5000,
    transition,
    transitionMs: 1000,
    objects: [{
      id: `${name}-character`,
      type: "character",
      characterId: "student",
      speech,
    }],
  };
}

describe("export presets", () => {
  it("offers video, GIF, audio, and caption presets with the expected dimensions", () => {
    expect(EXPORT_PRESETS.map(({ id }) => id)).toEqual([
      "lms",
      "mp4-720",
      "mp4-1080",
      "youtube-1080",
      "youtube-720",
      "shorts",
      "gif",
      "audio",
      "srt",
      "vtt",
    ]);
    expect(getExportPreset("youtube-1080")).toMatchObject({ width: 1920, height: 1080 });
    expect(getExportPreset("shorts")).toMatchObject({ width: 1080, height: 1920 });
    expect(getRenderViewport(1080, 1920)).toEqual({
      scale: 0.84375,
      offsetX: 0,
      offsetY: 656.25,
    });
  });

  it("formats speech as SRT and VTT with scene transition offsets", () => {
    const project: VideoProject = {
      id: "project",
      name: "Course",
      scenes: [
        speechScene("one", [{ id: "line-1", text: " Hello ", start: 1500, duration: 1000 }]),
        speechScene("two", [{ id: "line-2", text: "Next.", start: 0, duration: 500 }], "fade"),
      ],
    };

    expect(formatCaptions(project, "srt")).toBe(
      "1\n00:00:01,500 --> 00:00:02,500\nHello\n\n2\n00:00:04,000 --> 00:00:04,500\nNext.",
    );
    expect(formatCaptions(project, "vtt")).toBe(
      "WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.500\nHello\n\n2\n00:00:04.000 --> 00:00:04.500\nNext.\n",
    );
  });

  it("uses editable caption text and timing for sidecar exports", () => {
    const project: CaptionProject = {
      id: "project",
      name: "Course",
      scenes: [speechScene("one", [
        { id: "line-1", text: "Narration text", start: 1000, duration: 2000 },
      ])],
      extensions: {
        "x-finch-studio": {
          captionEdits: {
            [captionEditKey("one", "line-1")]: {
              text: "Caption text",
              startMs: 1500,
              durationMs: 800,
            },
          },
          captionStyle: { font: "serif", size: 40, position: "top" },
        },
      },
    };

    expect(getCaptionCues(project)).toMatchObject([
      { text: "Caption text", startMs: 1500, durationMs: 800 },
    ]);
    expect(getCaptionAt(project, "one", 2000)).toBe("Caption text");
    expect(getCaptionAt(project, "one", 2400)).toBeUndefined();
    expect(getCaptionStyle(project)).toEqual({
      font: "serif",
      size: 40,
      position: "top",
    });
    expect(formatCaptions(project, "srt")).toBe(
      "1\n00:00:01,500 --> 00:00:02,300\nCaption text",
    );
  });

  it("omits empty and out-of-scene speech and sanitizes download names", () => {
    const project: VideoProject = {
      id: "project",
      name: "Course",
      scenes: [
        speechScene("one", [
          { id: "empty", text: "  ", start: 0, duration: 100 },
          { id: "late", text: "Outside", start: 5000, duration: 500 },
        ]),
      ],
    };
    expect(formatCaptions(project, "vtt")).toBe("WEBVTT\n\n");
    expect(exportFileBaseName("../lesson: one?")).toBe("-lesson- one-");
    expect(exportFileBaseName("...")).toBe("video");
  });
});

describe("export dimensions per project aspect (issue #13)", () => {
  it("keeps 16:9 presets at their familiar dimensions for 16:9 projects", () => {
    expect(resolveExportPreset("mp4-720", "16:9")).toMatchObject({ width: 1280, height: 720 });
    expect(resolveExportPreset("mp4-1080", "16:9")).toMatchObject({ width: 1920, height: 1080 });
    expect(resolveExportPreset("lms", "16:9")).toMatchObject({ width: 1280, height: 720 });
  });

  it("exports portrait dimensions for 9:16 projects at the same tier", () => {
    expect(resolveExportPreset("mp4-720", "9:16")).toMatchObject({ width: 720, height: 1280 });
    expect(resolveExportPreset("mp4-1080", "9:16")).toMatchObject({ width: 1080, height: 1920 });
    expect(resolveExportPreset("shorts", "9:16")).toMatchObject({ width: 1080, height: 1920 });
  });

  it("exports square dimensions for 1:1 projects at the same tier", () => {
    expect(resolveExportPreset("mp4-720", "1:1")).toMatchObject({ width: 720, height: 720 });
    expect(resolveExportPreset("youtube-1080", "1:1")).toMatchObject({ width: 1080, height: 1080 });
  });

  it("lets the project aspect win over a preset's native shape", () => {
    expect(resolveExportPreset("shorts", "16:9")).toMatchObject({ width: 1920, height: 1080 });
    expect(resolveExportPreset("youtube-720", "9:16")).toMatchObject({ width: 720, height: 1280 });
  });

  it("leaves dimension-free presets untouched", () => {
    expect(exportDimensionsForAspect(getExportPreset("gif"), "9:16")).toBeUndefined();
    expect(resolveExportPreset("srt", "1:1").width).toBeUndefined();
  });

  it("letterboxes the portrait stage into landscape outputs and fills portrait outputs", () => {
    const portraitStage = { width: 720, height: 1280 };
    expect(getRenderViewport(720, 1280, portraitStage)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(getRenderViewport(1280, 720, portraitStage)).toEqual({
      scale: 0.5625,
      offsetX: 437.5,
      offsetY: 0,
    });
    const squareStage = { width: 720, height: 720 };
    expect(getRenderViewport(1080, 1080, squareStage)).toEqual({
      scale: 1.5,
      offsetX: 0,
      offsetY: 0,
    });
  });
});
