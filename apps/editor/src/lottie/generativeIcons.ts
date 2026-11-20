/**
 * generativeIcons: the live Browse client for the Generative Icons
 * catalogue (issue #100).
 *
 * Endpoints, verified against the live API on 2026-11-19:
 * - Catalogue: GET https://generativeicons.com/api/icons?limit=24&offset=0
 *   returns { total, offset, results: [{ id, label, category,
 *   description, searchTerms, page, asset }] }.
 * - Search: GET https://generativeicons.com/api/search?q=<query>
 *   returns { query, results: [{ id, score }] } (ids and scores only;
 *   labels and asset URLs follow the catalogue's fixed patterns).
 * - Asset: https://generativeicons.com/assets/<id>.lottie
 *
 * Failures propagate as errors: the Browse tab shows the failure and
 * never substitutes local or invented results.
 */
import { loadLottieFromBytes, type InflateFn } from "./dotLottie";
import { browserInflate } from "./dotLottie";
import type { LottieAnimationData } from "./lottieCore";

export const GENERATIVE_ICONS_API = "https://generativeicons.com/api";
export const GENERATIVE_ICONS_ASSET_BASE = "https://generativeicons.com/assets";

export interface GenerativeIconResult {
  id: string;
  label: string;
  description?: string;
  category?: string;
  assetUrl: string;
  pageUrl?: string;
}

type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

const defaultFetch: FetchFn = (url) => fetch(url);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function labelFromId(id: string): string {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/**
 * Map a raw Generative Icons API payload to browse results. Handles
 * the catalogue shape (full records) and the search shape (id plus
 * score), and drops malformed entries instead of guessing at them.
 */
export function mapGenerativeIconsResponse(payload: unknown): GenerativeIconResult[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : isRecord(payload) && Array.isArray(payload.icons)
        ? payload.icons
        : [];
  const out: GenerativeIconResult[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !row.id) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({
      id: row.id,
      label: typeof row.label === "string" && row.label ? row.label : labelFromId(row.id),
      description: typeof row.description === "string" ? row.description : undefined,
      category: typeof row.category === "string" ? row.category : undefined,
      assetUrl:
        typeof row.asset === "string" && row.asset
          ? row.asset
          : `${GENERATIVE_ICONS_ASSET_BASE}/${row.id}.lottie`,
      pageUrl: typeof row.page === "string" ? row.page : undefined,
    });
  }
  return out;
}

/**
 * Search the live catalogue. An empty query lists the first catalogue
 * page. Throws on network or HTTP failure so the UI can fail honestly.
 */
export async function searchGenerativeIcons(
  query: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<GenerativeIconResult[]> {
  const q = query.trim();
  const url = q
    ? `${GENERATIVE_ICONS_API}/search?q=${encodeURIComponent(q)}`
    : `${GENERATIVE_ICONS_API}/icons?limit=24&offset=0`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Generative Icons search failed (${res.status}).`);
  }
  return mapGenerativeIconsResponse(await res.json());
}

/**
 * Fetch one browse result's .lottie asset and parse its animation, for
 * insert on click. The inserted object carries the parsed animation
 * inline, so the placed icon keeps rendering offline and in exports
 * without depending on the live API again.
 */
export async function fetchGenerativeIconAnimation(
  result: GenerativeIconResult,
  fetchFn: FetchFn = defaultFetch,
  inflate: InflateFn = browserInflate,
): Promise<LottieAnimationData> {
  const res = await fetchFn(result.assetUrl);
  if (!res.ok) {
    throw new Error(`Could not fetch "${result.label}" from Generative Icons (${res.status}).`);
  }
  return loadLottieFromBytes(new Uint8Array(await res.arrayBuffer()), inflate);
}
