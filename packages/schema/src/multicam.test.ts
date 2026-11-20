import { describe, expect, it } from "vitest";
import {
  MAX_MULTICAM_ANGLES,
  addMulticamAngle,
  applyMulticamSync,
  createMulticamGroup,
  effectiveAngleOffsetMs,
  nudgeMulticamAngle,
  resolveMulticamAngle,
  switchMulticamAngle,
  validateMulticamGroup,
  type MulticamGroup,
} from "./multicam.js";
import { makeStudioProject, validateStudioProject } from "./schema.js";
import { studioToOCF, ocfToStudio } from "./ocfMapping.js";

function group(durationMs = 10000): MulticamGroup {
  const g = createMulticamGroup({
    id: "group-1",
    segmentId: "seg-1",
    durationMs,
    angles: [
      { id: "a1", label: "Wide", sourceId: "el-wide" },
      { id: "a2", label: "Close", sourceId: "el-close" },
      { id: "a3", label: "Side", sourceId: "el-side" },
    ],
  });
  if (!g) throw new Error("group should build");
  return g;
}

describe("createMulticamGroup", () => {
  it("starts with one full scene segment on the reference angle", () => {
    const g = group();
    expect(g.referenceAngleId).toBe("a1");
    expect(g.segments).toEqual([{ id: "seg-1", startMs: 0, endMs: 10000, angleId: "a1" }]);
    expect(g.angles.every((a) => a.syncOffsetMs === 0 && a.manualNudgeMs === 0)).toBe(true);
  });

  it("enforces the three angle cap at creation", () => {
    expect(MAX_MULTICAM_ANGLES).toBe(3);
    const four = createMulticamGroup({
      durationMs: 5000,
      angles: [1, 2, 3, 4].map((n) => ({ id: `a${n}`, label: `A${n}`, sourceId: `el-${n}` })),
    });
    expect(four).toBeNull();
    expect(createMulticamGroup({ durationMs: 5000, angles: [] })).toBeNull();
  });

  it("rejects a repeated footage source", () => {
    const dup = createMulticamGroup({
      durationMs: 5000,
      angles: [
        { id: "a1", label: "One", sourceId: "el-1" },
        { id: "a2", label: "Two", sourceId: "el-1" },
      ],
    });
    expect(dup).toBeNull();
  });
});

describe("addMulticamAngle", () => {
  it("adds up to the cap and then refuses with a reason", () => {
    const two = createMulticamGroup({
      id: "g",
      durationMs: 5000,
      angles: [
        { id: "a1", label: "Wide", sourceId: "el-1" },
        { id: "a2", label: "Close", sourceId: "el-2" },
      ],
    });
    if (!two) throw new Error("group should build");
    const added = addMulticamAngle(two, { id: "a3", label: "Side", sourceId: "el-3" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.group.angles).toHaveLength(3);
    const refused = addMulticamAngle(added.group, { id: "a4", label: "Extra", sourceId: "el-4" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("at most 3");
    // The original group is untouched (pure).
    expect(two.angles).toHaveLength(2);
  });
});

describe("resolveMulticamAngle", () => {
  it("resolves the angle and source time at a timestamp", () => {
    const g = switchMulticamAngle(group(), 4000, "a2", "seg-2");
    const before = resolveMulticamAngle(g, 3999);
    const at = resolveMulticamAngle(g, 4000);
    expect(before?.angle.id).toBe("a1");
    expect(at?.angle.id).toBe("a2");
    expect(at?.sourceMs).toBe(4000);
  });

  it("applies sync offset plus manual nudge to the source time", () => {
    const synced = applyMulticamSync(group(), [
      { angleId: "a2", offsetMs: 240, confidence: 0.9, quality: "high" },
    ]);
    const nudged = nudgeMulticamAngle(synced, "a2", -40);
    const angle = nudged.angles.find((a) => a.id === "a2");
    expect(angle && effectiveAngleOffsetMs(angle)).toBe(200);
    const cut = switchMulticamAngle(nudged, 1000, "a2", "seg-9");
    expect(resolveMulticamAngle(cut, 1500)?.sourceMs).toBe(1700);
  });

  it("never blanks: times after the last segment keep the last angle", () => {
    const g = group(8000);
    expect(resolveMulticamAngle(g, 99999)?.angle.id).toBe("a1");
    expect(resolveMulticamAngle(group(), -50)?.angle.id).toBe("a1");
  });
});

describe("switchMulticamAngle", () => {
  it("splits the covering segment and keeps later cuts intact", () => {
    let g = switchMulticamAngle(group(), 2000, "a2", "seg-2");
    g = switchMulticamAngle(g, 6000, "a3", "seg-3");
    expect(g.segments.map((s) => [s.startMs, s.endMs, s.angleId])).toEqual([
      [0, 2000, "a1"],
      [2000, 6000, "a2"],
      [6000, 10000, "a3"],
    ]);
    // Switching inside the middle segment only changes that stretch.
    g = switchMulticamAngle(g, 3000, "a1", "seg-4");
    expect(resolveMulticamAngle(g, 2500)?.angle.id).toBe("a2");
    expect(resolveMulticamAngle(g, 3500)?.angle.id).toBe("a1");
    expect(resolveMulticamAngle(g, 5500)?.angle.id).toBe("a1");
    expect(resolveMulticamAngle(g, 7000)?.angle.id).toBe("a3");
  });

  it("switching to the angle already on screen is a no-op", () => {
    const g = group();
    expect(switchMulticamAngle(g, 1000, "a1", "seg-x")).toBe(g);
    expect(switchMulticamAngle(g, 1000, "missing", "seg-x")).toBe(g);
  });

  it("does not mutate the input group", () => {
    const g = group();
    switchMulticamAngle(g, 1000, "a2", "seg-2");
    expect(g.segments).toHaveLength(1);
  });
});

describe("applyMulticamSync", () => {
  it("records offsets and honest quality, keeps nudges and the reference", () => {
    const nudged = nudgeMulticamAngle(group(), "a2", 30);
    const synced = applyMulticamSync(nudged, [
      { angleId: "a2", offsetMs: 120, confidence: 0.42, quality: "low" },
      { angleId: "a1", offsetMs: 999, confidence: 1, quality: "high" },
    ]);
    const a2 = synced.angles.find((a) => a.id === "a2");
    expect(a2?.syncOffsetMs).toBe(120);
    expect(a2?.syncQuality).toBe("low");
    expect(a2?.syncConfidence).toBeCloseTo(0.42);
    expect(a2?.manualNudgeMs).toBe(30);
    expect(synced.angles.find((a) => a.id === "a1")?.syncOffsetMs).toBe(0);
  });
});

describe("validation and schema integration", () => {
  it("flags over-cap groups and segments pointing at unknown angles", () => {
    const g = group();
    const bad: MulticamGroup = {
      ...g,
      angles: [...g.angles, { id: "a4", label: "Extra", sourceId: "el-4", syncOffsetMs: 0, manualNudgeMs: 0 }],
      segments: [{ id: "s", startMs: 0, endMs: 100, angleId: "nope" }],
    };
    const problems = validateMulticamGroup(bad, 10000);
    expect(problems.some((p) => p.includes("maximum is 3"))).toBe(true);
    expect(problems.some((p) => p.includes("unknown angle"))).toBe(true);
  });

  it("a scene without multicam validates exactly as before", () => {
    const p = makeStudioProject("Plain");
    expect(validateStudioProject(p)).toEqual([]);
  });

  it("a scene with a valid group validates, and a dangling source fails", () => {
    const p = makeStudioProject("Multi");
    const s = p.scenes[0];
    s.elements.push(
      { kind: "footage", id: "el-wide", startMs: 0, durationMs: 5000, asset: { r2Key: "u/a/w.mp4", kind: "video" }, sourceInMs: 0, sourceOutMs: 5000, speed: 1, volume: 1 },
      { kind: "footage", id: "el-close", startMs: 0, durationMs: 5000, asset: { r2Key: "u/a/c.mp4", kind: "video" }, sourceInMs: 0, sourceOutMs: 5000, speed: 1, volume: 1 },
    );
    s.multicam = createMulticamGroup({
      id: "g",
      durationMs: s.durationMs,
      angles: [
        { id: "a1", label: "Wide", sourceId: "el-wide" },
        { id: "a2", label: "Close", sourceId: "el-close" },
      ],
    }) ?? undefined;
    expect(validateStudioProject(p)).toEqual([]);
    if (s.multicam) s.multicam.angles[1].sourceId = "el-missing";
    expect(validateStudioProject(p).some((x) => x.includes("missing element"))).toBe(true);
  });

  it("round trips through the OCF sidecar losslessly", () => {
    const p = makeStudioProject("Multi");
    const s = p.scenes[0];
    s.multicam = switchMulticamAngle(group(s.durationMs), 2000, "a2", "seg-2");
    const { project, sidecar } = studioToOCF(p);
    const back = ocfToStudio(project, sidecar);
    expect(back.scenes[0].multicam).toEqual(s.multicam);
  });
});
