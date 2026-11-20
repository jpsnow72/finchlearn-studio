/**
 * ingestFlow.ts — wires the ingest client (issue #7) into the editor's
 * media add-by-URL flow.
 *
 * Adding a video by public URL places the object in the scene at once
 * with the original URL, exactly like other media. This flow then runs
 * the ingest job behind it: it downloads the source bytes to compute
 * the content hash (the job identity in the @finch-studio/media
 * contract), requests the job, polls it, and stamps every state onto
 * the object through the store's updateObject. When the job is done,
 * the proxy artefact URL is stamped alongside the ingest record, and
 * the stage preview resolves to the 720p proxy (see previewSourceFor
 * and FootageView). Exports never consult the proxy: they keep using
 * the object's original resource.
 *
 * URL-added media has no R2 original yet, so the input's sourceR2Key
 * records the content identity under the url-source/ prefix and the
 * service fetches the bytes through sourceUrl (the public URL itself,
 * which is the short-lived https GET the contract asks for).
 *
 * When ingest is not configured in the build, or anything along the
 * way fails, the object simply keeps its original source; the outcome
 * reports what happened so the caller can tell the user.
 */
import type { CourseObject } from "@finch-studio/core";
import type { IngestInput } from "@finch-studio/media";
import {
  ingestArtefactUrl,
  ingestConfigured,
  pollIngestJob,
  requestIngestJob,
  stampIngestProxyUrl,
  stampIngestState,
  type IngestJobState,
} from "./ingestClient";

export interface ProbedVideoMedia {
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface UrlIngestDeps {
  configured: boolean;
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  hashBytes: (bytes: ArrayBuffer) => Promise<string>;
  probe: (url: string) => Promise<ProbedVideoMedia>;
  request: typeof requestIngestJob;
  poll: typeof pollIngestJob;
}

async function fetchBytesDefault(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the video could not be downloaded (${res.status})`);
  return res.arrayBuffer();
}

async function hashBytesDefault(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Best effort metadata read from a detached video element. Never
 * throws: dimensions and duration are claims the service re-probes. */
function probeVideoDefault(url: string): Promise<ProbedVideoMedia> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const finish = (value: ProbedVideoMedia) => {
      video.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => finish({}), 8000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish({
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish({});
    };
    video.src = url;
  });
}

const defaultDeps: UrlIngestDeps = {
  configured: ingestConfigured,
  fetchBytes: fetchBytesDefault,
  hashBytes: hashBytesDefault,
  probe: probeVideoDefault,
  request: requestIngestJob,
  poll: pollIngestJob,
};

export type UrlIngestOutcome =
  | { status: "unconfigured" }
  | { status: "done"; jobId: string }
  | { status: "failed"; error: string };

type UpdateObject = (id: string, patch: Partial<CourseObject>) => void;

/**
 * Run the ingest job for a video object that was just added by URL.
 * `object` is the object as placed (its resource is the public URL);
 * states are stamped back through updateObject as the job progresses.
 */
export async function ingestVideoObjectByUrl(
  object: CourseObject,
  updateObject: UpdateObject,
  deps: Partial<UrlIngestDeps> = {},
): Promise<UrlIngestOutcome> {
  const d: UrlIngestDeps = { ...defaultDeps, ...deps };
  const url = (object as { resource?: string }).resource ?? "";
  if (!d.configured) return { status: "unconfigured" };
  if (!url.startsWith("https://")) {
    return { status: "failed", error: "ingest needs an https video URL" };
  }

  try {
    const bytes = await d.fetchBytes(url);
    const contentHash = await d.hashBytes(bytes);
    const probed = await d.probe(url).catch(() => ({}) as ProbedVideoMedia);
    const input: IngestInput = {
      sourceR2Key: `url-source/${contentHash}`,
      contentHash,
      kind: "video",
      ...(probed.width ? { width: probed.width } : {}),
      ...(probed.height ? { height: probed.height } : {}),
      ...(probed.durationMs ? { durationMs: probed.durationMs } : {}),
    };
    const stamp = (state: IngestJobState, proxyUrl?: string) => {
      let next = stampIngestState(object, input, state);
      if (proxyUrl) next = stampIngestProxyUrl(next, proxyUrl);
      updateObject(object.id, { extensions: next.extensions });
    };
    try {
      const handle = await d.request({ ...input, sourceUrl: url });
      if (!handle) return { status: "unconfigured" };
      stamp({ status: "queued", attempts: 0, error: null, outputs: null });
      let lastStatus = "queued";
      const final = await d.poll(handle, {
        intervalMs: 2000,
        onStatus: (state) => {
          // Stamp on transitions only, so polling never floods the
          // project's undo history with identical records.
          if (state.status !== lastStatus) {
            lastStatus = state.status;
            stamp(state);
          }
        },
      });
      if (final.status === "done" && final.outputs?.proxy) {
        stamp(final, ingestArtefactUrl(handle, "proxy-720p.mp4"));
        return { status: "done", jobId: handle.jobId };
      }
      stamp(final);
      return { status: "failed", error: final.error ?? "the ingest job failed" };
    } catch (err) {
      try {
        stamp({
          status: "failed",
          attempts: 0,
          error: err instanceof Error ? err.message : String(err),
          outputs: null,
        });
      } catch {
        // The failure outcome below already carries the news.
      }
      throw err;
    }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
