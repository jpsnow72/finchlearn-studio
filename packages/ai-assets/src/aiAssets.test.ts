import { describe, expect, it } from "vitest";
import type { CourseObject } from "@finch-studio/core";
import {
  AI_ALLOWANCE_SCOPE,
  AssetAllowanceError,
  AssetGenerationNotConfiguredError,
  AssetGenerationProviderError,
  AssetGenerationDenialError,
  EndpointAssetProvider,
  UnconfiguredAssetProvider,
  assetProviderFromConfig,
  buildEffectivePrompt,
  generateAndSaveAsset,
  generatedAssetIdOf,
  generatedCredit,
  isGeneratedAsset,
  makeGeneratedAssetObject,
  outputDefaultsForKind,
  resolveStyleFamily,
  type AiAllowancePort,
  type AssetFetchInit,
  type AssetFetchResponse,
  type AssetGenerationProvider,
  type GenerateAssetRequest,
  type GeneratedImageResult,
  type GeneratedLibraryAsset,
  type MediaLibraryPort,
} from "./index.js";

class FakeProvider implements AssetGenerationProvider {
  readonly providerId = "fake-image";
  readonly isConfigured = true;
  readonly calls: GenerateAssetRequest[] = [];
  result: GeneratedImageResult = {
    r2Key: "u/user-1/generated/lamp.png",
    width: 1024,
    height: 1024,
    model: "fake-model-1",
  };
  async generate(req: GenerateAssetRequest): Promise<GeneratedImageResult> {
    this.calls.push(req);
    return this.result;
  }
}

class MemoryLibrary implements MediaLibraryPort {
  readonly saved: GeneratedLibraryAsset[] = [];
  async save(asset: GeneratedLibraryAsset): Promise<GeneratedLibraryAsset> {
    this.saved.push(asset);
    return asset;
  }
}

const allowAll: AiAllowancePort = {
  checkAllowance: async () => ({ allowed: true, remaining: 42 }),
};

function deps(overrides: Partial<Parameters<typeof generateAndSaveAsset>[1]> = {}) {
  return {
    provider: new FakeProvider(),
    library: new MemoryLibrary(),
    now: () => "2026-11-19T12:00:00.000Z",
    makeId: () => "gen-test-1",
    ...overrides,
  };
}

describe("style family resolution", () => {
  it("defaults to the scene character family", () => {
    const style = resolveStyleFamily({
      scene: { characterFamilies: ["B", "B", "A"] },
      project: { characterFamilies: ["A"] },
    });
    expect(style.familyId).toBe("B");
    expect(style.familyName).toBe("Warm Storybook Soft");
    expect(style.source).toBe("scene");
    expect(style.tag).toBe("style-b-warm-storybook");
  });

  it("falls back to the project family when the scene has no characters", () => {
    const style = resolveStyleFamily({
      scene: { characterFamilies: [] },
      project: { characterFamilies: ["D", "A", "D"] },
    });
    expect(style.familyId).toBe("D");
    expect(style.familyName).toBe("Bold Ink Editorial");
    expect(style.source).toBe("project");
  });

  it("an explicit pick overrides scene and project defaults", () => {
    const style = resolveStyleFamily({
      explicit: { family: "D" },
      scene: { characterFamilies: ["B"] },
      project: { characterFamilies: ["A"] },
    });
    expect(style.familyId).toBe("D");
    expect(style.source).toBe("explicit");
  });

  it("resolves the style of a custom character set from the scene", () => {
    const set = { id: "harbour-crew", name: "Harbour Crew", description: "teal ink, round helmets" };
    const style = resolveStyleFamily({
      scene: { characterFamilies: ["A"], customStyleSet: set },
      project: { characterFamilies: ["B"] },
    });
    expect(style.familyId).toBe("custom");
    expect(style.familyName).toBe("Harbour Crew");
    expect(style.tag).toBe("style-custom-harbour-crew");
    expect(style.promptGuidance).toContain("teal ink, round helmets");
    expect(style.source).toBe("scene");
  });

  it("an explicit custom set wins, and a bare project falls back to Direction A", () => {
    const set = { id: "crew", name: "Crew" };
    expect(
      resolveStyleFamily({ explicit: { customSet: set }, scene: { characterFamilies: ["B"] } })
        .familyId,
    ).toBe("custom");
    const fallback = resolveStyleFamily({});
    expect(fallback.familyId).toBe("A");
    expect(fallback.source).toBe("default");
  });
});

describe("baked in output defaults", () => {
  it("props and objects are flat vector on a transparent background", () => {
    for (const kind of ["prop", "object"] as const) {
      const d = outputDefaultsForKind(kind);
      expect(d.look).toBe("flat-vector");
      expect(d.background).toBe("transparent");
      expect(d.placement).toEqual({ x: 480, y: 200, w: 320, h: 320 });
    }
  });

  it("backgrounds are full bleed rectangles sized for the stage", () => {
    const d = outputDefaultsForKind("background");
    expect(d.look).toBe("flat-vector");
    expect(d.background).toBe("full-bleed");
    expect(d.canvas).toEqual({ width: 1280, height: 720 });
    expect(d.placement).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it("characters share the prop canvas defaults (flat vector, transparent, square)", () => {
    const d = outputDefaultsForKind("character");
    expect(d.look).toBe("flat-vector");
    expect(d.background).toBe("transparent");
    expect(d.canvas).toEqual({ width: 1024, height: 1024 });
  });

  it("the character prompt bakes in the rigging format rules", () => {
    const style = resolveStyleFamily({});
    const prompt = buildEffectivePrompt(
      "a fox teacher",
      style,
      outputDefaultsForKind("character"),
      "character",
    );
    expect(prompt).toContain("spread pose");
    expect(prompt).toContain("every joint clearly visible");
    expect(prompt).toContain("nothing overlapping the joints");
  });

  it("the effective prompt bakes in style, look, and background handling", () => {
    const style = resolveStyleFamily({ explicit: { family: "B" } });
    const propPrompt = buildEffectivePrompt("a brass desk lamp", style, outputDefaultsForKind("prop"));
    expect(propPrompt).toContain("a brass desk lamp");
    expect(propPrompt).toContain("Warm Storybook Soft");
    expect(propPrompt).toContain("transparent background");
    const bgPrompt = buildEffectivePrompt("a harbour office", style, outputDefaultsForKind("background"));
    expect(bgPrompt).toContain("full bleed");
    expect(bgPrompt).not.toContain("transparent background");
  });
});

describe("generate and save flow", () => {
  it("saves into the library with a style tag and a provenance stamp", async () => {
    const library = new MemoryLibrary();
    const provider = new FakeProvider();
    const { asset, report } = await generateAndSaveAsset(
      { description: "a brass desk lamp", kind: "prop", sceneStyle: { characterFamilies: ["B"] } },
      deps({ library, provider, allowance: allowAll }),
    );
    expect(library.saved).toHaveLength(1);
    expect(asset).toBe(library.saved[0]);
    expect(asset.source).toBe("user");
    expect(asset.kind).toBe("image");
    expect(asset.r2Key).toBe("u/user-1/generated/lamp.png");
    expect(asset.tags).toContain("ai-generated");
    expect(asset.tags).toContain("style-b-warm-storybook");
    expect(asset.tags).toContain("prop");
    expect(isGeneratedAsset(asset)).toBe(true);
    expect(asset.generated.origin).toBe("ai-generated");
    expect(asset.generated.providerId).toBe("fake-image");
    expect(asset.generated.model).toBe("fake-model-1");
    expect(asset.generated.prompt).toBe("a brass desk lamp");
    expect(asset.generated.styleFamily).toBe("B");
    expect(asset.generated.allowanceScope).toBe(AI_ALLOWANCE_SCOPE);
    expect(asset.generated.generatedAt).toBe("2026-11-19T12:00:00.000Z");
    expect(asset.credit).toBe(generatedCredit(asset.generated));
    expect(asset.credit).toContain("AI generated in FinchLearn Studio");
    expect(report.allowanceRemaining).toBe(42);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].allowanceScope).toBe(AI_ALLOWANCE_SCOPE);
    expect(provider.calls[0].defaults.background).toBe("transparent");
    expect(provider.calls[0].prompt).toContain("a brass desk lamp");
  });

  it("backgrounds save with the full bleed defaults", async () => {
    const provider = new FakeProvider();
    provider.result = { remoteUrl: "https://media.example/harbour.png", width: 1280, height: 720 };
    const { asset, object } = await generateAndSaveAsset(
      { description: "a harbour office at dawn", kind: "background" },
      deps({ provider }),
    );
    expect(provider.calls[0].defaults.background).toBe("full-bleed");
    expect(provider.calls[0].defaults.canvas).toEqual({ width: 1280, height: 720 });
    expect(asset.tags).toContain("background");
    const placed = object as CourseObject & { position: { w: number; h: number } };
    expect(placed.position).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it("fails honestly when the provider is unconfigured, before allowance or save", async () => {
    const library = new MemoryLibrary();
    let allowanceChecked = false;
    const allowance: AiAllowancePort = {
      checkAllowance: async () => {
        allowanceChecked = true;
        return { allowed: true };
      },
    };
    await expect(
      generateAndSaveAsset(
        { description: "a lamp", kind: "prop" },
        deps({ provider: new UnconfiguredAssetProvider(), library, allowance }),
      ),
    ).rejects.toBeInstanceOf(AssetGenerationNotConfiguredError);
    expect(library.saved).toHaveLength(0);
    expect(allowanceChecked).toBe(false);
  });

  it("a denied allowance stops generation and saves nothing", async () => {
    const library = new MemoryLibrary();
    const provider = new FakeProvider();
    const deny: AiAllowancePort = {
      checkAllowance: async () => ({ allowed: false, message: "Allowance used up for now." }),
    };
    await expect(
      generateAndSaveAsset(
        { description: "a lamp", kind: "prop" },
        deps({ provider, library, allowance: deny }),
      ),
    ).rejects.toBeInstanceOf(AssetAllowanceError);
    expect(provider.calls).toHaveLength(0);
    expect(library.saved).toHaveLength(0);
  });

  it("rejects an empty description and a result with no image location", async () => {
    await expect(
      generateAndSaveAsset({ description: "   ", kind: "prop" }, deps()),
    ).rejects.toThrow(/Describe the asset/);
    const provider = new FakeProvider();
    provider.result = {};
    await expect(
      generateAndSaveAsset({ description: "a lamp", kind: "prop" }, deps({ provider })),
    ).rejects.toBeInstanceOf(AssetGenerationProviderError);
  });

  it("the endpoint binding sends the user token and an idempotency key", async () => {
    let seenInit: AssetFetchInit | undefined;
    const provider = new EndpointAssetProvider({
      endpoint: "https://ai.example/generate",
      getAuthToken: async () => "user-token-123",
      makeIdempotencyKey: () => "idem-abc",
      fetchFn: async (_url, init) => {
        seenInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ remoteUrl: "https://img.example/x.png" }),
        } as AssetFetchResponse;
      },
    });
    await provider.generate({
      userPrompt: "x",
      prompt: "x",
      kind: "character",
      style: resolveStyleFamily({}),
      defaults: outputDefaultsForKind("character"),
      allowanceScope: AI_ALLOWANCE_SCOPE,
    });
    expect(seenInit?.headers.authorization).toBe("Bearer user-token-123");
    const body = JSON.parse(String(seenInit?.body)) as Record<string, unknown>;
    expect(body.idempotencyKey).toBe("idem-abc");
    expect(body.kind).toBe("character");
  });

  it("the endpoint binding surfaces an allowance denial with the service's specific message", async () => {
    const provider = new EndpointAssetProvider({
      endpoint: "https://ai.example/generate",
      fetchFn: async () =>
        ({
          ok: false,
          status: 402,
          json: async () => ({
            error: "Monthly AI allowance used (10 content generations).",
            code: "allowance_exhausted",
            quota: { allowance: 10, used: 10, resetsAt: "2026-12-01T00:00:00.000Z" },
          }),
        }) as AssetFetchResponse,
    });
    const err = await provider
      .generate({
        userPrompt: "x",
        prompt: "x",
        kind: "prop",
        style: resolveStyleFamily({}),
        defaults: outputDefaultsForKind("prop"),
        allowanceScope: AI_ALLOWANCE_SCOPE,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssetGenerationDenialError);
    expect((err as Error).message).toContain(
      "Monthly AI allowance used (10 content generations).",
    );
    expect((err as AssetGenerationDenialError).resetsAt).toBe(
      "2026-12-01T00:00:00.000Z",
    );
  });

  it("the endpoint binding reads a not-configured service as not configured", async () => {
    const provider = new EndpointAssetProvider({
      endpoint: "https://ai.example/generate",
      fetchFn: async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({
            error: "AI generation is not switched on yet.",
            code: "generation_not_configured",
          }),
        }) as AssetFetchResponse,
    });
    await expect(
      provider.generate({
        userPrompt: "x",
        prompt: "x",
        kind: "prop",
        style: resolveStyleFamily({}),
        defaults: outputDefaultsForKind("prop"),
        allowanceScope: AI_ALLOWANCE_SCOPE,
      }),
    ).rejects.toBeInstanceOf(AssetGenerationNotConfiguredError);
  });
});

describe("first class placement", () => {
  it("a generated prop lands as a normal movable image object with provenance metadata", async () => {
    const { asset, object } = await generateAndSaveAsset(
      { description: "a brass desk lamp", kind: "prop" },
      deps(),
    );
    expect(object.type).toBe("image");
    const placed = object as CourseObject & {
      resource: string;
      position: { x: number; y: number; w: number; h: number };
    };
    expect(placed.resource).toBe("u/user-1/generated/lamp.png");
    expect(placed.position).toEqual({ x: 480, y: 200, w: 320, h: 320 });
    expect(generatedAssetIdOf(object)).toBe(asset.id);
    const meta = object.extensions?.["x-finch-studio"];
    expect(meta?.provenance).toBe("ai-generated");
    expect(meta?.styleTag).toBe("style-a-clean-flat");
    // A fresh placement of the same library asset gets its own object id.
    const again = makeGeneratedAssetObject(asset);
    expect(again.id).not.toBe(object.id);
    expect(generatedAssetIdOf(again)).toBe(asset.id);
  });
});

describe("provider bindings", () => {
  it("the unconfigured binding reports itself honestly and throws", async () => {
    const provider = new UnconfiguredAssetProvider();
    expect(provider.isConfigured).toBe(false);
    await expect(
      provider.generate({
        userPrompt: "x",
        prompt: "x",
        kind: "prop",
        style: resolveStyleFamily({}),
        defaults: outputDefaultsForKind("prop"),
        allowanceScope: AI_ALLOWANCE_SCOPE,
      }),
    ).rejects.toBeInstanceOf(AssetGenerationNotConfiguredError);
    expect(assetProviderFromConfig(() => null).isConfigured).toBe(false);
    expect(assetProviderFromConfig(() => "https://ai.example/generate").isConfigured).toBe(true);
  });

  it("the endpoint binding posts the baked request and reads the image location", async () => {
    let seenUrl = "";
    let seenInit: AssetFetchInit | undefined;
    const provider = new EndpointAssetProvider({
      endpoint: "https://ai.example/generate",
      apiKey: "test-key-value-not-a-real-secret",
      fetchFn: async (url, init) => {
        seenUrl = url;
        seenInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ r2Key: "u/u1/gen.png", width: 1024, height: 1024, model: "m1" }),
        } as AssetFetchResponse;
      },
    });
    expect(provider.isConfigured).toBe(true);
    const style = resolveStyleFamily({ explicit: { family: "D" } });
    const out = await provider.generate({
      userPrompt: "a warning sign",
      prompt: "effective",
      kind: "prop",
      style,
      defaults: outputDefaultsForKind("prop"),
      allowanceScope: AI_ALLOWANCE_SCOPE,
    });
    expect(out.r2Key).toBe("u/u1/gen.png");
    expect(out.model).toBe("m1");
    expect(seenUrl).toBe("https://ai.example/generate");
    expect(seenUrl).not.toContain("test-key-value");
    const body = JSON.parse(String(seenInit?.body)) as Record<string, unknown>;
    expect(body.styleFamily).toBe("D");
    expect(body.background).toBe("transparent");
    expect(body.allowanceScope).toBe(AI_ALLOWANCE_SCOPE);
    expect(seenInit?.headers["x-finch-ai-key"]).toBe("test-key-value-not-a-real-secret");
  });

  it("the endpoint binding throws a provider error on failure, never fakes output", async () => {
    const provider = new EndpointAssetProvider({
      endpoint: "https://ai.example/generate",
      fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) }) as AssetFetchResponse,
    });
    await expect(
      provider.generate({
        userPrompt: "x",
        prompt: "x",
        kind: "prop",
        style: resolveStyleFamily({}),
        defaults: outputDefaultsForKind("prop"),
        allowanceScope: AI_ALLOWANCE_SCOPE,
      }),
    ).rejects.toBeInstanceOf(AssetGenerationProviderError);
  });
});
