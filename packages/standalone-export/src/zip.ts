/**
 * Deterministic ZIP writer and reader (STORE method, no compression).
 *
 * Standalone export packages must be byte for byte reproducible: fixed
 * DOS timestamp (1980-01-01, the earliest the format allows), no extra
 * fields, no archive comment, entries written in caller order. STORE is
 * deliberate: the payloads (MP4, PNG) are already compressed formats, so
 * deflate would buy almost nothing while adding a dependency.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  /** Forward-slash path inside the archive, for example "media/video.mp4". */
  name: string;
  data: Uint8Array;
}

const FIXED_TIME = 0; // 00:00:00
const FIXED_DATE = 0x21; // 1980-01-01

function u16le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}
function u32le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const encoder = new TextEncoder();

export function buildZip(entries: ZipEntryInput[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.includes("\\") || entry.name.startsWith("/")) {
      throw new Error(`Invalid zip entry name "${entry.name}".`);
    }
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const local = concat([
      u32le(0x04034b50), u16le(20), u16le(0x0800), u16le(0),
      u16le(FIXED_TIME), u16le(FIXED_DATE), u32le(crc), u32le(size), u32le(size),
      u16le(nameBytes.length), u16le(0), nameBytes, entry.data,
    ]);
    centralParts.push(concat([
      u32le(0x02014b50), u16le(20), u16le(20), u16le(0x0800), u16le(0),
      u16le(FIXED_TIME), u16le(FIXED_DATE), u32le(crc), u32le(size), u32le(size),
      u16le(nameBytes.length), u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(0), u32le(offset), nameBytes,
    ]));
    localParts.push(local);
    offset += local.length;
  }
  const central = concat(centralParts);
  const end = concat([
    u32le(0x06054b50), u16le(0), u16le(0), u16le(entries.length),
    u16le(entries.length), u32le(central.length), u32le(offset), u16le(0),
  ]);
  return concat([...localParts, central, end]);
}

export interface ZipEntry extends ZipEntryInput {
  crc32: number;
}

function readU16(data: Uint8Array, at: number): number {
  return data[at] | (data[at + 1] << 8);
}
function readU32(data: Uint8Array, at: number): number {
  return (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24)) >>> 0;
}

/** Parse a zip produced by buildZip (STORE entries) back into its entries. */
export function readZip(data: Uint8Array): ZipEntry[] {
  // Locate the end of central directory record.
  let eocd = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (readU32(data, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file: end of central directory not found.");
  const count = readU16(data, eocd + 10);
  let at = readU32(data, eocd + 16);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (readU32(data, at) !== 0x02014b50) throw new Error("Corrupt zip: bad central directory entry.");
    const method = readU16(data, at + 10);
    if (method !== 0) throw new Error(`Unsupported zip method ${method}; only STORE is supported.`);
    const crc = readU32(data, at + 16);
    const size = readU32(data, at + 20);
    const nameLen = readU16(data, at + 28);
    const extraLen = readU16(data, at + 30);
    const commentLen = readU16(data, at + 32);
    const localOffset = readU32(data, at + 42);
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = readU16(data, localOffset + 26);
    const localExtraLen = readU16(data, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const bytes = data.slice(dataStart, dataStart + size);
    if (crc32(bytes) !== crc) throw new Error(`Corrupt zip: CRC mismatch for "${name}".`);
    entries.push({ name, data: bytes, crc32: crc });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
