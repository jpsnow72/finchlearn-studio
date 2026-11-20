/**
 * dotLottie: reading .lottie files (issue #97, #100).
 *
 * A .lottie file is a zip holding a manifest.json, one JSON per
 * animation under a/, and theme files under t/. This module reads the
 * container with a small central directory parser and inflates deflate
 * entries through DecompressionStream, which ships in the browsers the
 * editor targets, so no zip dependency is added. The inflate step is
 * injectable so tests can drive the same parser with Node's zlib.
 *
 * Extraction picks the manifest's initial animation, which is the
 * animation the pack intends as the default playback.
 */
import {
  parseLottieAnimationData,
  type LottieAnimationData,
} from "./lottieCore";

export interface DotLottieContents {
  animation: LottieAnimationData;
  animationId: string;
  /** Theme rule sets by theme id, when the file carries themes. */
  themes: Record<string, unknown>;
}

export type InflateFn = (data: Uint8Array) => Promise<Uint8Array>;

export async function browserInflate(data: Uint8Array): Promise<Uint8Array> {
  const streamCtor = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!streamCtor) {
    throw new Error(
      "This browser cannot open .lottie files (no DecompressionStream). Import the .json version instead.",
    );
  }
  const stream = new Blob([data.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new streamCtor("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipEntry {
  name: string;
  method: number;
  compressed: Uint8Array;
}

/** Parse a zip's central directory into its entries (still compressed). */
export function parseZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (off: number) => view.getUint16(off, true);
  const u32 = (off: number) => view.getUint32(off, true);
  // End of central directory: scan back from the end for its signature.
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file is not a .lottie zip archive.");
  const count = u16(eocd + 10);
  let off = u32(eocd + 16);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(off) !== 0x02014b50) break;
    const method = u16(off + 10);
    const compressedSize = u32(off + 20);
    const nameLen = u16(off + 28);
    const extraLen = u16(off + 30);
    const commentLen = u16(off + 32);
    const localOff = u32(off + 42);
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    if (u32(localOff) === 0x04034b50) {
      const localNameLen = u16(localOff + 26);
      const localExtraLen = u16(localOff + 28);
      const dataStart = localOff + 30 + localNameLen + localExtraLen;
      entries.push({
        name,
        method,
        compressed: bytes.subarray(dataStart, dataStart + compressedSize),
      });
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function entryText(entry: ZipEntry, inflate: InflateFn): Promise<string> {
  let data: Uint8Array;
  if (entry.method === 0) data = entry.compressed;
  else if (entry.method === 8) data = await inflate(entry.compressed);
  else throw new Error(`Unsupported compression in .lottie file (method ${entry.method}).`);
  return new TextDecoder().decode(data);
}

/** Extract the initial animation and themes from .lottie bytes. */
export async function extractDotLottie(
  bytes: Uint8Array,
  inflate: InflateFn = browserInflate,
): Promise<DotLottieContents> {
  const entries = parseZipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const manifestEntry = byName.get("manifest.json");
  if (!manifestEntry) throw new Error("That .lottie file has no manifest.json.");
  const manifest = JSON.parse(await entryText(manifestEntry, inflate)) as {
    initial?: { animation?: string };
    animations?: { id?: string }[];
  };
  const animationId =
    manifest.initial?.animation ?? manifest.animations?.[0]?.id ?? undefined;
  if (!animationId) throw new Error("That .lottie file lists no animations.");
  const animEntry =
    byName.get(`a/${animationId}.json`) ??
    entries.find((e) => e.name.startsWith("a/") && e.name.endsWith(".json"));
  if (!animEntry) throw new Error(`That .lottie file is missing its animation data (${animationId}).`);
  const animation = parseLottieAnimationData(JSON.parse(await entryText(animEntry, inflate)));
  const themes: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.name.startsWith("t/") && entry.name.endsWith(".json")) {
      try {
        themes[entry.name.slice(2, -5)] = JSON.parse(await entryText(entry, inflate));
      } catch {
        // A broken theme file does not block the animation itself.
      }
    }
  }
  return { animation, animationId, themes };
}

/** True when bytes start with the zip local header signature. */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Load a Lottie animation from raw file bytes: a .lottie container or
 * a plain .json animation document.
 */
export async function loadLottieFromBytes(
  bytes: Uint8Array,
  inflate: InflateFn = browserInflate,
): Promise<LottieAnimationData> {
  if (isZipBytes(bytes)) {
    const { animation } = await extractDotLottie(bytes, inflate);
    return animation;
  }
  const text = new TextDecoder().decode(bytes);
  return parseLottieAnimationData(JSON.parse(text));
}

/** Load a Lottie animation from a JSON text (the .json import path). */
export function loadLottieFromJsonText(text: string): LottieAnimationData {
  return parseLottieAnimationData(JSON.parse(text));
}

const loadCache = new Map<string, Promise<LottieAnimationData>>();

/**
 * Resolve an animation from a source locator: an http(s) or relative
 * URL (a .lottie or .json file), or a data URI carrying either form.
 * Results are cached by locator, so preview and export share one load.
 */
export function loadLottieFromSource(source: string): Promise<LottieAnimationData> {
  const cached = loadCache.get(source);
  if (cached) return cached;
  const promise = (async () => {
    if (source.startsWith("data:")) {
      const comma = source.indexOf(",");
      const meta = source.slice(0, comma);
      const payload = source.slice(comma + 1);
      if (meta.includes(";base64")) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return loadLottieFromBytes(bytes);
      }
      return loadLottieFromJsonText(decodeURIComponent(payload));
    }
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not load the Lottie file (${res.status}).`);
    return loadLottieFromBytes(new Uint8Array(await res.arrayBuffer()));
  })();
  loadCache.set(source, promise);
  promise.catch(() => loadCache.delete(source));
  return promise;
}
