import { describe, expect, it } from "vitest";
import {
  clipGainAt,
  dbToGain,
  descriptionActivityAt,
  type AudioClip,
} from "./audio.js";
import {
  descriptionCues,
  encodeWav,
  formatDescriptionVtt,
  planAudioExport,
  type PcmBufferLike,
} from "./description.js";

const voice: AudioClip = {
  id: "v", assetR2Key: "a/v.mp3", role: "voice",
  startMs: 0, durationMs: 10000, sourceInMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0,
};
const music: AudioClip = {
  id: "m", assetR2Key: "a/m.mp3", role: "music",
  startMs: 0, durationMs: 10000, sourceInMs: 0, gain: 0.8, fadeInMs: 0, fadeOutMs: 0,
};
const description: AudioClip = {
  id: "ad", assetR2Key: "a/ad.mp3", role: "description",
  startMs: 2000, durationMs: 2000, sourceInMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0,
  descriptionText: "Maya enters and waves at the camera.",
};
const description2: AudioClip = {
  ...description,
  id: "ad2",
  startMs: 6000,
  descriptionText: "A chart shows sales rising.",
};

describe("audio description ducking (mixed mode)", () => {
  it("primary voice ducks under the description track", () => {
    const g = clipGainAt(voice, [voice, description], 3000);
    expect(g).toBeCloseTo(dbToGain(-12), 3);
  });
  it("primary voice is unducked outside the description span", () => {
    expect(clipGainAt(voice, [voice, description], 8000)).toBeCloseTo(1, 3);
  });
  it("music ducks under the description track too", () => {
    expect(clipGainAt(music, [music, description], 3000)).toBeCloseTo(0.8 * dbToGain(-12), 3);
  });
  it("the description track itself is never ducked", () => {
    expect(clipGainAt(description, [voice, description], 3000)).toBeCloseTo(1, 3);
    expect(descriptionActivityAt([voice, description], 3000, { duckDb: 12, attackMs: 120, releaseMs: 350 })).toBe(1);
    expect(descriptionActivityAt([voice], 3000, { duckDb: 12, attackMs: 120, releaseMs: 350 })).toBe(0);
  });
});

describe("audio description export plan", () => {
  it("mixed mode keeps the description clips in the main mix with no secondary track", () => {
    const plan = planAudioExport([voice, music, description], "mixed");
    expect(plan.hasDescription).toBe(true);
    expect(plan.mixedClips.map((c) => c.id)).toEqual(["v", "m", "ad"]);
    expect(plan.secondaryClips).toEqual([]);
    expect(plan.descriptionVtt).toBeNull();
  });

  it("secondary mode removes the description from the main mix and returns it as its own track", () => {
    const plan = planAudioExport([voice, music, description, description2], "secondary");
    expect(plan.mixedClips.map((c) => c.id)).toEqual(["v", "m"]);
    expect(plan.secondaryClips.map((c) => c.id)).toEqual(["ad", "ad2"]);
    expect(plan.descriptionCues).toEqual([
      { clipId: "ad", startMs: 2000, endMs: 4000, text: "Maya enters and waves at the camera." },
      { clipId: "ad2", startMs: 6000, endMs: 8000, text: "A chart shows sales rising." },
    ]);
  });

  it("a project with no description track plans cleanly in both modes", () => {
    for (const mode of ["mixed", "secondary"] as const) {
      const plan = planAudioExport([voice, music], mode);
      expect(plan.hasDescription).toBe(false);
      expect(plan.secondaryClips).toEqual([]);
      expect(plan.descriptionVtt).toBeNull();
      expect(plan.mixedClips.map((c) => c.id)).toEqual(["v", "m"]);
    }
  });

  it("renders the description VTT with project timeline timestamps", () => {
    expect(formatDescriptionVtt([description2, description])).toBe(
      "WEBVTT\n\n" +
        "1\n00:00:02.000 --> 00:00:04.000\nMaya enters and waves at the camera.\n\n" +
        "2\n00:00:06.000 --> 00:00:08.000\nA chart shows sales rising.\n",
    );
    expect(descriptionCues([{ ...description, descriptionText: "  " }])).toEqual([]);
  });
});

describe("secondary track WAV encoding", () => {
  it("writes a valid 16-bit PCM WAV header and interleaved samples", () => {
    const fake: PcmBufferLike = {
      numberOfChannels: 2,
      sampleRate: 48000,
      length: 2,
      getChannelData: (ch) =>
        ch === 0 ? new Float32Array([0, 0.5]) : new Float32Array([0, -0.5]),
    };
    const wav = encodeWav(fake);
    expect(wav.length).toBe(44 + 2 * 2 * 2);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(48, true)).toBeGreaterThan(16000);
    expect(view.getInt16(50, true)).toBeLessThan(-16000);
  });
});
