/**
 * generation.ts: the generate and save flow (issues #93 and #95).
 *
 * One flow, in order:
 *   1. resolve the target style family (styles.ts),
 *   2. bake in the output defaults for the asset kind (never asked:
 *      flat vector look, transparent background for props and objects,
 *      a full bleed rectangle for backgrounds, sized for the stage),
 *   3. refuse honestly when the provider is not configured,
 *   4. check the existing FinchLearn AI allowance through an injected
 *      port when the caller supplies one (no new credit system; the
 *      enforcing service also counts server side),
 *   5. generate through the provider port,
 *   6. stamp provenance in the same discipline as stock assets (a
 *      credit line on the asset, plus a structured provenance record)
 *      and save into the user media library through an injected port
 *      over the existing @finch-studio/media library model,
 *   7. build the first class stage object: a normal image object, so
 *      generated props move, resize, animate, and export exactly like
 *      stock placements, with provenance in its x-finch-studio
 *      extension metadata, the same slot bundled props use.
 *
 * Asset metadata rides the existing media library model: a generated
 * asset is a MediaAsset with source "user" (the signed in user's R2
 * library) plus one additive `generated` record. No schema change.
 */
import type { CourseObject } from "@finch-studio/core";
import type { MediaAsset } from "@finch-studio/media";
import {
  AI_ALLOWANCE_SCOPE,
  AssetGenerationNotConfiguredError,
  AssetGenerationProviderError,
  ASSET_NOT_CONFIGURED_MESSAGE,
  type AssetGenerationProvider,
  type GenerateAssetRequest,
  type GeneratedImageResult,
} from "./provider.js";
import {
  resolveStyleFamily,
  type ExplicitStyle,
  type ResolvedStyle,
  type StyleContext,
} from "./styles.js";

export type AssetKind = "prop" | "object" | "background";

/** The Studio stage size every output default is sized against. */
export const STAGE_SIZE = { width: 1280, height: 720 } as const;

export interface AssetOutputDefaults {
  /** Always the flat vector look; never a user choice. */
  look: "flat-vector";
  /** Transparent for props and objects, full bleed for backgrounds. */
  background: "transparent" | "full-bleed";
  /** Generation canvas, sized for the stage. */
  canvas: { width: number; height: number };
  /** Default placement on the 1280 by 720 stage, in scene pixels. */
  placement: { x: number; y: number; w: number; h: number };
}

/** Baked in output defaults per asset kind. The user is never asked. */
export function outputDefaultsForKind(kind: AssetKind): AssetOutputDefaults {
  if (kind === "background") {
    return {
      look: "flat-vector",
      background: "full-bleed",
      canvas: { width: STAGE_SIZE.width, height: STAGE_SIZE.height },
      placement: { x: 0, y: 0, w: STAGE_SIZE.width, h: STAGE_SIZE.height },
    };
  }
  return {
    look: "flat-vector",
    background: "transparent",
    canvas: { width: 1024, height: 1024 },
    placement: { x: 480, y: 200, w: 320, h: 320 },
  };
}

/** Build the effective prompt: the user's words plus style and defaults. */
export function buildEffectivePrompt(
  userPrompt: string,
  style: ResolvedStyle,
  defaults: AssetOutputDefaults,
): string {
  const backgroundLine =
    defaults.background === "transparent"
      ? "Isolated on a fully transparent background, no backdrop, no floor, no shadow catcher"
      : "A full bleed rectangular scene background filling the whole frame edge to edge, no border, no vignette";
  return [
    userPrompt.trim(),
    style.promptGuidance,
    "Flat vector illustration look",
    backgroundLine,
    "No text, no words, no letters, no watermark",
  ].join(". ");
}

// ---------------------------------------------------------------------------
// Provenance (issue #95): the stock asset discipline, for generated art.
// ---------------------------------------------------------------------------

export interface GeneratedProvenance {
  origin: "ai-generated";
  providerId: string;
  model?: string;
  /** The user's plain words description that produced this asset. */
  prompt: string;
  kind: AssetKind;
  styleFamily: ResolvedStyle["familyId"];
  styleName: string;
  styleTag: string;
  /** Always the existing FinchLearn AI allowance scope. */
  allowanceScope: typeof AI_ALLOWANCE_SCOPE;
  generatedAt: string;
}

/** A library asset for a generated image: a MediaAsset plus provenance. */
export interface GeneratedLibraryAsset extends MediaAsset {
  generated: GeneratedProvenance;
}

/** The provenance credit line, stamped on the asset like a stock credit. */
export function generatedCredit(provenance: GeneratedProvenance): string {
  return (
    `AI generated in FinchLearn Studio (${provenance.styleName}) ` +
    `from the description "${provenance.prompt}"`
  );
}

export function isGeneratedAsset(asset: MediaAsset): asset is GeneratedLibraryAsset {
  const rec = (asset as GeneratedLibraryAsset).generated;
  return Boolean(rec && rec.origin === "ai-generated");
}

// ---------------------------------------------------------------------------
// Ports the flow rides: the user media library and the AI allowance.
// ---------------------------------------------------------------------------

/**
 * The user media library port. The editor adapts its library surface
 * (the localStorage indexed library the media panel already uses,
 * backed by R2 behind the media worker in the cloud library); tests
 * and tooling adapt their own. Saving returns the stored asset.
 */
export interface MediaLibraryPort {
  save(asset: GeneratedLibraryAsset): Promise<GeneratedLibraryAsset>;
}

/** A verdict from the existing FinchLearn AI allowance. */
export interface AllowanceVerdict {
  allowed: boolean;
  /** Generous plain counter remainder, when the checker reports one. */
  remaining?: number;
  /** Plain language reason when not allowed. */
  message?: string;
}

/**
 * The allowance port: an injected check against the existing
 * FinchLearn AI allowance model (plain counters, no expiring credits,
 * no new credit system in this package). When no checker is supplied
 * the enforcing generation service still counts server side.
 */
export interface AiAllowancePort {
  checkAllowance(scope: typeof AI_ALLOWANCE_SCOPE): Promise<AllowanceVerdict>;
}

/** The allowance said no; nothing was generated and nothing was saved. */
export class AssetAllowanceError extends Error {
  readonly code = "asset-allowance-denied";
  constructor(message: string) {
    super(message);
    this.name = "AssetAllowanceError";
  }
}

/** The request itself is unusable (for example an empty description). */
export class AssetRequestError extends Error {
  readonly code = "asset-request-invalid";
  constructor(message: string) {
    super(message);
    this.name = "AssetRequestError";
  }
}

// ---------------------------------------------------------------------------
// The flow.
// ---------------------------------------------------------------------------

export interface GenerateAssetInput {
  /** The user's plain words description of the asset. */
  description: string;
  kind: AssetKind;
  /** Display name; defaults to the description. */
  name?: string;
  explicitStyle?: ExplicitStyle;
  sceneStyle?: StyleContext;
  projectStyle?: StyleContext;
}

export interface GenerateAssetDeps {
  provider: AssetGenerationProvider;
  library: MediaLibraryPort;
  allowance?: AiAllowancePort;
  /** Injectable clock and id source for deterministic tests. */
  now?: () => string;
  makeId?: (provenance: GeneratedProvenance) => string;
}

export interface GeneratedAssetReport {
  providerId: string;
  style: ResolvedStyle;
  defaults: AssetOutputDefaults;
  credit: string;
  allowanceRemaining?: number;
}

export interface GeneratedAssetResult {
  asset: GeneratedLibraryAsset;
  /** The first class stage object for the asset (see below). */
  object: CourseObject;
  report: GeneratedAssetReport;
}

let assetCounter = 0;
function defaultAssetId(): string {
  assetCounter += 1;
  return `gen-${Date.now().toString(36)}-${assetCounter}`;
}

/** Build the library asset for a provider result, provenance stamped. */
export function buildLibraryAsset(
  result: GeneratedImageResult,
  input: {
    description: string;
    name?: string;
    kind: AssetKind;
    style: ResolvedStyle;
    providerId: string;
    generatedAt: string;
    id: string;
  },
): GeneratedLibraryAsset {
  const provenance: GeneratedProvenance = {
    origin: "ai-generated",
    providerId: input.providerId,
    ...(result.model ? { model: result.model } : {}),
    prompt: input.description,
    kind: input.kind,
    styleFamily: input.style.familyId,
    styleName: input.style.familyName,
    styleTag: input.style.tag,
    allowanceScope: AI_ALLOWANCE_SCOPE,
    generatedAt: input.generatedAt,
  };
  const name = (input.name ?? "").trim() || input.description;
  return {
    id: input.id,
    source: "user",
    ...(result.r2Key ? { r2Key: result.r2Key } : {}),
    ...(result.remoteUrl ? { remoteUrl: result.remoteUrl } : {}),
    kind: "image",
    name,
    ...(result.width ? { width: result.width } : {}),
    ...(result.height ? { height: result.height } : {}),
    credit: generatedCredit(provenance),
    tags: ["ai-generated", input.style.tag, input.kind],
    generated: provenance,
  };
}

/**
 * Generate one asset and save it into the user media library.
 * Throws AssetGenerationNotConfiguredError before any allowance check
 * or provider call when the binding is unconfigured, and
 * AssetAllowanceError before any provider call when the allowance
 * denies. On any failure nothing is saved.
 */
export async function generateAndSaveAsset(
  input: GenerateAssetInput,
  deps: GenerateAssetDeps,
): Promise<GeneratedAssetResult> {
  const description = input.description.trim();
  if (!description) {
    throw new AssetRequestError("Describe the asset in plain words first.");
  }
  const style = resolveStyleFamily({
    explicit: input.explicitStyle,
    scene: input.sceneStyle,
    project: input.projectStyle,
  });
  const defaults = outputDefaultsForKind(input.kind);

  if (!deps.provider.isConfigured) {
    throw new AssetGenerationNotConfiguredError(ASSET_NOT_CONFIGURED_MESSAGE);
  }

  let allowanceRemaining: number | undefined;
  if (deps.allowance) {
    const verdict = await deps.allowance.checkAllowance(AI_ALLOWANCE_SCOPE);
    if (!verdict.allowed) {
      throw new AssetAllowanceError(
        verdict.message ??
          "Your FinchLearn AI allowance does not cover this generation right now. No asset was created.",
      );
    }
    allowanceRemaining = verdict.remaining;
  }

  const request: GenerateAssetRequest = {
    userPrompt: description,
    prompt: buildEffectivePrompt(description, style, defaults),
    kind: input.kind,
    style,
    defaults,
    allowanceScope: AI_ALLOWANCE_SCOPE,
  };
  const result = await deps.provider.generate(request);
  if (!result.r2Key && !result.remoteUrl) {
    throw new AssetGenerationProviderError(
      "The asset generation service returned no image location. No asset was created.",
    );
  }

  const generatedAt = (deps.now ?? (() => new Date().toISOString()))();
  const provenanceDraft: GeneratedProvenance = {
    origin: "ai-generated",
    providerId: deps.provider.providerId,
    ...(result.model ? { model: result.model } : {}),
    prompt: description,
    kind: input.kind,
    styleFamily: style.familyId,
    styleName: style.familyName,
    styleTag: style.tag,
    allowanceScope: AI_ALLOWANCE_SCOPE,
    generatedAt,
  };
  const asset = buildLibraryAsset(result, {
    description,
    name: input.name,
    kind: input.kind,
    style,
    providerId: deps.provider.providerId,
    generatedAt,
    id: deps.makeId ? deps.makeId(provenanceDraft) : defaultAssetId(),
  });
  const saved = await deps.library.save(asset);
  return {
    asset: saved,
    object: makeGeneratedAssetObject(saved),
    report: {
      providerId: deps.provider.providerId,
      style,
      defaults,
      credit: saved.credit ?? generatedCredit(saved.generated),
      ...(allowanceRemaining !== undefined ? { allowanceRemaining } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// First class placement: generated assets on the stage.
// ---------------------------------------------------------------------------

let objectCounter = 0;

/**
 * Create the scene object for a generated library asset. An image
 * object carrying the asset location, exactly like a stock placement,
 * so it is movable, resizable, animatable through the existing motion
 * and effects system, and drawn by the stage and export renderers.
 * Provenance is stamped into the studio extension metadata, the same
 * slot bundled props use. Backgrounds place full bleed over the stage.
 */
export function makeGeneratedAssetObject(asset: GeneratedLibraryAsset): CourseObject {
  objectCounter += 1;
  const defaults = outputDefaultsForKind(asset.generated.kind);
  const resource = asset.remoteUrl ?? asset.r2Key ?? "";
  return {
    id: `genobj-${Date.now().toString(36)}-${objectCounter}`,
    type: "image",
    name: asset.credit ? `${asset.name} (${asset.credit})` : asset.name,
    position: { ...defaults.placement },
    resource,
    extensions: {
      "x-finch-studio": {
        generatedAssetId: asset.id,
        generatedKind: asset.generated.kind,
        provenance: asset.generated.origin,
        providerId: asset.generated.providerId,
        styleFamily: asset.generated.styleFamily,
        styleTag: asset.generated.styleTag,
        credit: asset.credit ?? generatedCredit(asset.generated),
      },
    },
  } as unknown as CourseObject;
}

/** The generated asset id a placed object came from, when it has one. */
export function generatedAssetIdOf(object: CourseObject): string | undefined {
  const meta = (object as { extensions?: Record<string, Record<string, unknown>> })
    .extensions?.["x-finch-studio"];
  const id = meta?.["generatedAssetId"];
  return typeof id === "string" && id ? id : undefined;
}
