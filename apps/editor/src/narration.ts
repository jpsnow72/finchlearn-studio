/**
 * narration.ts — production narration for Studio (issue: TTS wiring).
 *
 * Same stack as the FinchLearn course editor, no new services:
 *  - Kokoro (basic): POST https://finch-narration.jpsnow72.workers.dev/generate
 *    {text, voiceId} -> WAV bytes. No client key (the Worker injects its
 *    own service key), works signed in or out.
 *  - Google (premium): the ai-generate edge function's synthesize arm via
 *    the editor's Supabase session -> {audioBase64} MP3. Needs sign-in;
 *    without a session it fails with a clear "sign in" message.
 *
 * Generated audio is cached in IndexedDB keyed by sha256(text|voiceId),
 * so a line is generated once and reused by playback AND export. Cache
 * entries hold the blob + measured duration; line durations in the
 * project are updated to the real audio length after generation.
 */
import { voiceById } from "@finch-studio/audio";
import { supabase, supabaseEnabled } from "./supabase";

export const FINCH_NARRATION_URL = "https://finch-narration.jpsnow72.workers.dev";

/**
 * Shared app key the narration Worker requires (x-narration-app-key) —
 * the same client-shipped key the FinchLearn app sends from its own
 * VITE_NARRATION_APP_KEY. It gates casual abuse alongside the Worker's
 * origin allowlist; it is not a private credential.
 */
const NARRATION_APP_KEY = (import.meta.env.VITE_NARRATION_APP_KEY as string | undefined) ?? "";

export interface LineAudio {
  blob: Blob;
  durationSec: number;
}

const DB_NAME = "finch-studio-narration";
const STORE = "line-audio";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<LineAudio | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as LineAudio | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(key: string, value: LineAudio): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch {
    // Cache is an optimisation; generation still returns the audio.
  }
}

export async function narrationKey(text: string, voiceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${voiceId}|${text}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Duration of a WAV blob from its own header (Kokoro returns PCM WAV). */
export function wavDurationSec(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!(bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)) return null;
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (!channels || !sampleRate || !bitsPerSample) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
    const size = view.getUint32(offset + 4, true);
    if (tag === "data") {
      const dataBytes = Math.min(size, bytes.length - (offset + 8));
      return dataBytes / (sampleRate * channels * (bitsPerSample / 8));
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function decodeDuration(blob: Blob): Promise<number> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
  } finally {
    void ctx.close();
  }
}

async function generateKokoro(text: string, voiceId: string): Promise<LineAudio> {
  let res: Response;
  try {
    res = await fetch(`${FINCH_NARRATION_URL}/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(NARRATION_APP_KEY ? { "x-narration-app-key": NARRATION_APP_KEY } : {}),
      },
      body: JSON.stringify({ text, voiceId }),
    });
  } catch {
    throw new Error("The narration service could not be reached. Check your connection and try again.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: string; error?: string };
      detail = body.detail ?? body.error ?? "";
    } catch {
      // keep the status-based message
    }
    throw new Error(`Narration service unavailable (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
  const headerSec = wavDurationSec(bytes);
  return { blob, durationSec: headerSec ?? (await decodeDuration(blob)) };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateGoogle(text: string, voiceId: string): Promise<LineAudio> {
  if (!supabaseEnabled || !supabase) {
    throw new Error("Premium voices need you to sign in with your FinchLearn account first.");
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("Premium voices need you to sign in with your FinchLearn account first.");
  }
  const languageCode = voiceId.split("-").slice(0, 2).join("-");
  const { data, error } = await supabase.functions.invoke("ai-generate", {
    body: {
      action: "synthesize",
      idempotencyKey: `studio-tts-${crypto.randomUUID()}`,
      text,
      voiceId,
      languageCode,
    },
  });
  if (error) {
    let message = error.message ?? "Voice service error";
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<{ error?: string }> }; json?: () => Promise<{ error?: string }> } }).context;
      const resp = ctx?.clone ? ctx.clone() : ctx;
      const parsed = await resp?.json?.();
      if (parsed?.error) message = parsed.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  const rec = data as { audioBase64?: string } | null;
  if (!rec?.audioBase64) throw new Error("The voice service returned no audio. Try again.");
  const bytes = base64ToBytes(rec.audioBase64);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" });
  return { blob, durationSec: await decodeDuration(blob) };
}

/** Generate (or fetch from cache) the audio for one line. */
export async function ensureLineAudio(text: string, voiceId: string): Promise<LineAudio> {
  const key = await narrationKey(text, voiceId);
  const cached = await idbGet(key);
  if (cached) return cached;
  const voice = voiceById(voiceId);
  if (!voice) throw new Error(`Unknown voice: ${voiceId}`);
  const made = voice.engine === "google" ? await generateGoogle(text, voiceId) : await generateKokoro(text, voiceId);
  await idbPut(key, made);
  return made;
}

export async function cachedLineAudio(text: string, voiceId: string): Promise<LineAudio | undefined> {
  return idbGet(await narrationKey(text, voiceId));
}

export async function hasCachedLineAudio(text: string, voiceId: string): Promise<boolean> {
  return (await cachedLineAudio(text, voiceId)) !== undefined;
}

const urlCache = new Map<string, string>();

/** Object URL for playback of a line's audio (generating if needed). */
export async function lineAudioUrl(text: string, voiceId: string): Promise<string> {
  const key = await narrationKey(text, voiceId);
  const hit = urlCache.get(key);
  if (hit) return hit;
  const { blob } = await ensureLineAudio(text, voiceId);
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}
