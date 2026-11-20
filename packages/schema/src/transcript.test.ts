import { describe, expect, it } from "vitest";
import {
  findProjectTranscript,
  getAssetTranscript,
  makeStudioProject,
  validateStudioProject,
  withAssetTranscript,
  type ClipTranscript,
  type StudioProject,
} from "./schema.js";
import { ocfToStudio, studioToOCF } from "./ocfMapping.js";

function sampleTranscript(overrides: Partial<ClipTranscript> = {}): ClipTranscript {
  return {
    version: 1,
    status: "ready",
    clipId: "el-voice",
    r2Key: "u/a/p/take1.wav",
    contentHash: "sha-aaa",
    engine: "whisper-api",
    language: "en",
    durationMs: 3000,
    words: [
      { word: "Hello", startMs: 0, endMs: 400, confidence: 0.98 },
      { word: "world", startMs: 500, endMs: 1000 },
    ],
    segments: [
      { id: "seg-0", startMs: 0, endMs: 1000, text: "Hello world", wordStartIndex: 0, wordEndIndex: 2 },
    ],
    text: "Hello world",
    updatedAt: "2026-11-19T18:00:00.000Z",
    ...overrides,
  };
}

function projectWithTranscript(): StudioProject {
  const p = makeStudioProject("ASR demo");
  const scene = p.scenes[0];
  scene.elements.push({
    kind: "audio", id: "el-voice", startMs: 0, durationMs: 3000, volume: 1, role: "voice",
    asset: withAssetTranscript(
      { r2Key: "u/a/p/take1.wav", kind: "audio", sha256: "sha-aaa", durationMs: 3000 },
      sampleTranscript(),
    ),
  });
  scene.elements.push({
    kind: "footage", id: "el-cam", startMs: 0, durationMs: 5000,
    asset: { r2Key: "u/a/p/cam.mp4", kind: "video" },
    sourceInMs: 0, sourceOutMs: 5000, speed: 1, volume: 1,
  });
  return p;
}

describe("ASR transcript model (#43)", () => {
  it("round trips through project JSON save and load", () => {
    const p = projectWithTranscript();
    const revived = JSON.parse(JSON.stringify(p)) as StudioProject;
    const el = revived.scenes[0].elements[0];
    if (el.kind !== "audio") throw new Error("expected audio element");
    expect(getAssetTranscript(el.asset)).toEqual(sampleTranscript());
    expect(validateStudioProject(revived)).toEqual([]);
  });

  it("round trips losslessly through the OCF sidecar", () => {
    const p = projectWithTranscript();
    const { project, sidecar } = studioToOCF(p);
    const back = ocfToStudio(project, sidecar);
    expect(back).toEqual(p);
    expect(findProjectTranscript(back, { clipId: "el-voice" })?.text).toBe("Hello world");
  });

  it("finds transcripts by element id and by r2Key, and misses cleanly", () => {
    const p = projectWithTranscript();
    expect(findProjectTranscript(p, { clipId: "el-voice" })?.contentHash).toBe("sha-aaa");
    expect(findProjectTranscript(p, { r2Key: "u/a/p/take1.wav" })?.clipId).toBe("el-voice");
    expect(findProjectTranscript(p, { clipId: "el-cam" })).toBeNull();
    expect(findProjectTranscript(p, { r2Key: "u/a/p/nope.wav" })).toBeNull();
  });

  it("clears a transcript without disturbing other extension metadata", () => {
    const asset = withAssetTranscript(
      { r2Key: "u/a/p/take1.wav", kind: "audio", extensions: { "x-finch-studio": { waveformPeaks: [0.5] } } },
      sampleTranscript(),
    );
    const cleared = withAssetTranscript(asset, null);
    expect(getAssetTranscript(cleared)).toBeNull();
    expect(cleared.extensions?.["x-finch-studio"]?.waveformPeaks).toEqual([0.5]);
  });

  it("validates word timing order and confidence range in transcripts", () => {
    const p = projectWithTranscript();
    const el = p.scenes[0].elements[0];
    if (el.kind !== "audio") throw new Error("expected audio element");
    el.asset = withAssetTranscript(
      el.asset,
      sampleTranscript({ words: [{ word: "bad", startMs: 900, endMs: 100, confidence: 1.4 }] }),
    );
    const problems = validateStudioProject(p);
    expect(problems.some((x) => x.includes("ending before it starts"))).toBe(true);
    expect(problems.some((x) => x.includes("confidence outside"))).toBe(true);
  });
});
