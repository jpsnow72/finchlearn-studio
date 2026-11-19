import { describe, expect, it } from "vitest";
import { computePeaks } from "./media.js";
import {
  canRetryIngestJob,
  createIngestJob,
  derivedIngestKey,
  getStoredIngest,
  ingestJobId,
  peaksBucketCount,
  peaksToAmplitudes,
  planIngestRequest,
  resolveExportSource,
  resolvePreviewSource,
  transitionIngestJob,
  validateIngestOutputs,
  withIngestRecord,
  MAX_INGEST_ATTEMPTS,
  type IngestJob,
  type IngestOutputs,
} from "./ingest.js";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);
const NOW = "2026-11-19T12:00:00.000Z";

const videoInput = {
  sourceR2Key: "u/user1/take1.mp4",
  contentHash: HASH,
  kind: "video" as const,
  width: 1920,
  height: 1080,
  durationMs: 60_000,
};

function videoOutputs(job: IngestJob): IngestOutputs {
  const frames = Array.from({ length: job.plan.thumbnailStrip.count }, (_, i) => i * 5000);
  const peaks = computePeaks(new Float32Array([0, 0.5, -0.25, 1, 0, -0.5, 0.25, 0]), 4);
  return {
    proxy: { r2Key: derivedIngestKey(HASH, "proxy-720p.mp4"), label: "720p", width: 1280, height: 720, codec: "h264", container: "mp4" },
    peaks: { version: 1, buckets: peaks.length, bucketMs: 15_000, peaks },
    thumbnails: { stripR2Key: derivedIngestKey(HASH, "thumbs-strip.jpg"), frameWidth: 320, frameAtMs: frames },
  };
}

function doneVideoJob(): IngestJob {
  const job = createIngestJob(videoInput, NOW);
  const running = transitionIngestJob(job, { type: "start" }, NOW);
  return transitionIngestJob(running, { type: "complete", outputs: videoOutputs(running) }, NOW);
}

describe("job identity and dedupe by content hash", () => {
  it("derives the job id from the content hash only", () => {
    expect(ingestJobId(HASH)).toBe(`ingest-${HASH.slice(0, 32)}`);
    expect(createIngestJob(videoInput, NOW).id).toBe(ingestJobId(HASH));
    expect(createIngestJob({ ...videoInput, sourceR2Key: "u/other/copy.mp4" }, NOW).id).toBe(ingestJobId(HASH));
    expect(ingestJobId(HASH2)).not.toBe(ingestJobId(HASH));
  });

  it("derives storage keys from the hash, sharded by prefix", () => {
    expect(derivedIngestKey(HASH, "proxy-720p.mp4")).toBe(`derived/aa/${HASH}/proxy-720p.mp4`);
    expect(derivedIngestKey(HASH, "peaks.json")).toBe(`derived/aa/${HASH}/peaks.json`);
    expect(derivedIngestKey(HASH, "thumbs-strip.jpg")).toBe(`derived/aa/${HASH}/thumbs-strip.jpg`);
  });

  it("rejects a job without a source key or a real hash", () => {
    expect(() => createIngestJob({ ...videoInput, sourceR2Key: "" }, NOW)).toThrow(/source R2 key/);
    expect(() => createIngestJob({ ...videoInput, contentHash: "not-a-hash" }, NOW)).toThrow(/content hash/);
  });

  it("reuses a done job for the same hash instead of re-running", () => {
    const done = doneVideoJob();
    const decision = planIngestRequest(done, videoInput, NOW);
    expect(decision.action).toBe("reuse");
    expect(decision.job).toBe(done);
  });

  it("attaches to a queued or running job for the same hash", () => {
    const queued = createIngestJob(videoInput, NOW);
    expect(planIngestRequest(queued, videoInput, NOW).action).toBe("attach");
    const running = transitionIngestJob(queued, { type: "start" }, NOW);
    expect(planIngestRequest(running, videoInput, NOW).action).toBe("attach");
  });

  it("creates a fresh job when there is no record or the hash changed", () => {
    expect(planIngestRequest(null, videoInput, NOW).action).toBe("create");
    const other = createIngestJob({ ...videoInput, contentHash: HASH2 }, NOW);
    expect(planIngestRequest(other, videoInput, NOW).action).toBe("create");
  });
});

describe("lifecycle transitions", () => {
  it("walks queued to running to done, stamping attempts and outputs", () => {
    const job = createIngestJob(videoInput, NOW);
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    const running = transitionIngestJob(job, { type: "start" }, NOW);
    expect(running.status).toBe("running");
    expect(running.attempts).toBe(1);
    const done = transitionIngestJob(running, { type: "complete", outputs: videoOutputs(running) }, NOW);
    expect(done.status).toBe("done");
    expect(done.outputs?.proxy?.label).toBe("720p");
    expect(done.error).toBeUndefined();
    // The original job object is untouched (pure transitions).
    expect(job.status).toBe("queued");
  });

  it("rejects illegal transitions", () => {
    const job = createIngestJob(videoInput, NOW);
    expect(() => transitionIngestJob(job, { type: "complete", outputs: {} })).toThrow(/cannot complete/);
    expect(() => transitionIngestJob(job, { type: "fail", error: "x" })).toThrow(/cannot fail/);
    expect(() => transitionIngestJob(job, { type: "retry" })).toThrow(/cannot retry/);
    const done = doneVideoJob();
    expect(() => transitionIngestJob(done, { type: "start" })).toThrow(/cannot start/);
  });

  it("fails, retries up to the cap, then refuses", () => {
    let job = createIngestJob(videoInput, NOW);
    for (let attempt = 1; attempt <= MAX_INGEST_ATTEMPTS; attempt++) {
      job = transitionIngestJob(job, { type: "start" }, NOW);
      job = transitionIngestJob(job, { type: "fail", error: "ffmpeg exited 1" }, NOW);
      expect(job.status).toBe("failed");
      expect(job.error).toBe("ffmpeg exited 1");
      if (attempt < MAX_INGEST_ATTEMPTS) {
        expect(canRetryIngestJob(job)).toBe(true);
        job = transitionIngestJob(job, { type: "retry" }, NOW);
        expect(job.status).toBe("queued");
        expect(job.error).toBeUndefined();
      }
    }
    expect(canRetryIngestJob(job)).toBe(false);
    expect(() => transitionIngestJob(job, { type: "retry" })).toThrow(/exhausted/);
    // An exhausted job is not silently retried by a fresh ingest request.
    expect(planIngestRequest(job, videoInput, NOW).action).toBe("create");
  });

  it("a retryable failed job is retried by a fresh ingest request", () => {
    const queued = createIngestJob(videoInput, NOW);
    const failed = transitionIngestJob(
      transitionIngestJob(queued, { type: "start" }, NOW),
      { type: "fail", error: "boom" },
      NOW,
    );
    const decision = planIngestRequest(failed, videoInput, NOW);
    expect(decision.action).toBe("retry");
    expect(decision.job.status).toBe("queued");
  });
});

describe("output manifest shape", () => {
  it("accepts the full video manifest", () => {
    const job = createIngestJob(videoInput, NOW);
    expect(() => validateIngestOutputs(job, videoOutputs(job))).not.toThrow();
  });

  it("rejects a video manifest with no proxy, no strip, or a wrong frame count", () => {
    const job = createIngestJob(videoInput, NOW);
    const good = videoOutputs(job);
    expect(() => validateIngestOutputs(job, { ...good, proxy: undefined })).toThrow(/proxy/);
    expect(() => validateIngestOutputs(job, { ...good, thumbnails: undefined })).toThrow(/thumbnail/);
    expect(() =>
      validateIngestOutputs(job, { ...good, thumbnails: { ...good.thumbnails!, frameAtMs: [0] } }),
    ).toThrow(/frame count/);
  });

  it("rejects peaks that are not the canonical normalized pairs", () => {
    const job = createIngestJob(videoInput, NOW);
    const good = videoOutputs(job);
    expect(() =>
      validateIngestOutputs(job, { ...good, peaks: { version: 1, buckets: 1, peaks: [{ min: 0, max: 2 }] } }),
    ).toThrow(/normalized/);
    expect(() =>
      validateIngestOutputs(job, { ...good, peaks: { version: 1, buckets: 9, peaks: [{ min: 0, max: 0.5 }] } }),
    ).toThrow(/bucket count/);
  });

  it("audio jobs produce peaks only, image jobs a single thumbnail only", () => {
    const audio = createIngestJob({ sourceR2Key: "u/u1/voice.wav", contentHash: HASH, kind: "audio", durationMs: 5000 }, NOW);
    const peaks = computePeaks(new Float32Array([0.2, -0.4, 0.1]), 3);
    expect(() => validateIngestOutputs(audio, { peaks: { version: 1, buckets: 3, peaks } })).not.toThrow();
    expect(() =>
      validateIngestOutputs(audio, {
        peaks: { version: 1, buckets: 3, peaks },
        proxy: { r2Key: "x", label: "720p", width: 1280, codec: "h264", container: "mp4" },
      }),
    ).toThrow(/must not produce a proxy/);

    const image = createIngestJob({ sourceR2Key: "u/u1/pic.png", contentHash: HASH, kind: "image" }, NOW);
    expect(() =>
      validateIngestOutputs(image, { thumbnails: { stripR2Key: "s", frameWidth: 480, frameAtMs: [0] } }),
    ).not.toThrow();
  });
});

describe("peaks contract (shared with ASR and silence consumers)", () => {
  it("carries computePeaks pairs verbatim and derives amplitudes from them", () => {
    const peaks = computePeaks(new Float32Array([0, 0.5, -0.25, 1, 0, -0.5, 0.25, 0]), 4);
    const done = doneVideoJob();
    expect(done.outputs?.peaks?.peaks).toEqual(peaks);
    expect(peaksToAmplitudes(peaks)).toEqual(peaks.map((p) => Math.max(Math.abs(p.min), Math.abs(p.max))));
    expect(Math.max(...peaksToAmplitudes(peaks))).toBeCloseTo(1);
  });

  it("sizes buckets at about one per 100 ms, clamped", () => {
    expect(peaksBucketCount(60_000)).toBe(600);
    expect(peaksBucketCount(500)).toBe(20);
    expect(peaksBucketCount(undefined)).toBe(100);
  });
});

describe("proxy versus original selection", () => {
  const done = doneVideoJob();
  const asset = {
    original: "https://media.example/u/user1/take1.mp4",
    ingestOutputs: done.outputs,
    proxyUrl: "https://media.example/derived/proxy.mp4",
  };

  it("preview prefers the proxy once the job is done", () => {
    expect(resolvePreviewSource(asset)).toEqual({ url: asset.proxyUrl, isProxy: true });
  });

  it("preview falls back to the original before the job is done", () => {
    expect(resolvePreviewSource({ original: asset.original })).toEqual({ url: asset.original, isProxy: false });
    expect(resolvePreviewSource({ ...asset, proxyUrl: null })).toEqual({ url: asset.original, isProxy: false });
  });

  it("export always resolves the original, never the proxy", () => {
    expect(resolveExportSource(asset)).toBe(asset.original);
  });

  it("export refuses rather than silently using the proxy", () => {
    expect(() => resolveExportSource({ original: "", ingestOutputs: done.outputs, proxyUrl: asset.proxyUrl })).toThrow(
      /never used for export/,
    );
  });
});

describe("stamping outputs onto an asset", () => {
  it("stamps the ingest record and the editor amplitude slot, preserving siblings", () => {
    const done = doneVideoJob();
    const asset = {
      id: "a1",
      extensions: { "x-finch-studio": { transcript: { status: "ready" }, fadeInMs: 100 } },
    };
    const stamped = withIngestRecord(asset, done);
    const record = getStoredIngest(stamped);
    expect(record?.status).toBe("done");
    expect(record?.contentHash).toBe(HASH);
    expect(record?.outputs?.proxy?.label).toBe("720p");
    const ext = stamped.extensions["x-finch-studio"]!;
    expect(ext.transcript).toEqual({ status: "ready" });
    expect(ext.fadeInMs).toBe(100);
    expect((ext as { waveformPeaks?: number[] }).waveformPeaks).toEqual(peaksToAmplitudes(done.outputs!.peaks!.peaks));
    // The source asset is not mutated.
    expect(getStoredIngest(asset)).toBeNull();
  });
});
