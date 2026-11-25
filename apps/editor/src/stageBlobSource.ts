/**
 * Same-origin stage preview sources for matted footage (issue #122).
 *
 * The stage composite reads footage pixels back through a canvas
 * (drawMattedFrame calls getImageData), so the footage frame must be
 * same-origin or CORS-clean. Verified live in session 69 against the
 * "S64 Matte Check" project: the MDN flower host serves
 * Access-Control-Allow-Origin *, but the w3schools mov_bbb host
 * serves no CORS headers at all, so the session 68 CORS-mode element
 * load fails there, the plain fallback plays, and the composite
 * readback throws a SecurityError on the tainted canvas.
 *
 * Two readable routes, tried in order for footage with a ready matte:
 *
 * 1. Blob: fetch the preview bytes with a normal CORS fetch and play
 *    them through a blob object URL. A blob URL is same-origin, so
 *    its frames are always canvas-readable.
 * 2. Ingest fetch-through: when the host refuses CORS, ask the ingest
 *    service to fetch the source server-side (its job contract takes
 *    a sourceUrl) and play the finished proxy artefact, which the
 *    service serves with CORS for the Studio origins. The job
 *    identity here is a SHA-256 of the source URL, not of the content:
 *    the browser cannot hash bytes it cannot read. The service
 *    dedupes on that identity, a later true ingest (which hashes the
 *    real bytes) creates its own job, and nothing from this path is
 *    stamped onto the project.
 *
 * A no-cors opaque fetch is NOT a route: verified firsthand in
 * headless Chromium (session 69) that an opaque response body reads
 * back as zero bytes to script, so no blob can be built from it.
 *
 * When neither route yields a readable source, the caller keeps the
 * direct-URL chain (CORS mode, then plain), so playback is never
 * worse than before and the composite failure stays honest.
 */
import {
  ingestArtefactUrl,
  ingestConfigured,
  pollIngestJob,
  requestIngestJob,
} from "./ingestClient";

export type StageFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function mattedStageBlobNeeded(matteReady: boolean, src: string): boolean {
  return matteReady && /^https?:\/\//i.test(src);
}

export async function fetchSameOriginBlobUrl(
  src: string,
  fetchImpl: StageFetch = (input, init) => fetch(input, init),
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<string | null> {
  try {
    const res = await fetchImpl(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? createObjectUrl(blob) : null;
  } catch {
    return null;
  }
}

export async function hashSourceUrl(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One-shot readable-source resolution for the export path, which
 * preloads every footage element before its frame loop: for footage
 * with a ready matte, resolve the blob route, then the ingest
 * fetch-through, then the original URL. Non-matted footage and
 * non-http sources keep the original untouched, exactly as before.
 */
export async function resolveReadableFootageSrc(
  resource: string,
  matteReady: boolean,
  deps: {
    blob?: typeof fetchSameOriginBlobUrl;
    proxy?: typeof fetchStageProxyUrl;
  } = {},
): Promise<string> {
  if (!mattedStageBlobNeeded(matteReady, resource)) return resource;
  const blob = await (deps.blob ?? fetchSameOriginBlobUrl)(resource);
  if (blob) return blob;
  const proxy = await (deps.proxy ?? fetchStageProxyUrl)(resource);
  return proxy ?? resource;
}

export interface StageProxyDeps {
  configured: boolean;
  hash: (url: string) => Promise<string>;
  request: typeof requestIngestJob;
  poll: typeof pollIngestJob;
  artefactUrl: typeof ingestArtefactUrl;
}

const defaultStageProxyDeps: StageProxyDeps = {
  configured: ingestConfigured,
  hash: hashSourceUrl,
  request: requestIngestJob,
  poll: pollIngestJob,
  artefactUrl: ingestArtefactUrl,
};

export async function fetchStageProxyUrl(
  src: string,
  deps: StageProxyDeps = defaultStageProxyDeps,
): Promise<string | null> {
  if (!deps.configured || !src.startsWith("https://")) return null;
  try {
    const contentHash = await deps.hash(src);
    const handle = await deps.request({
      sourceR2Key: `url-source/${contentHash}`,
      contentHash,
      kind: "video",
      sourceUrl: src,
    });
    if (!handle) return null;
    const final = await deps.poll(handle, { intervalMs: 2000, timeoutMs: 180_000 });
    if (final.status !== "done" || !final.outputs?.proxy) return null;
    return deps.artefactUrl(handle, "proxy-720p.mp4");
  } catch {
    return null;
  }
}
