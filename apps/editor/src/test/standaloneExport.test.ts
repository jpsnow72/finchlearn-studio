import { describe, expect, it } from "vitest";
import type { VideoScene } from "@finch-studio/core";
import { sceneDialogueLines } from "../standaloneExport";

function scene(objects: VideoScene["objects"]): VideoScene {
  return { id: "s1", name: "Scene", durationMs: 5000, transition: "cut", objects };
}

describe("standalone export adapter", () => {
  it("collects scene dialogue in spoken order across characters", () => {
    const s = scene([
      {
        id: "c1",
        type: "character",
        characterId: "student",
        speech: [
          { id: "l2", text: " Second ", start: 2000, duration: 1000 },
          { id: "l1", text: "First", start: 0, duration: 1000 },
        ],
      } as VideoScene["objects"][number],
      {
        id: "c2",
        type: "character",
        characterId: "professor",
        speech: [{ id: "l3", text: "Middle", start: 1000, duration: 500 }],
      } as VideoScene["objects"][number],
      { id: "t1", type: "text", content: "Not dialogue" } as VideoScene["objects"][number],
    ]);
    expect(sceneDialogueLines(s)).toEqual(["First", "Middle", "Second"]);
  });

  it("returns no lines for a scene without speech", () => {
    expect(sceneDialogueLines(scene([]))).toEqual([]);
  });
});
