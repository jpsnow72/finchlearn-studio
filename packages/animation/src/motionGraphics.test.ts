import { describe, expect, it } from "vitest";
import {
  expandAnimationPreset,
  sampleAnimations,
  type CourseObject,
} from "@finch-studio/core";
import {
  applyKenBurns,
  buildCallout,
  buildLowerThird,
  buildTitleCard,
  effectiveAnimationsForObject,
  expandKineticReveal,
  getMotionMeta,
  isMotionGraphicMeta,
  kineticUnitsAt,
  kineticVisibleText,
  motionGraphicColorsFromTheme,
  motionGraphicGroupOf,
  rebuildMotionGraphic,
  sampleKenBurns,
  splitKineticUnits,
  type MotionGraphicParams,
} from "./motionGraphics.js";

const PARAMS: MotionGraphicParams = {
  text: "Hello world",
  subtext: "A subtitle",
  textColor: "#ffffff",
  accentColor: "#3b82f6",
  backgroundColor: "#1f2937",
  startMs: 1000,
  durationMs: 5000,
  enterMs: 600,
  exitMs: 500,
};

function idFactory() {
  let n = 0;
  return (role: string) => `${role}-${++n}`;
}

function metaOf(object: CourseObject) {
  const meta = getMotionMeta(object);
  if (!isMotionGraphicMeta(meta)) throw new Error("expected motion graphic meta");
  return meta;
}

describe("shared engine preset expansions", () => {
  it("expands Ken Burns to deterministic pan and zoom tracks", () => {
    const expected = [
      { property: "scale", from: 1, to: 1.15, start: 0, duration: 5000, easing: "easeInOut" },
      { property: "x", from: 0, to: -24, start: 0, duration: 5000, easing: "easeInOut" },
      { property: "y", from: 0, to: -12, start: 0, duration: 5000, easing: "easeInOut" },
    ];
    expect(expandAnimationPreset("kenBurns", { start: 0, duration: 5000 })).toEqual(expected);
    expect(expandAnimationPreset("kenBurns", { start: 0, duration: 5000 })).toEqual(
      expandAnimationPreset("kenBurns", { start: 0, duration: 5000 }),
    );
    expect(
      expandAnimationPreset("kenBurns", {
        start: 200,
        duration: 4000,
        kenBurns: { from: { scale: 1.2, x: 10, y: 5 }, to: { scale: 1, x: 0, y: 0 } },
      }),
    ).toEqual([
      { property: "scale", from: 1.2, to: 1, start: 200, duration: 4000, easing: "easeInOut" },
      { property: "x", from: 10, to: 0, start: 200, duration: 4000, easing: "easeInOut" },
      { property: "y", from: 5, to: 0, start: 200, duration: 4000, easing: "easeInOut" },
    ]);
  });

  it("expands the chart stings deterministically", () => {
    expect(expandAnimationPreset("chartStingGrow", { start: 100, duration: 800 })).toEqual([
      { property: "wipeUp", from: 0, to: 1, start: 100, duration: 800 },
      { property: "scale", from: 0.96, to: 1, start: 100, duration: 800 },
    ]);
    expect(expandAnimationPreset("chartStingSweep", { start: 100, duration: 800 })).toEqual([
      { property: "wipeRight", from: 0, to: 1, start: 100, duration: 800 },
      { property: "opacity", from: 0, to: 1, start: 100, duration: 800 },
    ]);
    expect(expandAnimationPreset("chartStingGrow", { start: 100, duration: 800 })).toEqual(
      expandAnimationPreset("chartStingGrow", { start: 100, duration: 800 }),
    );
  });

  it("keeps kinetic reveals out of the transform track engine", () => {
    // Kinetic presets are markers on the object; their expansion is the
    // per-unit reveal schedule below, not transform tracks.
    expect(expandAnimationPreset("typewriterReveal", { start: 0, duration: 2000 })).toEqual([]);
    expect(expandAnimationPreset("wordReveal", { start: 0, duration: 2000 })).toEqual([]);
    expect(expandAnimationPreset("lineReveal", { start: 0, duration: 2000 })).toEqual([]);
  });
});

describe("kinetic text reveals", () => {
  it("splits and reassembles text exactly for every preset", () => {
    const text = "One two\nthree four";
    for (const preset of ["typewriterReveal", "wordReveal", "lineReveal"] as const) {
      expect(splitKineticUnits(text, preset).join("")).toBe(text);
    }
  });

  it("paces a typewriter reveal evenly across its window", () => {
    const units = expandKineticReveal("abcd", "typewriterReveal", { startMs: 0, durationMs: 400 });
    expect(units).toEqual([
      { text: "a", startMs: 0, endMs: 100 },
      { text: "b", startMs: 100, endMs: 200 },
      { text: "c", startMs: 200, endMs: 300 },
      { text: "d", startMs: 300, endMs: 400 },
    ]);
    expect(kineticVisibleText(units, 99)).toBe("a");
    expect(kineticVisibleText(units, 100)).toBe("ab");
    expect(kineticVisibleText(units, 400)).toBe("abcd");
    expect(expandKineticReveal("abcd", "typewriterReveal", { startMs: 0, durationMs: 400 })).toEqual(units);
  });

  it("weights word windows by word length", () => {
    const units = expandKineticReveal("a bb ccc", "wordReveal", { startMs: 0, durationMs: 600 });
    expect(units).toEqual([
      { text: "a ", startMs: 0, endMs: 100 },
      { text: "bb ", startMs: 100, endMs: 300 },
      { text: "ccc", startMs: 300, endMs: 600 },
    ]);
    const states = kineticUnitsAt(units, 150);
    expect(states.map((s) => s.visible)).toEqual([true, true, false]);
    expect(states[1].progress).toBeCloseTo(0.25);
  });

  it("reveals line by line", () => {
    const units = expandKineticReveal("one\ntwo", "lineReveal", { startMs: 0, durationMs: 600 });
    expect(units).toEqual([
      { text: "one", startMs: 0, endMs: 300 },
      { text: "\ntwo", startMs: 300, endMs: 600 },
    ]);
    expect(kineticVisibleText(units, 299)).toBe("one");
    expect(kineticVisibleText(units, 300)).toBe("one\ntwo");
  });

  it("rides real narration word timings when they are provided", () => {
    const wordTimings = [
      { word: "Alpha", startMs: 1000, endMs: 1600 },
      { word: "beta", startMs: 1700, endMs: 2100 },
    ];
    const words = expandKineticReveal("Alpha beta", "wordReveal", {
      startMs: 0,
      durationMs: 9000,
      paceToNarration: true,
      wordTimings,
    });
    expect(words).toEqual([
      { text: "Alpha ", startMs: 1000, endMs: 1600 },
      { text: "beta", startMs: 1700, endMs: 2100 },
    ]);
    expect(kineticVisibleText(words, 1650)).toBe("Alpha ");
    expect(kineticVisibleText(words, 2100)).toBe("Alpha beta");

    const chars = expandKineticReveal("Alpha beta", "typewriterReveal", {
      startMs: 0,
      durationMs: 9000,
      paceToNarration: true,
      wordTimings,
    });
    // Six characters of "Alpha " spread across the first word window,
    // four characters of "beta" across the second.
    expect(chars).toHaveLength(10);
    expect(chars[0]).toEqual({ text: "A", startMs: 1000, endMs: 1100 });
    expect(chars[5]).toEqual({ text: " ", startMs: 1500, endMs: 1600 });
    expect(chars[6]).toEqual({ text: "b", startMs: 1700, endMs: 1800 });
    expect(chars[9]).toEqual({ text: "a", startMs: 2000, endMs: 2100 });
  });

  it("paces against a narration window when no word timings exist", () => {
    const units = expandKineticReveal("aa b", "wordReveal", {
      startMs: 0,
      durationMs: 9000,
      paceToNarration: true,
      narrationWindowMs: { startMs: 2000, endMs: 2600 },
    });
    expect(units).toEqual([
      { text: "aa ", startMs: 2000, endMs: 2400 },
      { text: "b", startMs: 2400, endMs: 2600 },
    ]);
  });

  it("ignores narration pacing data when pacing is off", () => {
    const units = expandKineticReveal("aa b", "wordReveal", {
      startMs: 0,
      durationMs: 300,
      wordTimings: [{ word: "aa", startMs: 5000, endMs: 6000 }],
    });
    expect(units[0].startMs).toBe(0);
    expect(units[units.length - 1].endMs).toBe(300);
  });
});

describe("Ken Burns", () => {
  const framing = {
    from: { scale: 1, x: 0, y: 0 },
    to: { scale: 1.3, x: -40, y: 20 },
  };

  it("interpolates framing at the start, midpoint, and end", () => {
    expect(sampleKenBurns(framing, 1000, 4000, 500)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(sampleKenBurns(framing, 1000, 4000, 1000)).toEqual({ scale: 1, x: 0, y: 0 });
    const mid = sampleKenBurns(framing, 1000, 4000, 3000);
    expect(mid.scale).toBeCloseTo(1.15);
    expect(mid.x).toBeCloseTo(-20);
    expect(mid.y).toBeCloseTo(10);
    expect(sampleKenBurns(framing, 1000, 4000, 5000)).toEqual({ scale: 1.3, x: -40, y: 20 });
    expect(sampleKenBurns(framing, 1000, 4000, 9000)).toEqual({ scale: 1.3, x: -40, y: 20 });
  });

  it("samples identically through the shared renderer path", () => {
    const image = {
      id: "im-1",
      type: "image",
      resource: "r2/example.png",
      timing: { start: 0, duration: 8 },
    } as CourseObject;
    const applied = applyKenBurns(image, framing, 0, 8000);
    const meta = getMotionMeta(applied);
    expect(meta?.kind).toBe("kenBurns");
    expect(applied.animations?.presets).toEqual([{ name: "kenBurns", start: 0, duration: 8000 }]);
    const sampled = sampleAnimations(effectiveAnimationsForObject(applied), 4000);
    const direct = sampleKenBurns(framing, 0, 8000, 4000);
    expect(sampled.scale).toBeCloseTo(direct.scale);
    expect(sampled.x).toBeCloseTo(direct.x);
    expect(sampled.y).toBeCloseTo(direct.y);
    // Objects without Ken Burns metadata pass their animations through.
    expect(effectiveAnimationsForObject(image)).toBe(image.animations);
  });
});

describe("callout composition", () => {
  it("builds an arrow and a label as one group with coordinated phases", () => {
    const objects = buildCallout(
      { ...PARAMS, text: "Look here", startMs: 2000, durationMs: 4000, enterMs: 500, exitMs: 400 },
      idFactory(),
      "group-callout",
    );
    expect(objects).toHaveLength(2);
    const arrow = objects.find((o) => metaOf(o).role === "arrow")!;
    const label = objects.find((o) => metaOf(o).role === "label")!;
    expect(metaOf(arrow).groupId).toBe("group-callout");
    expect(metaOf(label).groupId).toBe("group-callout");
    expect(motionGraphicGroupOf(objects, "group-callout")).toHaveLength(2);
    // Draw on: the arrow wipes in from the start of the window.
    expect(arrow.animations?.presets?.[0]).toEqual({ name: "wipeInRight", start: 2000, duration: 500 });
    expect((arrow as { shape?: string }).shape).toBe("line");
    expect((label as { content?: string }).content).toContain("Look here");
    // Pulse: both members pulse at the same time.
    const arrowPulse = arrow.animations?.presets?.find((p) => p.name === "emphasisPulse");
    const labelPulse = label.animations?.presets?.find((p) => p.name === "emphasisPulse");
    expect(arrowPulse).toEqual({ name: "emphasisPulse", start: 3700, duration: 600 });
    expect(labelPulse).toEqual(arrowPulse);
    // Fade: both end exactly at the end of the window.
    for (const member of [arrow, label]) {
      const fade = member.animations?.presets?.find((p) => p.name === "fadeOut");
      expect(fade).toEqual({ name: "fadeOut", start: 5600, duration: 400 });
      expect(member.timing).toEqual({ start: 2, duration: 4 });
    }
  });
});

describe("title and lower-third parameter editing", () => {
  it("builds a title card deterministically", () => {
    const a = buildTitleCard(PARAMS, idFactory(), "group-title");
    const b = buildTitleCard(PARAMS, idFactory(), "group-title");
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    const text = a.find((o) => metaOf(o).role === "text")!;
    expect((text as { content?: string }).content).toBe("<h1>Hello world</h1>");
    expect(text.animations?.presets).toEqual([
      { name: "slideInUp", start: 1150, duration: 600 },
      { name: "fadeOut", start: 5500, duration: 500 },
    ]);
    expect(text.timing).toEqual({ start: 1, duration: 5 });
  });

  it("applies theme colors automatically with built-in fallbacks", () => {
    expect(motionGraphicColorsFromTheme()).toEqual({
      textColor: "#ffffff",
      accentColor: "#3b82f6",
      backgroundColor: "#1f2937",
    });
    expect(
      motionGraphicColorsFromTheme({ palette: { primary: "#111111", text: "#eeeeee" } }),
    ).toEqual({ textColor: "#eeeeee", accentColor: "#111111", backgroundColor: "#1f2937" });
  });

  it("changes only what the edited parameters drive", () => {
    const built = buildTitleCard(PARAMS, idFactory(), "group-title");
    const positions = built.map((o) => ({ id: o.id, position: o.position }));
    const retitled = rebuildMotionGraphic(built, { ...PARAMS, text: "New title" });
    const newText = retitled.find((o) => metaOf(o).role === "text")!;
    expect((newText as { content?: string }).content).toBe("<h1>New title</h1>");
    // Nothing else moved: same ids, positions, fills, timing, presets.
    expect(retitled.map((o) => ({ id: o.id, position: o.position }))).toEqual(positions);
    for (const member of retitled) {
      const before = built.find((o) => o.id === member.id)!;
      expect(member.timing).toEqual(before.timing);
      expect(member.animations).toEqual(before.animations);
      if (metaOf(member).role !== "text") {
        expect((member as { fill?: string }).fill).toBe((before as { fill?: string }).fill);
        expect((member as { content?: string }).content).toBe(
          (before as { content?: string }).content,
        );
      }
    }

    const recolored = rebuildMotionGraphic(built, {
      ...PARAMS,
      backgroundColor: "#000000",
      startMs: 2000,
      durationMs: 6000,
    });
    const background = recolored.find((o) => metaOf(o).role === "background")!;
    expect((background as { fill?: string }).fill).toBe("#000000");
    expect(background.timing).toEqual({ start: 2, duration: 6 });
    expect(background.animations?.presets?.[0]).toEqual({
      name: "wipeInRight",
      start: 2000,
      duration: 600,
    });
    expect(recolored.map((o) => ({ id: o.id, position: o.position }))).toEqual(positions);
  });

  it("drops and re-adds the optional subtext member with the parameters", () => {
    const built = buildLowerThird(PARAMS, idFactory(), "group-lt");
    expect(built).toHaveLength(4);
    const dropped = rebuildMotionGraphic(built, { ...PARAMS, subtext: "" });
    expect(dropped).toHaveLength(3);
    expect(dropped.some((o) => metaOf(o).role === "subtext")).toBe(false);
    const readded = rebuildMotionGraphic(dropped, PARAMS, idFactory());
    expect(readded).toHaveLength(4);
    const subtext = readded.find((o) => metaOf(o).role === "subtext")!;
    expect((subtext as { content?: string }).content).toBe("<p>A subtitle</p>");
    expect(metaOf(subtext).groupId).toBe("group-lt");
  });

  it("builds a lower third with coordinated slide and fade phases", () => {
    const objects = buildLowerThird(PARAMS, idFactory(), "group-lt");
    const background = objects.find((o) => metaOf(o).role === "background")!;
    expect(background.animations?.presets).toEqual([
      { name: "slideInLeft", start: 1000, duration: 600 },
      { name: "slideOutLeft", start: 5500, duration: 500 },
      { name: "fadeOut", start: 5500, duration: 500 },
    ]);
    const name = objects.find((o) => metaOf(o).role === "text")!;
    expect((name as { content?: string }).content).toBe("<p><strong>Hello world</strong></p>");
  });
});
