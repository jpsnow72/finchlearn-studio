// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLibraryAsset,
  makeGeneratedAssetObject,
  resolveStyleFamily,
} from "@finch-studio/ai-assets";
import {
  GENERATED_MEDIA_KEY,
  loadGeneratedAssets,
  localGeneratedLibrary,
  projectStyleContext,
  sceneStyleContext,
} from "../aiAssets.js";
import { makeStudioCharacter, useStudioStore } from "../store.js";
import type { VideoProject } from "@finch-studio/core";

function projectWithCharacters(): VideoProject {
  return {
    id: "proj-1",
    name: "Harbour Safety",
    scenes: [
      {
        id: "scene-1",
        name: "Intro",
        durationMs: 5000,
        transition: "cut",
        objects: [
          // Rosa and Walter are family B in the rigged cast.
          { id: "c1", type: "character", characterId: "casualWoman" },
          { id: "c2", type: "character", characterId: "professor" },
        ],
      },
      {
        id: "scene-2",
        name: "Detail",
        durationMs: 5000,
        transition: "cut",
        objects: [{ id: "c3", type: "character", characterId: "businesswoman" }],
      },
    ],
  } as unknown as VideoProject;
}

const sampleAsset = buildLibraryAsset(
  { r2Key: "u/u1/lamp.png", width: 1024, height: 1024, model: "m1" },
  {
    description: "a brass desk lamp",
    kind: "prop",
    style: resolveStyleFamily({ explicit: { family: "B" } }),
    providerId: "fake-image",
    generatedAt: "2026-11-19T12:00:00.000Z",
    id: "gen-1",
  },
);

describe("editor style contexts", () => {
  it("the scene context follows the characters in the scene", () => {
    const project = projectWithCharacters();
    const ctx = sceneStyleContext(project.scenes[0]);
    expect(ctx.characterFamilies).toEqual(["B", "B"]);
  });

  it("the project context spans every scene", () => {
    const ctx = projectStyleContext(projectWithCharacters());
    expect(ctx.characterFamilies).toEqual(["B", "B", "A"]);
  });

  it("a custom set stamped on a scene object surfaces in the scene context", () => {
    const project = projectWithCharacters();
    project.scenes[0].objects.push({
      id: "x1",
      type: "image",
      resource: "x",
      extensions: {
        "x-finch-studio": {
          customCharacterSet: { id: "crew", name: "Harbour Crew", description: "teal ink" },
        },
      },
    } as never);
    expect(sceneStyleContext(project.scenes[0]).customStyleSet?.name).toBe("Harbour Crew");
  });
});

describe("editor library surface", () => {
  beforeEach(() => {
    localStorage.removeItem(GENERATED_MEDIA_KEY);
  });

  it("saves a generated asset and loads it back with provenance", async () => {
    const saved = await localGeneratedLibrary.save(sampleAsset);
    expect(saved.id).toBe("gen-1");
    const loaded = loadGeneratedAssets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].generated.origin).toBe("ai-generated");
    expect(loaded[0].tags).toContain("style-b-warm-storybook");
    expect(loaded[0].credit).toContain("AI generated in FinchLearn Studio");
  });

  it("saving the same asset twice keeps one library entry", async () => {
    await localGeneratedLibrary.save(sampleAsset);
    await localGeneratedLibrary.save(sampleAsset);
    expect(loadGeneratedAssets()).toHaveLength(1);
  });
});

describe("first class placement through the store", () => {
  it("a generated prop is movable and animatable like any stage object", () => {
    useStudioStore.getState().newProject();
    useStudioStore.getState().addObject(makeStudioCharacter("businesswoman"));
    const object = makeGeneratedAssetObject(sampleAsset);
    useStudioStore.getState().addObject(object);
    const scene = useStudioStore.getState().project.scenes[0];
    const placed = scene.objects.find((o) => o.id === object.id);
    expect(placed?.type).toBe("image");
    // Movable: position updates through the normal object patch path.
    useStudioStore.getState().updateObject(object.id, {
      position: { x: 40, y: 60, w: 200, h: 200 },
    } as never);
    const moved = useStudioStore
      .getState()
      .project.scenes[0].objects.find((o) => o.id === object.id) as
      | { position: { x: number; y: number } }
      | undefined;
    expect(moved?.position).toEqual({ x: 40, y: 60, w: 200, h: 200 });
    // Animatable: effect presets attach through the normal presets path.
    useStudioStore.getState().setObjectPresets(object.id, [
      { name: "fade-in", delay: 0, duration: 500 } as never,
    ]);
    const animated = useStudioStore
      .getState()
      .project.scenes[0].objects.find((o) => o.id === object.id);
    expect(animated?.animations?.presets).toHaveLength(1);
  });
});
