import { describe, expect, it } from "vitest";
import { wavDurationSec } from "../narration";

function makeWav(seconds: number, sampleRate = 24000): Uint8Array {
  const dataBytes = Math.floor(seconds * sampleRate) * 2; // 16-bit mono
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // data
  view.setUint32(40, dataBytes, true);
  return bytes;
}

describe("wavDurationSec", () => {
  it("measures a PCM WAV from its header", () => {
    expect(wavDurationSec(makeWav(2))).toBeCloseTo(2, 3);
    expect(wavDurationSec(makeWav(0.5))).toBeCloseTo(0.5, 3);
  });
  it("returns null for non-WAV bytes", () => {
    expect(wavDurationSec(new Uint8Array(100))).toBeNull();
    expect(wavDurationSec(new Uint8Array(10))).toBeNull();
  });
});
