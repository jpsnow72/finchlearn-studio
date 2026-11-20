import { describe, expect, it } from "vitest";
import {
  applyMulticamSync,
  createMulticamGroup,
  makeStudioProject,
  nudgeMulticamAngle,
  switchMulticamAngle,
  type StudioScene,
} from "@finch-studio/schema";
import { planMulticamCuts, planSegments } from "./render.js";

function multicamScene(): StudioScene {
  const p = makeStudioProject("Multi");
  const scene = p.scenes[0];
  const base = createMulticamGroup({
    id: "g",
    durationMs: scene.durationMs,
    angles: [
      { id: "a1", label: "Wide", sourceId: "el-wide" },
      { id: "a2", label: "Close", sourceId: "el-close" },
    ],
  });
  if (!base) throw new Error("group should build");
  const synced = applyMulticamSync(base, [
    { angleId: "a2", offsetMs: 300, confidence: 0.9, quality: "high" },
  ]);
  scene.multicam = switchMulticamAngle(nudgeMulticamAngle(synced, "a2", -50), 2000, "a2", "seg-2");
  return scene;
}

describe("planMulticamCuts (#47)", () => {
  it("plans no cuts for a scene without multicam", () => {
    const p = makeStudioProject("Plain");
    expect(planMulticamCuts(p.scenes[0])).toEqual([]);
  });

  it("plans one cut per segment with the angle offset applied", () => {
    const cuts = planMulticamCuts(multicamScene());
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toMatchObject({
      angleId: "a1",
      sourceId: "el-wide",
      startMs: 0,
      endMs: 2000,
      sourceStartMs: 0,
      sourceEndMs: 2000,
    });
    // Sync offset 300 plus a nudge of -50 lands at 250.
    expect(cuts[1]).toMatchObject({
      angleId: "a2",
      sourceId: "el-close",
      startMs: 2000,
      endMs: 5000,
      sourceStartMs: 2250,
      sourceEndMs: 5250,
    });
  });

  it("segment changes change the render segment cache key", () => {
    const p = makeStudioProject("Multi");
    p.scenes[0] = multicamScene();
    const before = planSegments(p)[0].cacheKey;
    const scene = p.scenes[0];
    if (scene.multicam) {
      scene.multicam = switchMulticamAngle(scene.multicam, 3000, "a1", "seg-3");
    }
    expect(planSegments(p)[0].cacheKey).not.toBe(before);
  });
});
