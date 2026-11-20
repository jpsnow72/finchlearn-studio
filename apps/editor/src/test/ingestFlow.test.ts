import { describe, expect, it } from "vitest";
import { computePeaks, derivedIngestKey } from "@finch-studio/media";
import type { CourseObject } from "@finch-studio/core";
import { ingestVideoObjectByUrl, type UrlIngestDeps } from "../ingestFlow";
import type { IngestJobHandle, IngestJobState } from "../ingestClient";

const HASH = "c".repeat(64);
const URL = "https://cdn.example/media/clip.mp4";

const peaks = computePeaks(new Float32Array([0, 0.5, -0.25, 1]), 4);
const outputs = {
  proxy: { r2Key: derivedIngestKey(HASH, "proxy-720p.mp4"), label: "720p" as const, width: 1280, codec: "h264" as const, container: "mp4" as const },
  peaks: { version: 1 as const, buckets: peaks.length, peaks },
  thumbnails: { stripR2Key: derivedIngestKey(HASH, "thumbs-strip.jpg"), frameWidth: 320, frameAtMs: [2500, 7500] },
};

function videoObject(): CourseObject {
  return {
    id: "vd-test",
    type: "video",
    name: "clip.mp4",
    resource: URL,
  } as unknown as CourseObject;
}

interface Patch {
  id: string;
  extensions?: Record<string, Record<string, unknown>>;
}

function recorder() {
  const patches: Patch[] = [];
  const updateObject = (id: string, patch: Partial<CourseObject>) => {
    patches.push({ id, extensions: patch.extensions });
  };
  return { patches, updateObject };
}

function ingestOf(patch: Patch): { status: string; contentHash: string } {
  const ext = patch.extensions?.["x-finch-studio"] as { ingest: { status: string; contentHash: string } };
  return ext.ingest;
}

function baseDeps(overrides: Partial<UrlIngestDeps>): UrlIngestDeps {
  return {
    configured: true,
    fetchBytes: async () => new ArrayBuffer(8),
    hashBytes: async () => HASH,
    probe: async () => ({ durationMs: 10_000, width: 1920, height: 1080 }),
    request: async () => ({ jobId: `ingest-${HASH.slice(0, 32)}`, token: "tok", deduped: false }),
    poll: async () => ({ status: "done", attempts: 1, error: null, outputs }),
    ...overrides,
  };
}

describe("ingest flow for a video added by URL", () => {
  it("no-ops when ingest is not configured in the build", async () => {
    const { patches, updateObject } = recorder();
    let requested = false;
    const outcome = await ingestVideoObjectByUrl(videoObject(), updateObject, {
      configured: false,
      request: async () => {
        requested = true;
        return null;
      },
    });
    expect(outcome).toEqual({ status: "unconfigured" });
    expect(requested).toBe(false);
    expect(patches).toHaveLength(0);
  });

  it("requests a job for the URL, stamps progress, and lands the proxy URL on done", async () => {
    const { patches, updateObject } = recorder();
    let seenInput: unknown = null;
    const outcome = await ingestVideoObjectByUrl(videoObject(), updateObject, baseDeps({
      request: async (input) => {
        seenInput = input;
        return { jobId: `ingest-${HASH.slice(0, 32)}`, token: "tok", deduped: false } as IngestJobHandle;
      },
      poll: async (_handle, opts) => {
        opts?.onStatus?.({ status: "running", attempts: 1, error: null, outputs: null } as IngestJobState);
        return { status: "done", attempts: 1, error: null, outputs } as IngestJobState;
      },
    }));
    expect(outcome).toEqual({ status: "done", jobId: `ingest-${HASH.slice(0, 32)}` });
    expect(seenInput).toMatchObject({
      sourceUrl: URL,
      contentHash: HASH,
      kind: "video",
      sourceR2Key: `url-source/${HASH}`,
      width: 1920,
      height: 1080,
      durationMs: 10_000,
    });
    const statuses = patches.map((p) => ingestOf(p).status);
    expect(statuses).toEqual(["queued", "running", "done"]);
    const finalExt = patches.at(-1)?.extensions?.["x-finch-studio"] as { ingestProxyUrl?: string };
    expect(finalExt.ingestProxyUrl).toContain("/file/proxy-720p.mp4?token=tok");
  });

  it("stamps the failure and reports it when the job fails", async () => {
    const { patches, updateObject } = recorder();
    const outcome = await ingestVideoObjectByUrl(videoObject(), updateObject, baseDeps({
      poll: async () => ({ status: "failed", attempts: 3, error: "ffmpeg exited 1", outputs: null }),
    }));
    expect(outcome).toEqual({ status: "failed", error: "ffmpeg exited 1" });
    expect(ingestOf(patches.at(-1)!).status).toBe("failed");
  });

  it("reports a download failure without ever requesting a job", async () => {
    const { patches, updateObject } = recorder();
    let requested = false;
    const outcome = await ingestVideoObjectByUrl(videoObject(), updateObject, baseDeps({
      fetchBytes: async () => {
        throw new Error("the video could not be downloaded (404)");
      },
      request: async () => {
        requested = true;
        return null;
      },
    }));
    expect(outcome).toEqual({ status: "failed", error: "the video could not be downloaded (404)" });
    expect(requested).toBe(false);
    expect(patches).toHaveLength(0);
  });

  it("refuses a non-https URL before any network work", async () => {
    const { updateObject } = recorder();
    const object = { ...videoObject(), resource: "http://cdn.example/clip.mp4" } as CourseObject;
    const outcome = await ingestVideoObjectByUrl(object, updateObject, baseDeps({}));
    expect(outcome.status).toBe("failed");
  });
});
