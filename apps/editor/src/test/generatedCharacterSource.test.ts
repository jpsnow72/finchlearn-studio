/**
 * Generated character source binding (issues #74, #93 and #95,
 * coordinator completion): the rigging wizard's generated source is
 * bound to the AI asset generation service. Unconfigured stays honest;
 * configured produces upload material from the saved generated asset.
 */
import { describe, expect, it } from "vitest";
import {
  UnconfiguredAssetProvider,
  type AssetGenerationProvider,
  type GeneratedImageResult,
  type GeneratedLibraryAsset,
  type MediaLibraryPort,
} from "@finch-studio/ai-assets";
import { CharacterGenerationNotConfiguredError } from "@finch-studio/characters";
import { AiAssetsGeneratedSource } from "../generatedCharacterSource.js";

function fakeLibrary(): { port: MediaLibraryPort; saved: GeneratedLibraryAsset[] } {
  const saved: GeneratedLibraryAsset[] = [];
  return {
    saved,
    port: {
      async save(asset: GeneratedLibraryAsset) {
        saved.push(asset);
        return asset;
      },
    },
  };
}

const configuredProvider: AssetGenerationProvider = {
  providerId: "fake-endpoint",
  isConfigured: true,
  async generate(): Promise<GeneratedImageResult> {
    return {
      remoteUrl: "https://media.example/fox.png",
      width: 1024,
      height: 1024,
      model: "fake-model",
    };
  },
};

describe("AiAssetsGeneratedSource", () => {
  it("reports unconfigured and rejects honestly when the service is off", async () => {
    const { port, saved } = fakeLibrary();
    const source = new AiAssetsGeneratedSource(
      new UnconfiguredAssetProvider(),
      port,
    );
    expect(source.isConfigured).toBe(false);
    await expect(
      source.produce({ kind: "generated", prompt: "A fox teacher" }),
    ).rejects.toBeInstanceOf(CharacterGenerationNotConfiguredError);
    expect(saved).toHaveLength(0);
  });

  it("produces upload material from the generated asset when configured", async () => {
    const { port, saved } = fakeLibrary();
    const source = new AiAssetsGeneratedSource(configuredProvider, port);
    expect(source.isConfigured).toBe(true);
    const material = await source.produce({
      kind: "generated",
      prompt: "A fox teacher",
      template: "spread-pose",
    });
    expect(material).toEqual({
      kind: "upload",
      imageRef: "https://media.example/fox.png",
      width: 1024,
      height: 1024,
    });
    // The generation rode the asset flow: saved with provenance.
    expect(saved).toHaveLength(1);
    expect(saved[0].generated?.origin).toBe("ai-generated");
    expect(saved[0].generated?.providerId).toBe("fake-endpoint");
  });

  it("requests the character kind and passes the style family through", async () => {
    const { port, saved } = fakeLibrary();
    let seenKind = "";
    let seenFamily = "";
    const capturing: AssetGenerationProvider = {
      providerId: "fake-endpoint",
      isConfigured: true,
      async generate(req): Promise<GeneratedImageResult> {
        seenKind = req.kind;
        seenFamily = req.style.familyId;
        return {
          remoteUrl: "https://media.example/fox.png",
          width: 1024,
          height: 1024,
          model: "fake-model",
        };
      },
    };
    const source = new AiAssetsGeneratedSource(capturing, port);
    await source.produce({
      kind: "generated",
      prompt: "A fox teacher",
      styleFamily: "B",
    });
    expect(seenKind).toBe("character");
    expect(seenFamily).toBe("B");
    expect(saved).toHaveLength(1);
    expect(saved[0].generated?.kind).toBe("character");
  });

  it("rejects requests that are not generated requests", async () => {
    const { port } = fakeLibrary();
    const source = new AiAssetsGeneratedSource(configuredProvider, port);
    await expect(
      source.produce({ kind: "upload", imageRef: "x.png", width: 10, height: 10 }),
    ).rejects.toThrow(/cannot produce/);
  });
});
