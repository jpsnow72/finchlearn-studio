import { describe, expect, it } from "vitest";
import { computePeaks, derivedIngestKey } from "@finch-studio/media";
import {
  exportSourceFor,
  fetchIngestJobState,
  pollIngestJob,
  previewSourceFor,
  requestIngestJob,
  stampIngestState,
  type IngestFetch,
} from "../ingestClient";

const HASH = "c".repeat(64);

const input = {
  sourceR2Key: "u/user1/take1.mp4",
  sourceUrl: "https://media.example/signed/take1.mp4",
  contentHash: HASH,
  kind: "video" as const,
  width: 1920,
  durationMs: 60_000,
};

const peaks = computePeaks(new Float32Array([0, 0.5, -0.25, 1]), 4);
const outputs = {
  proxy: { r2Key: derivedIngestKey(HASH, "proxy-720p.mp4"), label: "720p" as const, width: 1280, codec: "h264" as const, container: "mp4" as const },
  peaks: { version: 1 as const, buckets: peaks.length, peaks },
  thumbnails: { stripR2Key: derivedIngestKey(HASH, "thumbs-strip.jpg"), frameWidth: 320, frameAtMs: [2500, 7500] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ingest client", () => {
  it("no-ops when the ingest service is not configured in this build", async () => {
    // Vitest runs without VITE_INGEST_URL / VITE_INGEST_KEY.
    await expect(requestIngestJob(input)).resolves.toBeNull();
  });

  it("polls a job to done and returns its outputs", async () => {
    const states = [
      { status: "queued", attempts: 0, error: null, outputs: null },
      { status: "running", attempts: 1, error: null, outputs: null },
      { status: "done", attempts: 1, error: null, outputs },
    ];
    let call = 0;
    const fetchFn: IngestFetch = async () => jsonResponse(states[Math.min(call++, states.length - 1)]);
    const final = await pollIngestJob({ jobId: "ingest-x", token: "t", deduped: false }, { fetchFn, intervalMs: 0 });
    expect(final.status).toBe("done");
    expect(final.outputs?.proxy?.label).toBe("720p");
  });

  it("returns a failed state instead of throwing, so callers can offer retry", async () => {
    const fetchFn: IngestFetch = async () =>
      jsonResponse({ status: "failed", attempts: 3, error: "ffmpeg exited 1", outputs: null });
    const final = await pollIngestJob({ jobId: "ingest-x", token: "t", deduped: false }, { fetchFn, intervalMs: 0 });
    expect(final.status).toBe("failed");
    expect(final.error).toBe("ffmpeg exited 1");
  });

  it("reads job state with the job token", async () => {
    let seenUrl = "";
    let seenToken: string | null = null;
    const fetchFn: IngestFetch = async (url, init) => {
      seenUrl = url;
      seenToken = new Headers(init?.headers).get("x-ingest-token");
      return jsonResponse({ status: "running", attempts: 1, error: null, outputs: null });
    };
    const state = await fetchIngestJobState({ jobId: "ingest-abc", token: "sek", deduped: false }, fetchFn);
    expect(state.status).toBe("running");
    expect(seenUrl).toContain("/jobs/ingest-abc");
    expect(seenToken).toBe("sek");
  });
});

describe("editor source selection", () => {
  const sources = {
    originalUrl: "https://media.example/u/user1/take1.mp4",
    proxyUrl: "https://media.example/derived/proxy.mp4",
    ingestOutputs: outputs,
  };

  it("preview prefers the proxy, export takes the original", () => {
    expect(previewSourceFor(sources)).toEqual({ url: sources.proxyUrl, isProxy: true });
    expect(exportSourceFor(sources)).toBe(sources.originalUrl);
  });

  it("preview uses the original until outputs exist", () => {
    expect(previewSourceFor({ originalUrl: sources.originalUrl })).toEqual({
      url: sources.originalUrl,
      isProxy: false,
    });
  });
});

describe("stamping ingest state onto an asset", () => {
  it("stamps the record and refreshes the waveform peaks slot", () => {
    const asset = { id: "a1", extensions: { "x-finch-studio": { fadeInMs: 50 } } };
    const stamped = stampIngestState(asset, input, { status: "done", attempts: 1, error: null, outputs });
    const ext = stamped.extensions["x-finch-studio"]! as { fadeInMs: number; ingest?: unknown; waveformPeaks?: number[] };
    const ingest = ext.ingest as { status: string; contentHash: string };
    expect(ingest.status).toBe("done");
    expect(ingest.contentHash).toBe(HASH);
    expect(ext.fadeInMs).toBe(50);
    expect(ext.waveformPeaks).toEqual(outputs.peaks.peaks.map((p) => Math.max(Math.abs(p.min), Math.abs(p.max))));
  });
});
