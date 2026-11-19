/**
 * provider.ts — the translation provider port (issue #54).
 *
 * Translation goes through this one small interface so the engine
 * binding is swappable: the variant builder only ever sees
 * `TranslationProvider`. The first real binding is
 * `GoogleTranslateProvider`, written against the documented Google
 * Cloud Translation API (v2) request and response shape, because the
 * product already has a Google API relationship (Google TTS voices,
 * Google sign-in).
 *
 * Credentials: the binding receives its API key from the caller, which
 * reads it from configuration. Only the secret NAMES are ever named in
 * code and copy: `GOOGLE_TRANSLATE_API_KEY` (server and tooling) and
 * `VITE_GOOGLE_TRANSLATE_API_KEY` (the editor build). No key value is
 * stored in this repo.
 *
 * Honest failure: when no key is configured the binding throws
 * `TranslationNotConfiguredError` before any request, and the variant
 * flow surfaces that state to the user. Nothing in this package ever
 * returns the source text dressed up as a translation.
 */

export interface TranslateRequest {
  /** Source language tag (BCP-47 or provider code). */
  from: string;
  /** Target language tag (provider code, see languages.translateCode). */
  to: string;
}

export interface TranslationProvider {
  /** Stable binding id, recorded on variants for provenance. */
  readonly providerId: string;
  /** True when the binding has what it needs to run (key configured). */
  readonly isConfigured: boolean;
  /**
   * Translate a batch of plain-text strings. Returns exactly one
   * translation per input, in order. Implementations must throw on
   * failure rather than echo inputs back.
   */
  translateBatch(texts: string[], req: TranslateRequest): Promise<string[]>;
}

/** No translation key is configured; the flow cannot run. */
export class TranslationNotConfiguredError extends Error {
  readonly code = "translation-not-configured";
  constructor(message: string) {
    super(message);
    this.name = "TranslationNotConfiguredError";
  }
}

/** The provider ran (or was reached) and failed. */
export class TranslationProviderError extends Error {
  readonly code = "translation-provider-error";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TranslationProviderError";
    this.status = status;
  }
}

export const TRANSLATE_API_KEY_SECRET = "GOOGLE_TRANSLATE_API_KEY";
export const TRANSLATE_API_KEY_SECRET_EDITOR = "VITE_GOOGLE_TRANSLATE_API_KEY";

export const NOT_CONFIGURED_MESSAGE =
  "Translation is not configured. Set the GOOGLE_TRANSLATE_API_KEY secret " +
  "(VITE_GOOGLE_TRANSLATE_API_KEY for the editor build) and try again. " +
  "No variant was created and nothing was translated.";

/** The documented Google Cloud Translation API (v2) endpoint. */
export const GOOGLE_TRANSLATE_ENDPOINT =
  "https://translation.googleapis.com/language/translate/v2";

/** Minimal structural fetch seam, so this package stays environment
 * agnostic (browser, worker, or node) with no DOM lib dependency. */
export interface TranslationFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface TranslationFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type TranslationFetchFn = (
  url: string,
  init: TranslationFetchInit,
) => Promise<TranslationFetchResponse>;

const defaultFetch: TranslationFetchFn = (url, init) =>
  (globalThis as { fetch: TranslationFetchFn }).fetch(url, init);

export interface GoogleTranslateOptions {
  /** API key value, supplied by the caller from configuration. */
  apiKey?: string | null;
  fetchFn?: TranslationFetchFn;
  endpoint?: string;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Google Cloud Translation API (v2) binding.
 *
 * Documented shape: POST {endpoint} with header `X-Goog-Api-Key` and a
 * JSON body { q: string[], source, target, format: "text" }; the
 * response is { data: { translations: [{ translatedText }] } } with one
 * entry per input, in order. Translations may carry HTML entities even
 * in text format, so they are decoded here.
 */
export class GoogleTranslateProvider implements TranslationProvider {
  readonly providerId = "google-translate-v2";
  private readonly apiKey: string | null;
  private readonly fetchFn: TranslationFetchFn;
  private readonly endpoint: string;

  constructor(opts: GoogleTranslateOptions = {}) {
    this.apiKey = opts.apiKey?.trim() ? opts.apiKey.trim() : null;
    this.fetchFn = opts.fetchFn ?? defaultFetch;
    this.endpoint = opts.endpoint ?? GOOGLE_TRANSLATE_ENDPOINT;
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  async translateBatch(texts: string[], req: TranslateRequest): Promise<string[]> {
    if (!this.apiKey) {
      throw new TranslationNotConfiguredError(NOT_CONFIGURED_MESSAGE);
    }
    if (texts.length === 0) return [];
    let res: TranslationFetchResponse;
    try {
      res = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          q: texts,
          source: req.from,
          target: req.to,
          format: "text",
        }),
      });
    } catch {
      throw new TranslationProviderError(
        "The translation service could not be reached. Check your connection and try again.",
      );
    }
    if (!res.ok) {
      throw new TranslationProviderError(
        `Translation service unavailable (${res.status}). No variant was created.`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new TranslationProviderError(
        "The translation service returned an unreadable response. No variant was created.",
      );
    }
    const translations = (
      body as { data?: { translations?: { translatedText?: unknown }[] } }
    )?.data?.translations;
    if (!Array.isArray(translations) || translations.length !== texts.length) {
      throw new TranslationProviderError(
        "The translation service returned an unexpected result. No variant was created.",
      );
    }
    return translations.map((t) => {
      if (typeof t?.translatedText !== "string") {
        throw new TranslationProviderError(
          "The translation service returned an unexpected result. No variant was created.",
        );
      }
      return decodeHtmlEntities(t.translatedText);
    });
  }
}

/**
 * Build the default provider from a key getter (the editor passes one
 * that reads its build configuration; tooling reads its environment).
 * The returned provider reports `isConfigured` honestly; callers check
 * it before starting the flow.
 */
export function googleTranslateProviderFromKey(
  getApiKey: () => string | null | undefined,
  fetchFn?: TranslationFetchFn,
): GoogleTranslateProvider {
  return new GoogleTranslateProvider({ apiKey: getApiKey() ?? null, fetchFn });
}

// ---------------------------------------------------------------------------
// Rich text: translate the words, keep the markup
// ---------------------------------------------------------------------------

/**
 * Split a RichText HTML fragment into tag and text segments. Tags pass
 * through untouched; only text segments are sent for translation, so
 * headings, emphasis, and links survive translation exactly.
 */
export function splitRichText(html: string): { tag: boolean; text: string }[] {
  const parts: { tag: boolean; text: string }[] = [];
  const re = /(<[^>]*>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) parts.push({ tag: false, text: html.slice(last, m.index) });
    parts.push({ tag: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ tag: false, text: html.slice(last) });
  return parts;
}

/** True when a text segment carries translatable words (not just space). */
export function isTranslatableText(text: string): boolean {
  return text.trim().length > 0;
}
