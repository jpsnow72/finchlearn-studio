/**
 * provider.ts: the asset generation provider port (issues #93 and #95).
 *
 * Image generation goes through this one small interface so the
 * engine binding is swappable, following the translation provider
 * port in packages/translation. The generation flow only ever sees
 * `AssetGenerationProvider`; bindings are an endpoint binding (a
 * caller configured generation endpoint, which is where the FinchLearn
 * AI allowance is enforced server side, the same allowance the
 * narration stack rides, with no new credit system in this repo) and
 * the honest unconfigured binding.
 *
 * Credentials and endpoints: a binding receives its endpoint and key
 * from the caller, which reads them from configuration. Only the
 * secret NAMES are ever named in code and copy:
 * `FINCH_AI_ASSET_ENDPOINT` and `FINCH_AI_ASSET_API_KEY` (server and
 * tooling) and `VITE_FINCH_AI_ASSET_ENDPOINT` and
 * `VITE_FINCH_AI_ASSET_API_KEY` (the editor build). No key value and
 * no endpoint value is stored in this repo.
 *
 * Honest failure: when nothing is configured the binding reports
 * `isConfigured` false and throws `AssetGenerationNotConfiguredError`
 * before any request, and the generate flow surfaces that state to
 * the user. Nothing in this package ever returns placeholder art
 * dressed up as a generated asset.
 */
import type { AssetKind, AssetOutputDefaults } from "./generation.js";
import type { ResolvedStyle } from "./styles.js";
/** The fully baked request a binding receives. */
export interface GenerateAssetRequest {
  /** The user's plain words description, untouched. */
  userPrompt: string;
  /** The effective prompt: description plus style and output defaults. */
  prompt: string;
  kind: AssetKind;
  style: ResolvedStyle;
  defaults: AssetOutputDefaults;
  /**
   * The allowance scope the generation counts against. Always the
   * existing FinchLearn AI allowance; bindings pass it through to the
   * enforcing service, which counts the generation there.
   */
  allowanceScope: typeof AI_ALLOWANCE_SCOPE;
}

/** The one allowance every Studio AI feature rides (issue #95). */
export const AI_ALLOWANCE_SCOPE = "finchlearn-ai-allowance";

export interface GeneratedImageResult {
  /** R2 key once the binding has stored the image behind the media worker. */
  r2Key?: string;
  /** Resolved URL for the image, when the binding returns one. */
  remoteUrl?: string;
  width?: number;
  height?: number;
  /** Model identifier, recorded in provenance when the binding shares it. */
  model?: string;
}

export interface AssetGenerationProvider {
  /** Stable binding id, recorded on assets for provenance. */
  readonly providerId: string;
  /** True when the binding has what it needs to run. */
  readonly isConfigured: boolean;
  /**
   * Generate one image for the request. Implementations must throw on
   * failure rather than return placeholder art.
   */
  generate(req: GenerateAssetRequest): Promise<GeneratedImageResult>;
}

/** No generation endpoint is configured; the flow cannot run. */
export class AssetGenerationNotConfiguredError extends Error {
  readonly code = "asset-generation-not-configured";
  constructor(message: string) {
    super(message);
    this.name = "AssetGenerationNotConfiguredError";
  }
}

/** The provider ran (or was reached) and failed. */
export class AssetGenerationProviderError extends Error {
  readonly code = "asset-generation-provider-error";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AssetGenerationProviderError";
    this.status = status;
  }
}

export const ASSET_ENDPOINT_SECRET = "FINCH_AI_ASSET_ENDPOINT";
export const ASSET_ENDPOINT_SECRET_EDITOR = "VITE_FINCH_AI_ASSET_ENDPOINT";
export const ASSET_API_KEY_SECRET = "FINCH_AI_ASSET_API_KEY";
export const ASSET_API_KEY_SECRET_EDITOR = "VITE_FINCH_AI_ASSET_API_KEY";

export const ASSET_NOT_CONFIGURED_MESSAGE =
  "AI asset generation is not configured. Set the FINCH_AI_ASSET_ENDPOINT secret " +
  "(VITE_FINCH_AI_ASSET_ENDPOINT for the editor build) and try again. " +
  "No asset was created and nothing was counted against your AI allowance.";

/**
 * The honest default binding: no live image generation binding ships
 * in this repo yet, so until an endpoint is configured this is what
 * the editor builds. It never fakes output.
 */
export class UnconfiguredAssetProvider implements AssetGenerationProvider {
  readonly providerId = "unconfigured";
  readonly isConfigured = false;
  async generate(_request: GenerateAssetRequest): Promise<GeneratedImageResult> {
    throw new AssetGenerationNotConfiguredError(ASSET_NOT_CONFIGURED_MESSAGE);
  }
}

/** Minimal structural fetch seam, so this package stays environment
 * agnostic (browser, worker, or node) with no DOM lib dependency. */
export interface AssetFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface AssetFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type AssetFetchFn = (
  url: string,
  init: AssetFetchInit,
) => Promise<AssetFetchResponse>;

const defaultFetch: AssetFetchFn = (url, init) =>
  (globalThis as { fetch: AssetFetchFn }).fetch(url, init);

export interface EndpointAssetProviderOptions {
  /** Generation endpoint URL, supplied by the caller from configuration. */
  endpoint?: string | null;
  /** Optional key value, supplied by the caller from configuration. */
  apiKey?: string | null;
  fetchFn?: AssetFetchFn;
}

/**
 * Endpoint binding: POSTs the baked request as JSON to the configured
 * generation endpoint and expects `{ r2Key }` and/or `{ remoteUrl }`
 * back, plus optional `width`, `height`, and `model`. The endpoint is
 * the FinchLearn AI service surface: it stores the image in R2 behind
 * the media worker and enforces the existing AI allowance server
 * side, so a refused allowance comes back as an HTTP error here and
 * surfaces as a provider error, never as a saved asset.
 */
export class EndpointAssetProvider implements AssetGenerationProvider {
  readonly providerId = "finch-ai-asset-endpoint";
  private readonly endpoint: string | null;
  private readonly apiKey: string | null;
  private readonly fetchFn: AssetFetchFn;

  constructor(opts: EndpointAssetProviderOptions = {}) {
    this.endpoint = opts.endpoint?.trim() ? opts.endpoint.trim() : null;
    this.apiKey = opts.apiKey?.trim() ? opts.apiKey.trim() : null;
    this.fetchFn = opts.fetchFn ?? defaultFetch;
  }

  get isConfigured(): boolean {
    return this.endpoint !== null;
  }

  async generate(req: GenerateAssetRequest): Promise<GeneratedImageResult> {
    if (!this.endpoint) {
      throw new AssetGenerationNotConfiguredError(ASSET_NOT_CONFIGURED_MESSAGE);
    }
    let res: AssetFetchResponse;
    try {
      res = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { "x-finch-ai-key": this.apiKey } : {}),
        },
        body: JSON.stringify({
          prompt: req.prompt,
          userPrompt: req.userPrompt,
          kind: req.kind,
          styleFamily: req.style.familyId,
          styleTag: req.style.tag,
          styleGuidance: req.style.promptGuidance,
          look: req.defaults.look,
          background: req.defaults.background,
          width: req.defaults.canvas.width,
          height: req.defaults.canvas.height,
          allowanceScope: req.allowanceScope,
        }),
      });
    } catch {
      throw new AssetGenerationProviderError(
        "The asset generation service could not be reached. Check your connection and try again. No asset was created.",
      );
    }
    if (!res.ok) {
      throw new AssetGenerationProviderError(
        `Asset generation service unavailable (${res.status}). No asset was created.`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AssetGenerationProviderError(
        "The asset generation service returned an unreadable response. No asset was created.",
      );
    }
    const rec = (body ?? {}) as Record<string, unknown>;
    const r2Key = typeof rec.r2Key === "string" && rec.r2Key ? rec.r2Key : undefined;
    const remoteUrl =
      (typeof rec.remoteUrl === "string" && rec.remoteUrl ? rec.remoteUrl : undefined) ??
      (typeof rec.url === "string" && rec.url ? rec.url : undefined);
    if (!r2Key && !remoteUrl) {
      throw new AssetGenerationProviderError(
        "The asset generation service returned no image location. No asset was created.",
      );
    }
    return {
      r2Key,
      remoteUrl,
      width: typeof rec.width === "number" ? rec.width : undefined,
      height: typeof rec.height === "number" ? rec.height : undefined,
      model: typeof rec.model === "string" && rec.model ? rec.model : undefined,
    };
  }
}

/**
 * Build the editor and tooling provider from configuration getters.
 * With no endpoint configured the result is the honest unconfigured
 * binding; callers check `isConfigured` before starting the flow.
 */
export function assetProviderFromConfig(
  getEndpoint: () => string | null | undefined,
  getApiKey?: () => string | null | undefined,
  fetchFn?: AssetFetchFn,
): AssetGenerationProvider {
  const endpoint = getEndpoint()?.trim() ? getEndpoint() : null;
  if (!endpoint) return new UnconfiguredAssetProvider();
  return new EndpointAssetProvider({
    endpoint,
    apiKey: getApiKey?.() ?? null,
    fetchFn,
  });
}
