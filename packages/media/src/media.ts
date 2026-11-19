/**
 * Media library core (issues #6 and #7): the three source model, ingest
 * planning, waveform peaks, and provenance stamping. Pure data and math;
 * the Cloudflare media worker implements the network side of these shapes.
 *
 * Sources: finch-stock (licensed library), unsplash (via the worker proxy,
 * keys server side), user (the signed in user's R2 library, shared across
 * Studio projects and FinchLearn courses with no duplicate uploads).
 */

export type MediaSource = "finch-stock" | "unsplash" | "user";

export interface MediaAsset {
  id: string;
  source: MediaSource;
  /** R2 key once ingested or cached. Remote only assets carry remoteUrl. */
  r2Key?: string;
  remoteUrl?: string;
  kind: "video" | "audio" | "image";
  name: string;
  durationMs?: number;
  width?: number;
  height?: number;
  /** Provenance line stamped at placement time (stock license, Unsplash credit). */
  credit?: string;
  tags: string[];
}

export interface UnsplashPhoto {
  id: string;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { download_location: string };
  user: { name: string; username: string };
  width: number;
  height: number;
}

/** Map an Unsplash API photo to a library asset, with guideline attribution. */
export function unsplashToAsset(photo: UnsplashPhoto): MediaAsset {
  const utm = "utm_source=finchlearn&utm_medium=referral";
  return {
    id: `unsplash-${photo.id}`,
    source: "unsplash",
    remoteUrl: photo.urls.regular,
    kind: "image",
    name: `Photo by ${photo.user.name}`,
    width: photo.width,
    height: photo.height,
    credit: `${photo.user.name} on Unsplash (https://unsplash.com/@${photo.user.username}?${utm})`,
    tags: [],
  };
}

/** The download_location ping the Unsplash guidelines require on placement. */
export function unsplashPlacementPing(photo: UnsplashPhoto): string {
  return photo.links.download_location;
}

export function stockCredit(asset: MediaAsset): string {
  return asset.credit ?? "Finch Stock library asset";
}

// ---------------------------------------------------------------------------
// Ingest planning (#7): proxy ladder, thumbnails, waveform peaks.
// ---------------------------------------------------------------------------

export interface IngestPlan {
  /** Proxy renditions to generate, widest first. Original kept per policy. */
  proxies: { width: number; label: string }[];
  thumbnailStrip: { count: number; width: number };
  waveform: boolean;
}

export function planIngest(asset: { kind: MediaAsset["kind"]; width?: number; durationMs?: number }): IngestPlan {
  if (asset.kind === "image") {
    return { proxies: [{ width: 1280, label: "web" }, { width: 480, label: "thumb" }], thumbnailStrip: { count: 1, width: 480 }, waveform: false };
  }
  if (asset.kind === "audio") {
    return { proxies: [], thumbnailStrip: { count: 0, width: 0 }, waveform: true };
  }
  const w = asset.width ?? 1920;
  const proxies = [{ width: 1280, label: "720p" }];
  if (w > 1280) proxies.push({ width: 1920, label: "1080p" });
  proxies.push({ width: 480, label: "thumb" });
  const count = Math.max(4, Math.min(40, Math.round((asset.durationMs ?? 10000) / 5000)));
  return { proxies, thumbnailStrip: { count, width: 320 }, waveform: true };
}

/**
 * Waveform peaks from raw samples: one min/max pair per bucket, normalized
 * to 0..1. Used by the waveform UI and stored alongside the asset at ingest.
 */
export function computePeaks(samples: ArrayLike<number>, buckets: number): { min: number; max: number }[] {
  const out: { min: number; max: number }[] = [];
  if (buckets <= 0 || samples.length === 0) return out;
  const per = samples.length / buckets;
  let peak = 0;
  const mins: number[] = [];
  const maxs: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.floor((b + 1) * per));
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    mins.push(min === Infinity ? 0 : min);
    maxs.push(max === -Infinity ? 0 : max);
    peak = Math.max(peak, Math.abs(maxs[b]), Math.abs(mins[b]));
  }
  const norm = peak > 0 ? 1 / peak : 1;
  for (let b = 0; b < buckets; b++) out.push({ min: mins[b] * norm, max: maxs[b] * norm });
  return out;
}

/** Filter a library listing by kind and a free text query over name and tags. */
export function filterAssets(
  assets: MediaAsset[],
  filter: { kind?: MediaAsset["kind"]; source?: MediaSource; query?: string },
): MediaAsset[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  return assets.filter((a) => {
    if (filter.kind && a.kind !== filter.kind) return false;
    if (filter.source && a.source !== filter.source) return false;
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q));
  });
}
