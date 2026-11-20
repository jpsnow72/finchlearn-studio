/**
 * aiAssets.ts: editor wiring for AI asset generation (issues #93 and #95).
 *
 * Builds the generation provider from the editor build configuration
 * and runs the @finch-studio/ai-assets flow with the editor library
 * surface as the library port. The endpoint and key are read from the
 * build environment variables named VITE_FINCH_AI_ASSET_ENDPOINT and
 * VITE_FINCH_AI_ASSET_API_KEY (secret names only; no values are stored
 * in this repo). When no endpoint is configured the provider reports
 * itself unconfigured and the media panel shows the honest not
 * configured state; no asset is created and nothing is faked.
 *
 * Library: generated assets save into the user media library. The
 * editor library today is the localStorage indexed library the media
 * panel already uses for user uploads (backed by R2 behind the media
 * worker in the cloud library), so generated assets are stored under
 * their own index key in the same shape: full GeneratedLibraryAsset
 * records, provenance included, listed and placeable from the panel.
 *
 * Style contexts: the scene context comes from the characters in the
 * current scene (their rigged cast families, plus a custom character
 * set stamped on a scene object), and the project context from every
 * character in the project plus a custom set recorded on the project.
 * Both ride the x-finch-studio extension conventions; no schema change.
 */
import type { CourseObject, VideoProject, VideoScene } from "@finch-studio/core";
import {
  assetProviderFromConfig,
  generateAndSaveAsset,
  type AssetGenerationProvider,
  type AssetKind,
  type CustomStyleSetRef,
  type ExplicitStyle,
  type GeneratedAssetResult,
  type GeneratedLibraryAsset,
  type MediaLibraryPort,
  type StyleContext,
} from "@finch-studio/ai-assets";
import { characterForLegacyId, type StyleFamilyId } from "@finch-studio/characters";

export function assetGenerationProvider(): AssetGenerationProvider {
  return assetProviderFromConfig(
    () => (import.meta.env.VITE_FINCH_AI_ASSET_ENDPOINT as string | undefined) ?? null,
    () => (import.meta.env.VITE_FINCH_AI_ASSET_API_KEY as string | undefined) ?? null,
  );
}

export function assetGenerationConfigured(): boolean {
  return assetGenerationProvider().isConfigured;
}

// ---------------------------------------------------------------------------
// The editor library surface as a MediaLibraryPort.
// ---------------------------------------------------------------------------

export const GENERATED_MEDIA_KEY = "finch-studio.generated-media";

export function loadGeneratedAssets(): GeneratedLibraryAsset[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(GENERATED_MEDIA_KEY) ?? "[]",
    ) as GeneratedLibraryAsset[];
    return Array.isArray(parsed)
      ? parsed.filter((a) => a && a.generated?.origin === "ai-generated")
      : [];
  } catch {
    return [];
  }
}

/** The library port the generation flow saves through. */
export const localGeneratedLibrary: MediaLibraryPort = {
  async save(asset: GeneratedLibraryAsset): Promise<GeneratedLibraryAsset> {
    const next = [asset, ...loadGeneratedAssets().filter((a) => a.id !== asset.id)];
    try {
      localStorage.setItem(GENERATED_MEDIA_KEY, JSON.stringify(next));
    } catch {
      // Storage full or unavailable: the asset still lands on the stage
      // for this session, like user uploads in the media panel.
    }
    return asset;
  },
};

// ---------------------------------------------------------------------------
// Style contexts from the open project.
// ---------------------------------------------------------------------------

const STUDIO_EXTENSION = "x-finch-studio";

function customSetOf(holder: { extensions?: Record<string, Record<string, unknown>> }): CustomStyleSetRef | undefined {
  const raw = holder.extensions?.[STUDIO_EXTENSION]?.["customCharacterSet"];
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.name !== "string") return undefined;
  return {
    id: rec.id,
    name: rec.name,
    ...(typeof rec.description === "string" ? { description: rec.description } : {}),
  };
}

function contextFromObjects(objects: CourseObject[]): StyleContext {
  const characterFamilies: StyleFamilyId[] = [];
  let customStyleSet: CustomStyleSetRef | undefined;
  for (const object of objects) {
    if (object.type === "character") {
      const char = object as { characterId: string };
      characterFamilies.push(characterForLegacyId(char.characterId).family);
    }
    customStyleSet ??= customSetOf(object as { extensions?: Record<string, Record<string, unknown>> });
  }
  return {
    ...(characterFamilies.length > 0 ? { characterFamilies } : {}),
    ...(customStyleSet ? { customStyleSet } : {}),
  };
}

/** Style context for one scene: its characters and any custom set in it. */
export function sceneStyleContext(scene: VideoScene | undefined): StyleContext {
  if (!scene) return {};
  return contextFromObjects(scene.objects);
}

/** Style context for the whole project, plus a project level custom set. */
export function projectStyleContext(project: VideoProject): StyleContext {
  const merged = contextFromObjects(project.scenes.flatMap((s) => s.objects));
  const projectSet = customSetOf(
    project as { extensions?: Record<string, Record<string, unknown>> },
  );
  return {
    ...merged,
    ...(projectSet ? { customStyleSet: projectSet } : {}),
  };
}

/** The custom character set in use anywhere in the project, when one exists. */
export function projectCustomStyleSet(project: VideoProject): CustomStyleSetRef | undefined {
  return projectStyleContext(project).customStyleSet;
}

// ---------------------------------------------------------------------------
// The generate call the panel makes.
// ---------------------------------------------------------------------------

export async function generateAssetForScene(input: {
  project: VideoProject;
  sceneId: string;
  description: string;
  kind: AssetKind;
  explicitStyle?: ExplicitStyle;
}): Promise<GeneratedAssetResult> {
  const scene = input.project.scenes.find((s) => s.id === input.sceneId);
  return generateAndSaveAsset(
    {
      description: input.description,
      kind: input.kind,
      explicitStyle: input.explicitStyle,
      sceneStyle: sceneStyleContext(scene),
      projectStyle: projectStyleContext(input.project),
    },
    { provider: assetGenerationProvider(), library: localGeneratedLibrary },
  );
}
