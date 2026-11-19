import { describe, expect, it } from "vitest";
import {
  alignAudioEnergy,
  alignAudioPeaks,
  alignManyAudioEnergy,
  peaksToEnergy,
} from "./multicamSync.js";

/** Deterministic pseudo random series (mulberry32) so tests never flake. */
function series(length: number, seed: number): number[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length }, () => next());
}

/** Candidate whose events happen `delay` buckets later than the reference. */
function delayed(reference: number[], delay: number): number[] {
  const out = new Array<number>(reference.length).fill(0);
  for (let i = 0; i < reference.length; i++) {
    const j = i + delay;
    if (j >= 0 && j < out.length) out[j] = reference[i];
  }
  return out;
}

describe("peaksToEnergy", () => {
  it("uses magnitudes and peak pair maxima", () => {
    expect(peaksToEnergy([0.5, -0.25, { min: -0.8, max: 0.3 }])).toEqual([0.5, 0.25, 0.8]);
  });
});

describe("alignAudioEnergy", () => {
  it("recovers a positive delay and reports high quality", () => {
    const reference = series(120, 42);
    const candidate = delayed(reference, 7);
    const r = alignAudioEnergy(reference, candidate, { bucketMs: 50 });
    expect(r.lagBuckets).toBe(7);
    expect(r.offsetMs).toBe(350);
    expect(r.correlation).toBeGreaterThan(0.99);
    expect(r.confidence).toBeGreaterThan(0.75);
    expect(r.quality).toBe("high");
  });

  it("recovers a candidate that started early (negative delay)", () => {
    const reference = series(120, 7);
    const candidate = delayed(reference, -5);
    const r = alignAudioEnergy(reference, candidate, { bucketMs: 40 });
    expect(r.lagBuckets).toBe(-5);
    expect(r.offsetMs).toBe(-200);
    expect(r.quality).toBe("high");
  });

  it("identical series align at zero", () => {
    const reference = series(80, 99);
    const r = alignAudioEnergy(reference, [...reference], { bucketMs: 100 });
    expect(r.offsetMs).toBe(0);
    expect(r.correlation).toBeCloseTo(1);
  });

  it("unrelated series report low confidence, never a confident offset", () => {
    const r = alignAudioEnergy(series(120, 1), series(120, 2), { bucketMs: 100 });
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.quality).not.toBe("high");
  });

  it("silence and flat energy are honestly unknown", () => {
    const flat = new Array<number>(60).fill(0.4);
    const r = alignAudioEnergy(flat, series(60, 3));
    expect(r.quality).toBe("unknown");
    expect(r.confidence).toBe(0);
    expect(r.offsetMs).toBe(0);
    const silent = alignAudioEnergy(new Array<number>(60).fill(0), series(60, 3));
    expect(silent.quality).toBe("unknown");
  });

  it("too little data is unknown rather than a guess", () => {
    const r = alignAudioEnergy([0.1, 0.9, 0.2], [0.1, 0.9, 0.2]);
    expect(r.quality).toBe("unknown");
  });

  it("respects the max offset search window", () => {
    const reference = series(120, 5);
    const candidate = delayed(reference, 30);
    const r = alignAudioEnergy(reference, candidate, { bucketMs: 100, maxOffsetMs: 1000 });
    expect(Math.abs(r.lagBuckets)).toBeLessThanOrEqual(10);
  });

  it("aligns ingest peaks in either stored shape", () => {
    const energy = series(100, 11);
    const refPeaks = energy.map((v) => ({ min: -v, max: v }));
    const candPeaks = delayed(energy, 4).map((v) => ({ min: -v, max: v }));
    const r = alignAudioPeaks(refPeaks, candPeaks, { bucketMs: 25 });
    expect(r.offsetMs).toBe(100);
    expect(r.quality).toBe("high");
  });

  it("aligns many candidates against one reference in order", () => {
    const reference = series(100, 21);
    const results = alignManyAudioEnergy(
      reference,
      [delayed(reference, 3), delayed(reference, -2)],
      { bucketMs: 10 },
    );
    expect(results.map((r) => r.lagBuckets)).toEqual([3, -2]);
  });
});
