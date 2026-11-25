// @vitest-environment jsdom
/**
 * Issue #122: matted stage footage must composite from same-origin
 * frames. Hosts that serve no CORS headers fail the CORS-mode element
 * load and taint the canvas on the plain fallback. Route 1 fetches
 * the preview bytes into a same-origin blob URL. Route 2 asks the
 * ingest service to fetch the source server-side and plays its
 * CORS-served proxy artefact. A no-cors opaque fetch is not a route:
 * its body reads back as zero bytes to script (verified firsthand).
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchSameOriginBlobUrl,
  fetchStageProxyUrl,
  hashSourceUrl,
  mattedStageBlobNeeded,
  type StageFetch,
  type StageProxyDeps,
} from "../stageBlobSource.js";

const okResponse = (body: string) => ({
  ok: true,
  blob: async () => new Blob([body], { type: "video/mp4" }),
});

describe("mattedStageBlobNeeded (issue #122)", () => {
  it("only fetches bytes for matted http(s) footage", () => {
    expect(mattedStageBlobNeeded(true, "https://a.example/v.mp4")).toBe(true);
    expect(mattedStageBlobNeeded(true, "http://a.example/v.mp4")).toBe(true);
    expect(mattedStageBlobNeeded(false, "https://a.example/v.mp4")).toBe(false);
    expect(mattedStageBlobNeeded(true, "media/clip.mp4")).toBe(false);
    expect(mattedStageBlobNeeded(true, "blob:https://x/1")).toBe(false);
  });
});

describe("fetchSameOriginBlobUrl (issue #122)", () => {
  it("builds a blob URL from a CORS fetch", async () => {
    const fetchImpl = vi.fn(async () => okResponse("cors-bytes"));
    const create = vi.fn((blob: Blob) => `blob:made-${blob.size}`);
    const url = await fetchSameOriginBlobUrl("https://a.example/v.mp4", fetchImpl as unknown as StageFetch, create);
    expect(url).toBe("blob:made-10");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://a.example/v.mp4");
  });

  it("returns null when CORS is refused, the status is bad, or the body is empty", async () => {
    const refused = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect(await fetchSameOriginBlobUrl("https://w.example/v.mp4", refused as unknown as StageFetch, () => "blob:x")).toBeNull();
    const badStatus = vi.fn(async () => ({ ok: false, blob: async () => new Blob(["no"]) }));
    expect(await fetchSameOriginBlobUrl("https://a.example/v.mp4", badStatus as unknown as StageFetch, () => "blob:x")).toBeNull();
    const empty = vi.fn(async () => ({ ok: true, blob: async () => new Blob([]) }));
    expect(await fetchSameOriginBlobUrl("https://a.example/v.mp4", empty as unknown as StageFetch, () => "blob:x")).toBeNull();
  });
});

describe("hashSourceUrl (issue #122)", () => {
  it("is the SHA-256 hex of the URL text", async () => {
    expect(await hashSourceUrl("https://www.w3schools.com/html/mov_bbb.mp4")).toBe(
      "c85178e8c7cc127da9b5a6602a59c4486a9b78e749475fbb8be4cef236dd6cb8",
    );
  });
});

describe("fetchStageProxyUrl (issue #122)", () => {
  const handle = { jobId: "ingest-abc", token: "tok", deduped: false };
  const deps = (patch: Partial<StageProxyDeps> = {}): StageProxyDeps => ({
    configured: true,
    hash: async () => "ab12",
    request: vi.fn(async () => handle) as StageProxyDeps["request"],
    poll: vi.fn(async () => ({
      status: "done", attempts: 1, error: null,
      outputs: { proxy: { r2Key: "derived/ab/ab12/proxy-720p.mp4" } },
    })) as unknown as StageProxyDeps["poll"],
    artefactUrl: ((h: { jobId: string }, name: string) =>
      "https://ingest.example/jobs/" + h.jobId + "/file/" + name) as StageProxyDeps["artefactUrl"],
    ...patch,
  });

  it("requests a URL-identity job and returns the proxy artefact URL", async () => {
    const d = deps();
    const url = await fetchStageProxyUrl("https://w.example/v.mp4", d);
    expect(url).toBe("https://ingest.example/jobs/ingest-abc/file/proxy-720p.mp4");
    expect(d.request).toHaveBeenCalledWith({
      sourceR2Key: "url-source/ab12",
      contentHash: "ab12",
      kind: "video",
      sourceUrl: "https://w.example/v.mp4",
    });
  });

  it("returns null when unconfigured, not https, refused, or the job fails", async () => {
    expect(await fetchStageProxyUrl("https://w.example/v.mp4", deps({ configured: false }))).toBeNull();
    expect(await fetchStageProxyUrl("http://w.example/v.mp4", deps())).toBeNull();
    expect(await fetchStageProxyUrl("https://w.example/v.mp4", deps({
      request: vi.fn(async () => null) as StageProxyDeps["request"],
    }))).toBeNull();
    expect(await fetchStageProxyUrl("https://w.example/v.mp4", deps({
      poll: vi.fn(async () => ({ status: "failed", attempts: 3, error: "boom", outputs: null })) as unknown as StageProxyDeps["poll"],
    }))).toBeNull();
  });
});
