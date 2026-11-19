import { describe, expect, it } from "vitest";
import { clipGainAt, dbToGain, DEFAULT_DUCKING, voiceActivityAt, type AudioClip } from "./audio.js";

const voice: AudioClip = { id: "v", assetR2Key: "a/v.mp3", role: "voice", startMs: 1000, durationMs: 2000, sourceInMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0 };
const music: AudioClip = { id: "m", assetR2Key: "a/m.mp3", role: "music", startMs: 0, durationMs: 10000, sourceInMs: 0, gain: 0.8, fadeInMs: 0, fadeOutMs: 0 };

describe("ducking", () => {
  it("music sits under voice by the duck amount", () => {
    const g = clipGainAt(music, [voice, music], 2000);
    expect(g).toBeCloseTo(0.8 * dbToGain(-12), 3);
  });
  it("music is unducked away from voice", () => {
    expect(clipGainAt(music, [voice, music], 8000)).toBeCloseTo(0.8, 3);
  });
  it("voice itself is never ducked", () => {
    expect(clipGainAt(voice, [voice, music], 2000)).toBeCloseTo(1, 3);
  });
  it("activity ramps down on release", () => {
    const a = voiceActivityAt([voice], 3000 + DEFAULT_DUCKING.releaseMs / 2, DEFAULT_DUCKING);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});

describe("envelope and fades", () => {
  it("manual envelope nodes override gain", () => {
    const c: AudioClip = { ...music, envelope: [{ atMs: 0, gain: 1 }, { atMs: 5000, gain: 0.2 }] };
    expect(clipGainAt(c, [c], 2500)).toBeCloseTo(0.8 * 0.6, 3);
  });
  it("fade in starts at zero", () => {
    const c: AudioClip = { ...music, fadeInMs: 1000 };
    expect(clipGainAt(c, [c], 0)).toBeCloseTo(0, 3);
    expect(clipGainAt(c, [c], 1000)).toBeCloseTo(0.8, 3);
  });
});
