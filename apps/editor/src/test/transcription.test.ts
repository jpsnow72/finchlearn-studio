import { describe, expect, it } from "vitest";
import type { AudioObject, CourseObject } from "@finch-studio/core";
import {
  getObjectTranscript,
  objectTranscriptStatus,
  planObjectTranscription,
  pollTranscription,
  requestTranscription,
  retryObjectTranscription,
  transcriptStatusLabel,
  withObjectTranscript,
  type ClipTranscript,
} from "../transcription";

const NOW = "2026-11-19T18:00:00.000Z";

function audioObject(): AudioObject {
  return { id: "au-1", type: "audio", name: "Voice take", resource: "u/a/p/take1.wav" } as AudioObject;
}

function readyTranscript(overrides: Partial<ClipTranscript> = {}): ClipTranscript {
  return {
    version: 1,
    status: "ready",
    clipId: "au-1",
    contentHash: "hash-aaa",
    engine: "whisper-api",
    words: [{ word: "Hello", startMs: 0, endMs: 400 }],
    segments: [{ id: "seg-0", startMs: 0, endMs: 400, text: "Hello", wordStartIndex: 0, wordEndIndex: 1 }],
    text: "Hello",
    updatedAt: NOW,
    ...overrides,
  };
}

describe("object transcript storage", () => {
  it("round trips through JSON save and load on the object", () => {
    const stored = withObjectTranscript(audioObject(), readyTranscript());
    const revived = JSON.parse(JSON.stringify(stored)) as CourseObject;
    expect(getObjectTranscript(revived)).toEqual(readyTranscript());
    expect(objectTranscriptStatus(revived)).toBe("ready");
    expect(objectTranscriptStatus(audioObject())).toBe("none");
  });

  it("keeps other x-finch-studio metadata when storing a transcript", () => {
    const withMeta = {
      ...audioObject(),
      extensions: { "x-finch-studio": { fadeInMs: 250 } },
    } as AudioObject;
    const stored = withObjectTranscript(withMeta, readyTranscript());
    expect(stored.extensions?.["x-finch-studio"]?.fadeInMs).toBe(250);
    const cleared = withObjectTranscript(stored, null);
    expect(getObjectTranscript(cleared)).toBeNull();
    expect(cleared.extensions?.["x-finch-studio"]?.fadeInMs).toBe(250);
  });
});

describe("editor ingest planning and retry", () => {
  it("queues a new clip and skips an unchanged ready clip", () => {
    const planned = planObjectTranscription(audioObject(), "hash-aaa", NOW);
    expect(planned?.status).toBe("queued");
    const ready = withObjectTranscript(audioObject(), readyTranscript());
    expect(planObjectTranscription(ready, "hash-aaa", NOW)).toBeNull();
    // A changed clip plans a fresh queued record.
    const changed = planObjectTranscription(ready, "hash-bbb", NOW);
    expect(changed?.status).toBe("queued");
    expect(changed?.contentHash).toBe("hash-bbb");
  });

  it("retries only from failed, back to queued for the same hash", () => {
    const failed = withObjectTranscript(
      audioObject(),
      readyTranscript({ status: "failed", error: "engine timeout", words: [], segments: [], text: "" }),
    );
    const retry = retryObjectTranscription(failed, NOW);
    expect(retry?.status).toBe("queued");
    expect(retry?.contentHash).toBe("hash-aaa");
    expect(retry?.attempts).toBe(2);
    expect(retryObjectTranscription(audioObject(), NOW)).toBeNull();
    expect(retryObjectTranscription(withObjectTranscript(audioObject(), readyTranscript()), NOW)).toBeNull();
  });

  it("labels every status in plain copy", () => {
    expect(transcriptStatusLabel("none")).toBe("Not transcribed yet");
    expect(transcriptStatusLabel("transcribing")).toBe("Transcribing");
    expect(transcriptStatusLabel("ready")).toBe("Transcript ready");
    expect(transcriptStatusLabel("failed")).toBe("Transcription failed");
  });
});

describe("finch-asr service client (mocked fetch)", () => {
  it("queues a job with the service key header and polls for the transcript", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return { ok: true, status: 202, json: async () => ({ jobId: "job-1" }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ jobId: "job-1", state: "done", error: null, transcript: readyTranscript() }),
      } as Response;
    }) as typeof fetch;
    const config = { baseUrl: "https://asr.example", key: "test-key-not-a-secret", fetchFn };
    const { jobId } = await requestTranscription(config, {
      clipId: "au-1",
      contentHash: "hash-aaa",
      r2Key: "u/a/p/take1.wav",
    });
    expect(jobId).toBe("job-1");
    expect(calls[0].url).toBe("https://asr.example/jobs");
    expect((calls[0].init?.headers as Record<string, string>)["x-asr-key"]).toBe("test-key-not-a-secret");
    const state = await pollTranscription(config, jobId);
    expect(state.state).toBe("done");
    expect(state.transcript?.words[0].word).toBe("Hello");
  });
});
