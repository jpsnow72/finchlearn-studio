import { describe, expect, it } from "vitest";
import type { TextObject, VideoProject, VideoScene } from "@finch-studio/core";
import {
  contrastRatio,
  effectiveTextBackground,
  parseColor,
  runPreflight,
} from "../accessibility";

function scene(partial: Partial<VideoScene> & { objects: VideoScene["objects"] }): VideoScene {
  return {
    id: partial.id ?? "scene-1",
    name: partial.name ?? "Scene 1",
    durationMs: 5000,
    transition: "cut",
    ...partial,
  };
}

function textObject(partial: Partial<TextObject> & { content: string }): TextObject {
  return {
    id: partial.id ?? "text-1",
    type: "text",
    name: "Caption text",
    position: { x: 100, y: 100, w: 400, h: 80 },
    ...partial,
  };
}

function project(scenes: VideoScene[]): VideoProject {
  return { id: "p", name: "Lesson", scenes };
}

describe("colour math", () => {
  it("parses hex and rgb colours and computes WCAG ratios", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgb(26, 26, 26)")).toEqual({ r: 26, g: 26, b: 26, a: 1 });
    expect(parseColor("not-a-color")).toBeNull();
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The classic failing pair: light grey on white is well under AA.
    expect(contrastRatio("#aaaaaa", "#ffffff")!).toBeLessThan(4.5);
  });
});

describe("508 pre-flight", () => {
  it("passes a clean project", () => {
    const p = project([
      scene({
        background: "#ffffff",
        objects: [
          textObject({ content: "<p>Clear dark text on white</p>" }),
          textObject({
            id: "big",
            content: '<h1 style="color:#595959">Large heading</h1>',
          }),
        ],
      }),
    ]);
    const report = runPreflight(p);
    expect(report.pass).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.byScene).toHaveLength(1);
  });

  it("catches a planted contrast violation and reports the measured ratio", () => {
    const p = project([
      scene({
        background: "#ffffff",
        objects: [
          textObject({
            content: '<p style="color:#aaaaaa">Hard to read</p>',
          }),
        ],
      }),
    ]);
    const report = runPreflight(p);
    expect(report.pass).toBe(false);
    const finding = report.findings.find((f) => f.kind === "contrast");
    expect(finding).toMatchObject({ sceneId: "scene-1", objectId: "text-1" });
    expect(Number(finding!.detail.ratio)).toBeLessThan(4.5);
    expect(finding!.message).toContain("Hard to read");
    expect(finding!.message).not.toContain("—");
  });

  it("uses the shape under the text as the effective background", () => {
    const shape = {
      id: "card",
      type: "shape" as const,
      shape: "rect" as const,
      fill: "#111111",
      position: { x: 50, y: 50, w: 500, h: 200 },
    };
    const lightText = textObject({
      content: '<p style="color:#eeeeee">Light on dark card</p>',
    });
    const s = scene({ background: "#ffffff", objects: [shape, lightText] });
    expect(effectiveTextBackground(s, lightText)).toBe("#111111");
    // Light text on the dark card passes; the same text would fail on white.
    expect(runPreflight(project([s])).pass).toBe(true);
    const bare = scene({ background: "#ffffff", objects: [lightText] });
    expect(runPreflight(project([bare])).findings.map((f) => f.kind)).toContain("contrast");
  });

  it("catches a planted below minimum font size, from inline style and from metadata", () => {
    const p = project([
      scene({
        objects: [
          textObject({ id: "tiny-inline", content: '<p style="font-size:8px">Tiny</p>' }),
          textObject({
            id: "tiny-meta",
            content: "<p>Also tiny</p>",
            extensions: { "x-finch-studio": { fontSizePx: 9 } },
          }),
          textObject({ id: "fine", content: "<p>Normal size</p>" }),
        ],
      }),
    ]);
    const report = runPreflight(p);
    const fontFindings = report.findings.filter((f) => f.kind === "font-size");
    expect(fontFindings.map((f) => f.objectId).sort()).toEqual(["tiny-inline", "tiny-meta"]);
    expect(fontFindings[0].detail.minFontSizePx).toBe(12);
  });

  it("catches planted rapid flashing from opacity tracks and from presets", () => {
    const strobe = textObject({ id: "strobe", content: "<p>Flashing</p>" });
    strobe.animations = {
      timeline: Array.from({ length: 6 }, (_, i) => ({
        property: "opacity" as const,
        from: i % 2 === 0 ? 0 : 1,
        to: i % 2 === 0 ? 1 : 0,
        start: i * 120,
        duration: 120,
      })),
    };
    const presetStrobe = textObject({ id: "preset-strobe", content: "<p>Preset flash</p>" });
    presetStrobe.animations = {
      presets: Array.from({ length: 5 }, (_, i) => ({
        name: (i % 2 === 0 ? "fadeIn" : "fadeOut") as "fadeIn" | "fadeOut",
        start: i * 150,
        duration: 150,
      })),
    };
    const calm = textObject({ id: "calm", content: "<p>Calm</p>" });
    calm.animations = { presets: [{ name: "fadeIn", start: 0, duration: 600 }] };

    const report = runPreflight(project([scene({ objects: [strobe, presetStrobe, calm] })]));
    const flash = report.findings.filter((f) => f.kind === "flash");
    expect(flash.map((f) => f.objectId).sort()).toEqual(["preset-strobe", "strobe"]);
    expect(Number(flash[0].detail.flashesInOneSecond)).toBeGreaterThan(3);
  });

  it("groups findings per scene in export order for jump to scene", () => {
    const p = project([
      scene({ id: "s1", name: "Intro", objects: [textObject({ content: "<p>Fine</p>" })] }),
      scene({
        id: "s2",
        name: "Details",
        objects: [textObject({ id: "bad", content: '<p style="font-size:7px">Small</p>' })],
      }),
    ]);
    const report = runPreflight(p);
    expect(report.byScene.map((s) => s.sceneId)).toEqual(["s1", "s2"]);
    expect(report.byScene[0].findings).toEqual([]);
    expect(report.byScene[1].findings).toHaveLength(1);
    expect(report.byScene[1].findings[0]).toMatchObject({ sceneName: "Details", kind: "font-size" });
  });

  it("does not flag hidden objects or empty text", () => {
    const hidden = textObject({ content: '<p style="font-size:6px;color:#aaaaaa">Hidden</p>' });
    hidden.visible = false;
    const empty = textObject({ id: "empty", content: "<p>  </p>" });
    const report = runPreflight(project([scene({ objects: [hidden, empty] })]));
    expect(report.pass).toBe(true);
  });
});
