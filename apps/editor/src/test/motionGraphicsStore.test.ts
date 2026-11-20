/**
 * Motion graphics store flow (issues #98 and #99): inserting a built
 * group and re-applying edited parameters through replaceObjectGroup.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildTitleCard,
  getMotionMeta,
  isMotionGraphicMeta,
  motionGraphicGroupOf,
  rebuildMotionGraphic,
  type MotionGraphicParams,
} from "@finch-studio/animation";
import { useStudioStore } from "../store.js";

beforeEach(() => {
  useStudioStore.getState().newProject();
});

const PARAMS: MotionGraphicParams = {
  text: "Quarterly results",
  subtext: "What changed",
  textColor: "#ffffff",
  accentColor: "#3b82f6",
  backgroundColor: "#1f2937",
  startMs: 0,
  durationMs: 5000,
  enterMs: 600,
  exitMs: 500,
};

describe("motion graphic groups in the store", () => {
  it("inserts a title card group and re-applies edited parameters in place", () => {
    const store = useStudioStore.getState();
    const starterCount = store.project.scenes[0].objects.length;
    store.insertObjectGroup(buildTitleCard(PARAMS, (role) => `test-${role}`, "test-group"));

    let scene = useStudioStore.getState().project.scenes[0];
    const group = motionGraphicGroupOf(scene.objects, "test-group");
    expect(group).toHaveLength(4);
    expect(scene.objects.length).toBe(starterCount + 4);
    const groupIds = group.map((object) => object.id);

    const edited = rebuildMotionGraphic(group, { ...PARAMS, text: "Annual results" });
    useStudioStore.getState().replaceObjectGroup(groupIds, edited);

    scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.length).toBe(starterCount + 4);
    const after = motionGraphicGroupOf(scene.objects, "test-group");
    expect(after.map((object) => object.id)).toEqual(groupIds);
    const title = after.find((object) => {
      const meta = getMotionMeta(object);
      return isMotionGraphicMeta(meta) && meta.role === "text";
    })!;
    expect((title as { content?: string }).content).toBe("<h1>Annual results</h1>");
    // The group stays contiguous where it was inserted.
    const firstIndex = scene.objects.findIndex((object) => object.id === groupIds[0]);
    expect(scene.objects.slice(firstIndex, firstIndex + 4).map((o) => o.id)).toEqual(groupIds);
  });
});
