/**
 * generatedCharacterSource.ts: the compose-time binding of the rigging
 * wizard's "generated" character source (issue #74) to the AI asset
 * generation service (issues #93 and #95).
 *
 * The characters package ships the source port as a seam
 * (UnconfiguredGeneratedSource) because image generation does not live
 * in that package. Here in the editor, the port is bound to the real
 * generation flow: a generated character is a generated image asset
 * (kind "prop": flat vector look, transparent background, square
 * canvas) produced by generateAndSaveAsset through the configured
 * asset provider and saved into the generated media library with its
 * provenance stamp, exactly like a generated prop. The returned source
 * material is the image as an "upload", so the wizard rigs it through
 * the same pin flow as an uploaded PNG.
 *
 * Honest configuration state: the binding is configured exactly when
 * the asset generation provider is, which today means the build
 * carries VITE_FINCH_AI_ASSET_ENDPOINT. Until then isConfigured is
 * false and produce rejects with CharacterGenerationNotConfiguredError
 * before any provider call; nothing fakes a character.
 */
import {
  generateAndSaveAsset,
  outputDefaultsForKind,
  type AssetGenerationProvider,
  type MediaLibraryPort,
} from "@finch-studio/ai-assets";
import {
  CharacterGenerationNotConfiguredError,
  GENERATION_NOT_CONFIGURED_MESSAGE,
  type CharacterSourceMaterial,
  type CharacterSourcePort,
  type CharacterSourceRequest,
} from "@finch-studio/characters";
import { assetGenerationProvider, localGeneratedLibrary } from "./aiAssets";

export class AiAssetsGeneratedSource implements CharacterSourcePort {
  readonly kind = "generated" as const;
  readonly providerId = "ai-assets";
  private readonly provider: AssetGenerationProvider;
  private readonly library: MediaLibraryPort;

  constructor(
    provider: AssetGenerationProvider = assetGenerationProvider(),
    library: MediaLibraryPort = localGeneratedLibrary,
  ) {
    this.provider = provider;
    this.library = library;
  }

  get isConfigured(): boolean {
    return this.provider.isConfigured;
  }

  async produce(
    request: CharacterSourceRequest,
  ): Promise<CharacterSourceMaterial> {
    if (request.kind !== "generated") {
      throw new Error(
        `The generated character source cannot produce a "${request.kind}" request.`,
      );
    }
    if (!this.provider.isConfigured) {
      throw new CharacterGenerationNotConfiguredError(
        GENERATION_NOT_CONFIGURED_MESSAGE,
      );
    }
    const description = request.template
      ? `${request.prompt}, ${request.template} pose`
      : request.prompt;
    const result = await generateAndSaveAsset(
      { description, kind: "prop" },
      { provider: this.provider, library: this.library },
    );
    const asset = result.asset;
    const imageRef = asset.remoteUrl ?? asset.r2Key;
    if (!imageRef) {
      throw new Error(
        "Generation returned without an image. Nothing was created.",
      );
    }
    const canvas = outputDefaultsForKind("prop").canvas;
    return {
      kind: "upload",
      imageRef,
      width: asset.width ?? canvas.width,
      height: asset.height ?? canvas.height,
    };
  }
}

/** The binding the rigging wizard uses for its AI generate tab. */
export const generatedCharacterSource = new AiAssetsGeneratedSource();
