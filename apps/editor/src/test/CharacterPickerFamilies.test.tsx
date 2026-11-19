// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CharacterPicker } from "../components/CharacterPicker.js";
import { useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("character picker families (#53)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("surfaces all three families including Bold Ink Editorial", () => {
    act(() => root.render(<CharacterPicker />));
    const text = container.textContent ?? "";
    expect(text).toContain("Clean Corporate Flat");
    expect(text).toContain("Warm Storybook Soft");
    expect(text).toContain("Bold Ink Editorial");
    expect(text).toContain("Priya");
    expect(text).toContain("Marcus");
  });

  it("clicking a family D card adds that character to the scene", () => {
    act(() => root.render(<CharacterPicker />));
    const card = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Priya"),
    );
    if (!card) throw new Error("Missing Priya card");
    act(() => card.click());
    const project = useStudioStore.getState().project;
    const names = project.scenes[0].objects.map((o) => o.name);
    expect(names).toContain("Priya");
  });
});
