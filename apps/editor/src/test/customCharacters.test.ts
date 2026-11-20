/**
 * Custom character library and store wiring (issue #74).
 *
 * A rigged character saved to the user library persists through the
 * editor's localStorage backed library, reopens intact, and places
 * into a scene as a normal character object carrying its full def.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCharacter,
  buildRig,
  decideRigMode,
  detectJoints,
} from "@finch-studio/characters";
import type { CustomCharacterDef } from "@finch-studio/characters";
import {
  CUSTOM_CHARACTERS_KEY,
  customDefOfObject,
  loadCustomCharacters,
  saveCustomCharacters,
} from "../customCharacters.js";
import { makeStudioCustomCharacter, useStudioStore } from "../store.js";

function sampleDef(id = "custom-test-1"): CustomCharacterDef {
  const pins = detectJoints({ width: 400, height: 800 });
  return {
    ...buildCharacter(id, "Scout", {}),
    customRig: buildRig({
      sourceKind: "single-png",
      pins,
      detectedPins: pins,
      decision: decideRigMode({
        sourceKind: "single",
        partCount: 0,
        jointSeparation: 0.2,
        hasTransparency: true,
      }),
      baseImageRef: "data:image/png;base64,AAAA",
      imageSize: { width: 400, height: 800 },
    }),
  };
}

beforeEach(() => {
  localStorage.clear();
  useStudioStore.setState({ customCharacters: [] });
  useStudioStore.getState().newProject();
});

describe("custom character library persistence (#74)", () => {
  it("round trips a def through library storage intact", () => {
    const def = sampleDef();
    expect(saveCustomCharacters([def])).toBe(true);
    const raw = localStorage.getItem(CUSTOM_CHARACTERS_KEY);
    expect(raw).toContain("Scout");
    const loaded = loadCustomCharacters();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].customRig.pins).toEqual(def.customRig.pins);
    expect(loaded[0].customRig.boneMap.joints).toEqual(def.customRig.boneMap.joints);
    expect(loaded[0].customRig.facePack.anchor).toEqual(def.customRig.facePack.anchor);
  });

  it("drops corrupt records instead of breaking the library", () => {
    localStorage.setItem(
      CUSTOM_CHARACTERS_KEY,
      JSON.stringify([{ id: "broken" }, sampleDef("custom-ok"), 42]),
    );
    const loaded = loadCustomCharacters();
    expect(loaded.map((d) => d.id)).toEqual(["custom-ok"]);
    localStorage.setItem(CUSTOM_CHARACTERS_KEY, "not json");
    expect(loadCustomCharacters()).toEqual([]);
  });
});

describe("custom characters in the store (#74)", () => {
  it("saves, lists, and removes characters through the store", () => {
    const def = sampleDef();
    useStudioStore.getState().saveCustomCharacter(def);
    expect(useStudioStore.getState().customCharacters.map((d) => d.id)).toEqual([def.id]);
    expect(loadCustomCharacters().map((d) => d.id)).toEqual([def.id]);
    // Saving the same id again replaces, never duplicates.
    useStudioStore.getState().saveCustomCharacter({ ...def, name: "Scout Two" });
    expect(useStudioStore.getState().customCharacters).toHaveLength(1);
    expect(useStudioStore.getState().customCharacters[0].name).toBe("Scout Two");
    useStudioStore.getState().removeCustomCharacter(def.id);
    expect(useStudioStore.getState().customCharacters).toEqual([]);
    expect(loadCustomCharacters()).toEqual([]);
  });

  it("places into a scene as a character object carrying its def", () => {
    const def = sampleDef();
    const object = makeStudioCustomCharacter(def);
    expect(object.type).toBe("character");
    expect(object.name).toBe("Scout");
    expect(customDefOfObject(object)?.id).toBe(def.id);
    useStudioStore.getState().addObject(object);
    const scene = useStudioStore.getState().project.scenes[0];
    const placed = scene.objects.find((o) => o.id === object.id);
    expect(placed).toBeTruthy();
    expect(customDefOfObject(placed!)?.customRig.mode).toBe("puppet-warp");
  });
});
