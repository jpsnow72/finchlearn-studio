import { describe, expect, it } from "vitest";
import type { CharacterObject, VideoProject, VideoScene } from "@finch-studio/core";
import {
  EXPORT_PRESETS,
  exportFileBaseName,
  formatCaptions,
  getExportPreset,
  getRenderViewport,
} from "../exportPresets";

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
