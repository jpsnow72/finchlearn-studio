import { describe, expect, it } from "vitest";
import type { AudioClip } from "./audio.js";
import {
  DEFAULT_SILENCE_OPTIONS,
  detectSilences,
  mapTightenedTime,
  normalizeSilenceOptions,
  planSilenceTightening,
  tightenAudioClip,
} from "./silence.js";

/** 10 buckets over 1000 ms: speech, 400 ms silence, speech, 300 ms silence. */
const peaks = [0.9, 0.8, 0.02, 0.01, 0.03, 0.02, 0.7, 0.01, 0.02, 0.01];

describe("silence detection on synthetic peaks", () => {
  it("finds runs at or below the threshold that reach the minimum length", () => {
    expect(detectSilences(peaks, 1000, { minSilenceMs: 300 })).toEqual([
      { startMs: 200, endMs: 600, durationMs: 400 },
      { startMs: 700, endMs: 1000, durationMs: 300 },
    ]);
    // The 300 ms trailing run drops out when the minimum is 400 ms.
    expect(detectSilences(peaks, 1000)).toEqual([
      { startMs: 200, endMs: 600, durationMs: 400 },
    ]);
  });

  it("respects an adjustable threshold", () => {
    // At a 0.5 threshold the quiet 0.03 buckets still count as silence,
    // but nothing new joins; at 0.005 nothing counts as silence.
    expect(detectSilences(peaks, 1000, { threshold: 0.005 })).toEqual([]);
    expect(
      detectSilences([0.4, 0.4, 0.9], 300, { threshold: 0.5, minSilenceMs: 100 }),
    ).toEqual([{ startMs: 0, endMs: 200, durationMs: 200 }]);
    expect(detectSilences([0.4, 0.4, 0.9], 300, { minSilenceMs: 100 })).toEqual([]);
  });

  it("accepts min and max peak pairs from media ingest", () => {
    const pairs = [
      { min: -0.9, max: 0.8 },
      { min: -0.01, max: 0.02 },
      { min: -0.02, max: 0.01 },
      { min: -0.7, max: 0.9 },
    ];
    expect(detectSilences(pairs, 400, { minSilenceMs: 200 })).toEqual([
      { startMs: 100, endMs: 300, durationMs: 200 },
    ]);
  });

  it("handles edge cases without inventing gaps", () => {
    expect(detectSilences([], 1000)).toEqual([]);
    expect(detectSilences(peaks, 0)).toEqual([]);
    expect(detectSilences([0.9, 0.8], 200)).toEqual([]);
    // A single silent bucket shorter than the minimum is not a gap.
    expect(detectSilences([0.01], 100)).toEqual([]);
    // An all silent clip is one gap spanning the whole clip.
    expect(detectSilences([0, 0.01, 0], 900, { minSilenceMs: 400 })).toEqual([
      { startMs: 0, endMs: 900, durationMs: 900 },
    ]);
  });

  it("clamps out of range options to the supported ranges", () => {
    expect(normalizeSilenceOptions({ threshold: 4, minSilenceMs: -5, keepPauseMs: -1 })).toEqual({
      threshold: 1,
      minSilenceMs: 0,
      keepPauseMs: 0,
    });
    expect(normalizeSilenceOptions()).toEqual(DEFAULT_SILENCE_OPTIONS);
  });
});

describe("tightening plan and time saved", () => {
  it("shortens gaps to the kept pause instead of deleting them", () => {
    const plan = planSilenceTightening(peaks, 1000, {
      minSilenceMs: 300,
      keepPauseMs: 100,
    });
    expect(plan.cuts).toEqual([
      { startMs: 300, endMs: 600, durationMs: 300 },
      { startMs: 800, endMs: 1000, durationMs: 200 },
    ]);
    expect(plan.totalRemovedMs).toBe(500);
    expect(plan.originalDurationMs).toBe(1000);
    expect(plan.tightenedDurationMs).toBe(500);
    expect(plan.keptSegments).toEqual([
      { sourceStartMs: 0, durationMs: 300, startMs: 0 },
      { sourceStartMs: 600, durationMs: 200, startMs: 300 },
    ]);
  });

  it("saves nothing when gaps already fit the kept pause", () => {
    const plan = planSilenceTightening(peaks, 1000, {
      minSilenceMs: 300,
      keepPauseMs: 500,
    });
    expect(plan.cuts).toEqual([]);
    expect(plan.totalRemovedMs).toBe(0);
    expect(plan.tightenedDurationMs).toBe(1000);
  });

  it("maps source times onto the tightened timeline", () => {
    const plan = planSilenceTightening(peaks, 1000, {
      minSilenceMs: 300,
      keepPauseMs: 100,
    });
    expect(mapTightenedTime(0, plan)).toBe(0);
    expect(mapTightenedTime(300, plan)).toBe(300);
    // Inside the first cut, time pins to the cut start.
    expect(mapTightenedTime(450, plan)).toBe(300);
    // Speech after the first cut shifts earlier by the removed 300 ms.
    expect(mapTightenedTime(650, plan)).toBe(350);
    expect(mapTightenedTime(1000, plan)).toBe(500);
  });
});

describe("applying tightening to the shared clip model", () => {
  const clip: AudioClip = {
    id: "voice-1",
    assetR2Key: "u/project/take.wav",
    role: "voice",
    startMs: 2000,
    durationMs: 1000,
    sourceInMs: 500,
    gain: 0.9,
    fadeInMs: 80,
    fadeOutMs: 120,
    envelope: [
      { atMs: 100, gain: 1 },
      { atMs: 450, gain: 0.5 },
      { atMs: 650, gain: 0.8 },
    ],
  };

  it("splits into kept segments with source offsets and remapped envelope", () => {
    const out = tightenAudioClip(clip, peaks, { minSilenceMs: 300, keepPauseMs: 100 });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: "voice-1",
      startMs: 2000,
      durationMs: 300,
      sourceInMs: 500,
      fadeInMs: 80,
      fadeOutMs: 0,
      envelope: [{ atMs: 100, gain: 1 }],
    });
    expect(out[1]).toMatchObject({
      id: "voice-1-tight-1",
      startMs: 2300,
      durationMs: 200,
      sourceInMs: 1100,
      fadeInMs: 0,
      fadeOutMs: 120,
      envelope: [{ atMs: 50, gain: 0.8 }],
    });
    // Total tightened length matches the plan, so preview and export agree.
    expect(out.reduce((sum, c) => sum + c.durationMs, 0)).toBe(500);
  });

  it("returns the clip untouched when there is nothing to tighten", () => {
    const out = tightenAudioClip(clip, [0.9, 0.8, 0.7]);
    expect(out).toEqual([clip]);
    expect(out[0]).toBe(clip);
  });
});
