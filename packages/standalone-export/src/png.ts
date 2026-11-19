/**
 * Minimal PNG inspection: signature, IHDR dimensions, and chunk CRCs.
 * Used to validate scene frames before they are packaged, and by tests
 * to prove exported PNGs are real PNGs of the expected dimensions.
 */
import { crc32 } from "./zip.js";

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

function readU32be(data: Uint8Array, at: number): number {
  return ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
}

export function isPng(data: Uint8Array): boolean {
  return data.length >= 8 && PNG_SIGNATURE.every((b, i) => data[i] === b);
}

/** Parse and CRC-check the IHDR chunk. Throws on anything malformed. */
export function pngInfo(data: Uint8Array): PngInfo {
  if (!isPng(data)) throw new Error("Not a PNG file: bad signature.");
  if (data.length < 33) throw new Error("Not a PNG file: truncated before IHDR completes.");
  const ihdrLen = readU32be(data, 8);
  const type = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (type !== "IHDR" || ihdrLen !== 13) throw new Error("Not a PNG file: first chunk is not IHDR.");
  const storedCrc = readU32be(data, 29);
  if (crc32(data.subarray(12, 29)) !== storedCrc) throw new Error("Corrupt PNG: IHDR CRC mismatch.");
  return {
    width: readU32be(data, 16),
    height: readU32be(data, 20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

/** Dimensions for a project aspect at a given long edge (PNG scene export). */
export function dimensionsForAspect(
  aspect: "16:9" | "9:16" | "1:1",
  longEdge = 1280,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  switch (aspect) {
    case "9:16":
      return { width: even((longEdge * 9) / 16), height: longEdge };
    case "1:1":
      return { width: longEdge, height: longEdge };
    default:
      return { width: longEdge, height: even((longEdge * 9) / 16) };
  }
}
