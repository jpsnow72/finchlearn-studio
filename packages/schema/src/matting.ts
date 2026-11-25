/**
 * Footage background removal (Studio issue #122, gap G-7): the schema
 * side of the matte model. This mirrors the core in
 * @finch-studio/media videoMatting.ts the way the transcript contract
 * is mirrored between the packages: same shapes, no new dependency.
 *
 * The matte is computed once and stored as an asset, keyed to the
 * source footage plus the model version. The setting itself is
 * non-destructive metadata on the footage element: absent means the
 * footage renders exactly as before. Both render paths composite the
 * stored matte through the media package's one composite function.
 */

export type MatteReplacement =
  | { kind: "color"; color: string }
  | { kind: "image"; assetId: string; r2Key?: string }
  | { kind: "scene-background"; sceneId: string; background?: string };

export type MatteStatus = "processing" | "ready" | "error";

export interface FootageBackgroundRemoval {
  /** Id of the stored matte asset (the media matteCacheKey). */
  matteAssetId?: string;
  /** R2 key of the stored alpha matte asset. */
  matteR2Key?: string;
  /** Matte service job id that produced the matte, when it came from one. */
  matteJobId?: string;
  /** Per job token for the matte service file route, paired with matteJobId. */
  matteJobToken?: string;
  /** Model that produced the matte, for example rvm-mobilenetv3-1.0.0. */
  modelVersion: string;
  replacement: MatteReplacement;
  status: MatteStatus;
  /** Last failure message when status is error, shown in the panel. */
  error?: string;
}

export const DEFAULT_MATTE_MODEL_VERSION = "rvm-mobilenetv3-1.0.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an unknown value into a background removal setting, or null. */
export function normalizeBackgroundRemoval(value: unknown): FootageBackgroundRemoval | null {
  if (!isRecord(value) || !isRecord(value.replacement)) return null;
  const rep = value.replacement;
  let replacement: MatteReplacement | null = null;
  if (rep.kind === "color" && typeof rep.color === "string") {
    replacement = { kind: "color", color: rep.color };
  } else if (rep.kind === "image" && typeof rep.assetId === "string") {
    replacement = { kind: "image", assetId: rep.assetId, r2Key: typeof rep.r2Key === "string" ? rep.r2Key : undefined };
  } else if (rep.kind === "scene-background" && typeof rep.sceneId === "string") {
    replacement = { kind: "scene-background", sceneId: rep.sceneId, background: typeof rep.background === "string" ? rep.background : undefined };
  }
  if (!replacement) return null;
  const status = value.status === "ready" || value.status === "error" ? value.status : "processing";
  return {
    matteAssetId: typeof value.matteAssetId === "string" ? value.matteAssetId : undefined,
    matteR2Key: typeof value.matteR2Key === "string" ? value.matteR2Key : undefined,
    matteJobId: typeof value.matteJobId === "string" ? value.matteJobId : undefined,
    matteJobToken: typeof value.matteJobToken === "string" ? value.matteJobToken : undefined,
    modelVersion: typeof value.modelVersion === "string" ? value.modelVersion : DEFAULT_MATTE_MODEL_VERSION,
    replacement,
    status,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

/** True only when a stored matte exists and can be composited. */
export function isBackgroundRemovalReady(removal: FootageBackgroundRemoval | null | undefined): boolean {
  return Boolean(removal && removal.status === "ready" && removal.matteR2Key);
}
