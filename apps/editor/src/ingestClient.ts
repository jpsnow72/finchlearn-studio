/**
 * ingestClient.ts — client for the finch-ingest service (issue #7).
 *
 * At ingest (upload or recording) the editor requests a job for the
 * new media; the service produces a 720p proxy, waveform peaks, and a
 * thumbnail strip. The job contract (identity by content hash, status
 * lifecycle, output manifest, storage keys) lives in
 * @finch-studio/media (ingest.ts); this file is only the HTTP client
 * plus the preview / export source resolution the editor calls.
 *
 * Configured by build env: VITE_INGEST_URL + VITE_INGEST_KEY (the key
 * ships in the bundle, the same trust class as the render key). When
 * unconfigured, ingest requests no-op and the editor keeps using the
 * original media for preview, exactly as before this lane.
 *
 * Hard rule: preview prefers the proxy once the job is done; export
 * resolves the ORIGINAL only and throws rather than ever falling back
 * to the proxy (resolveExportSource in the media contract).
 */
import {
  INGEST_EXTENSION,
  getStoredIngest,
  planIngest,
  resolveExportSource,
  resolvePreviewSource,
  withIngestRecord,
  type IngestInput,
  type IngestJob,
  type IngestJobStatus,
  type IngestOutputs,
} from "@finch-studio/media";

const INGEST_URL = ((import.meta.env.VITE_INGEST_URL as string | undefined) ?? "").replace(/\/$/, "");
const INGEST_KEY = (import.meta.env.VITE_INGEST_KEY as string | undefined) ?? "";

export const ingestConfigured = Boolean(INGEST_URL && INGEST_KEY);

export interface IngestJobHandle {
  jobId: string;
  token: string;
  deduped: boolean;
}

/** The fetch shape this client needs; injectable for tests. */
export type IngestFetch = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: IngestFetch = (url, init) => fetch(url, init);

/**
 * Request an ingest job for newly ingested media. `sourceUrl` is a
 * short-lived signed GET URL for the original bytes, issued through
 * the finch-media Worker; the ingest service holds no R2 credentials.
 * Re-requesting unchanged media (same contentHash) dedupes server
 * side: the existing job comes back and nothing re-runs.
 * Returns null when ingest is not configured in this build.
 */
export async function requestIngestJob(
  input: IngestInput & { sourceUrl: string },
  fetchFn: IngestFetch = defaultFetch,
): Promise<IngestJobHandle | null> {
  if (!ingestConfigured) return null;
  const res = await fetchFn(`${INGEST_URL}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingest-key": INGEST_KEY },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // keep the status-based message
    }
    throw new Error(`the ingest service refused the job (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const body = (await res.json()) as { jobId: string; token: string; deduped?: boolean };
  return { jobId: body.jobId, token: body.token, deduped: body.deduped === true };
}

export interface IngestJobState {
  status: IngestJobStatus;
  attempts: number;
  error: string | null;
  outputs: IngestOutputs | null;
}

export async function fetchIngestJobState(
  handle: IngestJobHandle,
  fetchFn: IngestFetch = defaultFetch,
): Promise<IngestJobState> {
  const res = await fetchFn(`${INGEST_URL}/jobs/${handle.jobId}`, {
    headers: { "x-ingest-token": handle.token },
  });
  if (!res.ok) throw new Error(`the ingest job could not be read (${res.status})`);
  const body = (await res.json()) as IngestJobState;
  return body;
}

/**
 * Poll a job until it is done or failed (or the deadline passes).
 * Returns the final state; a failed job is a result, not a throw, so
 * the caller can stamp the failure onto the asset and offer a retry.
 */
export async function pollIngestJob(
  handle: IngestJobHandle,
  opts: { fetchFn?: IngestFetch; intervalMs?: number; timeoutMs?: number; onStatus?: (state: IngestJobState) => void } = {},
): Promise<IngestJobState> {
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const intervalMs = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  for (;;) {
    const state = await fetchIngestJobState(handle, fetchFn);
    opts.onStatus?.(state);
    if (state.status === "done" || state.status === "failed") return state;
    if (Date.now() > deadline) throw new Error("the ingest job timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Artefact download URL for a finished job (proxy, peaks, or strip). */
export function ingestArtefactUrl(handle: IngestJobHandle, name: "proxy-720p.mp4" | "peaks.json" | "thumbs-strip.jpg"): string {
  return `${INGEST_URL}/jobs/${handle.jobId}/file/${name}?token=${encodeURIComponent(handle.token)}`;
}

// ---------------------------------------------------------------------------
// Source resolution for editor surfaces
// ---------------------------------------------------------------------------

export interface EditorMediaSources {
  /** Resolved URL of the ORIGINAL media (preview fallback, export). */
  originalUrl: string;
  /** Resolved URL of the proxy artefact, when the job is done. The
   * caller resolves the proxy r2Key through the media worker, or uses
   * ingestArtefactUrl while the artefact is still service hosted. */
  proxyUrl?: string | null;
  /** Completed ingest outputs stamped on the asset, when done. */
  ingestOutputs?: IngestOutputs | null;
}

/** Preview and scrubbing: proxy preferred, original as the fallback. */
export function previewSourceFor(sources: EditorMediaSources): { url: string; isProxy: boolean } {
  return resolvePreviewSource({
    original: sources.originalUrl,
    ingestOutputs: sources.ingestOutputs ?? null,
    proxyUrl: sources.proxyUrl ?? null,
  });
}

/** Export: the original, always. Throws rather than using the proxy. */
export function exportSourceFor(sources: EditorMediaSources): string {
  return resolveExportSource({
    original: sources.originalUrl,
    ingestOutputs: sources.ingestOutputs ?? null,
    proxyUrl: sources.proxyUrl ?? null,
  });
}

/**
 * Build the completed IngestJob for a polled state and stamp it onto
 * an asset or editor object, refreshing its waveform peaks slot for
 * the Timeline and audio consumers. Returns the asset unchanged when
 * the job has no outputs yet.
 */
/**
 * Stamp the finished job's proxy artefact URL next to the ingest
 * record (extensions["x-finch-studio"].ingestProxyUrl), so preview
 * surfaces can resolve the proxy from the object alone while the
 * artefacts are still service hosted. Once the ship-point R2 sync
 * lands, callers resolve the record's proxy r2Key through the media
 * worker instead and this slot can retire.
 */
export function stampIngestProxyUrl<T extends { extensions?: Record<string, Record<string, unknown>> }>(
  asset: T,
  proxyUrl: string,
): T {
  const ext: Record<string, unknown> = { ...(asset.extensions?.[INGEST_EXTENSION] ?? {}) };
  ext.ingestProxyUrl = proxyUrl;
  return {
    ...asset,
    extensions: { ...(asset.extensions ?? {}), [INGEST_EXTENSION]: ext },
  };
}

/** Read back the proxy artefact URL stamped by stampIngestProxyUrl. */
export function storedIngestProxyUrl(carrier: {
  extensions?: Record<string, Record<string, unknown>>;
}): string | null {
  const raw = carrier.extensions?.[INGEST_EXTENSION]?.ingestProxyUrl;
  return typeof raw === "string" && raw ? raw : null;
}

export function stampIngestState<T extends { extensions?: Record<string, Record<string, unknown>> }>(
  asset: T,
  input: IngestInput,
  state: IngestJobState,
): T {
  const existing = getStoredIngest(asset);
  const job: IngestJob = {
    id: existing?.jobId ?? `ingest-${input.contentHash.slice(0, 32)}`,
    status: state.status,
    input,
    plan: planIngest(input),
    attempts: state.attempts,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(state.outputs ? { outputs: state.outputs } : {}),
    ...(state.error ? { error: state.error } : {}),
  };
  return withIngestRecord(asset, job);
}
