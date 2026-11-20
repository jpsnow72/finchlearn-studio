import { describe, expect, it } from "vitest";
import {
  captionCuesFromTranscript,
  fillerWordIndices,
  findTranscriptForClip,
  getAssetTranscript,
  makeQueuedTranscript,
  mapWhisperResponse,
  planTranscription,
  silencesFromTranscript,
  transcriptFromResult,
  transitionTranscript,
  WhisperTranscriptionEngine,
  withAssetTranscript,
  type ClipTranscript,
  type MediaAssetLike,
} from "./transcript.js";
import type { MediaAsset } from "./media.js";

const NOW = "2026-11-19T18:00:00.000Z";

function readyTranscript(overrides: Partial<ClipTranscript> = {}): ClipTranscript {
  return {
    version: 1,
    status: "ready",
    clipId: "clip-1",
    r2Key: "u/a/p/take1.wav",
    contentHash: "hash-aaa",
    engine: "whisper-api",
    language: "en",
    durationMs: 4000,
    words: [
      { word: "Hello", startMs: 0, endMs: 400 },
      { word: "um", startMs: 500, endMs: 700 },
      { word: "world.", startMs: 1800, endMs: 2400 },
      { word: "Welcome", startMs: 2600, endMs: 3100 },
      { word: "back", startMs: 3150, endMs: 3500 },
    ],
    segments: [
      { id: "seg-0", startMs: 0, endMs: 3500, text: "Hello um world. Welcome back", wordStartIndex: 0, wordEndIndex: 5 },
    ],
    text: "Hello um world. Welcome back",
    updatedAt: NOW,
    ...overrides,
  };
}

describe("extension storage round trip", () => {
  it("stores under x-finch-studio and reads back through JSON save/load", () => {
    const asset: MediaAsset = {
      id: "clip-1", source: "user", kind: "audio", name: "Take 1",
      r2Key: "u/a/p/take1.wav", contentHash: "hash-aaa", tags: [],
    };
    const stored = withAssetTranscript(asset, readyTranscript());
    const revived = JSON.parse(JSON.stringify(stored)) as MediaAsset;
    expect(getAssetTranscript(revived)).toEqual(readyTranscript());
    // Other extension metadata survives alongside the transcript.
    const withPeaks = withAssetTranscript(
      { ...asset, extensions: { "x-finch-studio": { waveformPeaks: [0.1, 0.2] } } },
      readyTranscript(),
    );
    expect(withPeaks.extensions?.["x-finch-studio"]?.waveformPeaks).toEqual([0.1, 0.2]);
    expect(getAssetTranscript(withAssetTranscript(asset, null))).toBeNull();
  });

  it("finds a transcript by clipId, then by r2Key", () => {
    const carriers: MediaAssetLike[] = [
      withAssetTranscript(
        { id: "other", source: "user", kind: "audio", name: "x", tags: [] } as MediaAsset,
        readyTranscript({ clipId: "other", r2Key: "u/a/p/other.wav" }),
      ),
      withAssetTranscript(
        { id: "clip-1", source: "user", kind: "audio", name: "y", tags: [] } as MediaAsset,
        readyTranscript(),
      ),
    ];
    expect(findTranscriptForClip(carriers, { clipId: "clip-1" })?.contentHash).toBe("hash-aaa");
    expect(findTranscriptForClip(carriers, { r2Key: "u/a/p/take1.wav" })?.clipId).toBe("clip-1");
    expect(findTranscriptForClip(carriers, { clipId: "missing" })).toBeNull();
  });

  it("rejects malformed stored transcripts", () => {
    const carrier = { extensions: { "x-finch-studio": { transcript: { status: "ready" } } } };
    expect(getAssetTranscript(carrier)).toBeNull();
  });
});

describe("ingest planning (hash based re-run skipping)", () => {
  const clip = { id: "clip-1", kind: "audio" as const, r2Key: "u/a/p/take1.wav", contentHash: "hash-aaa" };

  it("queues a new speech clip", () => {
    const plan = planTranscription(clip, null);
    expect(plan.action).toBe("queue");
    if (plan.action === "queue") expect(plan.job.reason).toBe("new");
  });

  it("skips an unchanged clip whose transcript is ready", () => {
    expect(planTranscription(clip, readyTranscript())).toEqual({ action: "skip", reason: "unchanged" });
  });

  it("re-queues when the content hash changed", () => {
    const plan = planTranscription({ ...clip, contentHash: "hash-bbb" }, readyTranscript());
    expect(plan.action).toBe("queue");
    if (plan.action === "queue") expect(plan.job.reason).toBe("changed");
  });

  it("does not double queue an in-flight clip", () => {
    const queued = makeQueuedTranscript(
      { clipId: "clip-1", contentHash: "hash-aaa", kind: "audio", reason: "new" },
      "whisper-api",
      NOW,
    );
    expect(planTranscription(clip, queued)).toEqual({ action: "skip", reason: "in-flight" });
  });

  it("retries a failed transcript for the same hash", () => {
    const failed = readyTranscript({ status: "failed", error: "engine timeout", words: [], segments: [], text: "" });
    const plan = planTranscription(clip, failed);
    expect(plan.action).toBe("queue");
    if (plan.action === "queue") expect(plan.job.reason).toBe("retry");
  });

  it("skips music, sfx, images, and clips without a hash", () => {
    expect(planTranscription({ ...clip, role: "music" }, null)).toEqual({ action: "skip", reason: "not-speech" });
    expect(planTranscription({ id: "i", kind: "image", contentHash: "h" }, null)).toEqual({ action: "skip", reason: "not-speech" });
    expect(planTranscription({ id: "v", kind: "audio" }, null)).toEqual({ action: "skip", reason: "missing-content-hash" });
    expect(planTranscription({ id: "f", kind: "video", contentHash: "h" }, null).action).toBe("queue");
  });
});

describe("status transitions", () => {
  it("walks queued to transcribing to ready, and failed to queued on retry", () => {
    const queued = makeQueuedTranscript(
      { clipId: "clip-1", contentHash: "hash-aaa", kind: "audio", reason: "new" },
      "whisper-api",
      NOW,
    );
    const running = transitionTranscript(queued, "transcribing", {}, NOW);
    expect(running.status).toBe("transcribing");
    const ready = transitionTranscript(running, "ready", { words: readyTranscript().words }, NOW);
    expect(ready.status).toBe("ready");
    expect(ready.error).toBeUndefined();
    // A ready transcript cannot be sent back to queued in place.
    expect(transitionTranscript(ready, "queued", {}, NOW)).toBe(ready);
    const failed = transitionTranscript(running, "failed", { error: "boom" }, NOW);
    expect(failed.error).toBe("boom");
    expect(transitionTranscript(failed, "queued", {}, NOW).status).toBe("queued");
  });
});

describe("whisper adapter mapping (mocked engine)", () => {
  const raw = {
    language: "en",
    duration: 3.5,
    text: "Hello world.",
    words: [
      { word: "Hello", start: 0, end: 0.4 },
      { word: "world.", start: 1.8, end: 2.4, probability: 0.92 },
    ],
    segments: [{ id: 0, start: 0, end: 2.4, text: " Hello world.", avg_logprob: -0.10536051565782628 }],
  };

  it("maps seconds to ms and carries confidence only where reported", () => {
    const result = mapWhisperResponse(raw);
    expect(result.durationMs).toBe(3500);
    expect(result.words[0]).toEqual({ word: "Hello", startMs: 0, endMs: 400, confidence: undefined });
    expect(result.words[1].confidence).toBeCloseTo(0.92);
    expect(result.segments[0].confidence).toBeCloseTo(0.9, 1);
    expect(result.segments[0].wordStartIndex).toBe(0);
    expect(result.segments[0].wordEndIndex).toBe(2);
    expect(result.text).toBe("Hello world.");
  });

  it("posts verbose_json with word timestamps and maps the reply", async () => {
    const seen: { url: string; init: { method: string; headers: Record<string, string>; body: unknown } | null } = {
      url: "",
      init: null,
    };
    const engine = new WhisperTranscriptionEngine({
      baseUrl: "https://engine.example/v1",
      apiKey: "test-key-not-a-secret",
      fetchFn: async (url, init) => {
        seen.url = url;
        seen.init = init;
        return { ok: true, status: 200, json: async () => raw, text: async () => "" };
      },
    });
    const result = await engine.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      fileName: "take1.wav",
      contentHash: "hash-aaa",
      clipId: "clip-1",
    });
    expect(seen.url).toBe("https://engine.example/v1/audio/transcriptions");
    expect(seen.init?.headers.authorization).toBe("Bearer test-key-not-a-secret");
    const form = seen.init?.body as FormData;
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(result.words).toHaveLength(2);
    const transcript = transcriptFromResult(
      { clipId: "clip-1", contentHash: "hash-aaa", kind: "audio", reason: "new" },
      engine.id,
      result,
      NOW,
    );
    expect(transcript.status).toBe("ready");
    expect(transcript.engine).toBe("whisper-api");
  });

  it("surfaces engine HTTP failures as errors", async () => {
    const engine = new WhisperTranscriptionEngine({
      baseUrl: "https://engine.example/v1",
      apiKey: "test-key-not-a-secret",
      fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => "slow down" }),
    });
    await expect(
      engine.transcribe({ audio: new Uint8Array([1]), fileName: "a.wav", contentHash: "h", clipId: "c" }),
    ).rejects.toThrow(/429/);
  });
});

describe("derived views for captions and rough cut", () => {
  it("builds caption cues that break on sentence ends", () => {
    const cues = captionCuesFromTranscript(readyTranscript(), 8);
    expect(cues[0].text).toBe("Hello um world.");
    expect(cues[0].endMs).toBe(2400);
    expect(cues[1].wordStartIndex).toBe(3);
  });

  it("finds silences at or above the threshold, including the tail", () => {
    const silences = silencesFromTranscript(readyTranscript(), 700);
    expect(silences).toContainEqual({ startMs: 700, endMs: 1800, durationMs: 1100 });
    expect(silences.some((s) => s.startMs === 3500 && s.endMs === 4000)).toBe(false);
    expect(silencesFromTranscript(readyTranscript(), 400).some((s) => s.startMs === 3500)).toBe(true);
  });

  it("flags filler words by index", () => {
    expect(fillerWordIndices(readyTranscript())).toEqual([1]);
  });
});
