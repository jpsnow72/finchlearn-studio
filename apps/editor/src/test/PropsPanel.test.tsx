// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PropsPanel } from "../components/PropsPanel.js";
import { makeStudioShape, useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Effects panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
    const sceneId = useStudioStore.getState().project.scenes[0].id;
    useStudioStore.getState().setScenePresets(sceneId, [
      { name: "fadeIn", start: 100, duration: 500 },
    ]);
    useStudioStore.getState().addObject(makeStudioShape());
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("adds, edits, and removes object presets separately from scene effects", () => {
    act(() => root.render(<PropsPanel pathEdit={false} setPathEdit={() => {}} />));
    const select = (label: string, value: string) => {
      const field = [...container.querySelectorAll("select")].find((item) =>
        item.closest("label")?.querySelector("span")?.textContent === label,
      );
      if (!field) throw new Error(`Missing ${label} select`);
      act(() => {
        field.value = value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    // Issue #112 re-pin: effect choice is a card grid now, not a
    // Preset select; picking a preset means clicking its card.
    const pickCard = (name: string) => {
      const card = container.querySelector<HTMLButtonElement>(
        `[data-preset="${name}"]`,
      );
      if (!card) throw new Error(`Missing ${name} card`);
      act(() => card.click());
    };

    expect(container.querySelector(".effect-item")).toBeNull();
    select("Preset type", "exit");
    pickCard("slideOutRight");
    act(() => {
      container.querySelector<HTMLButtonElement>(".field-row button")?.click();
    });

    const objectId = useStudioStore.getState().selectedObjectId;
    if (!objectId) throw new Error("Object should remain selected");
    let effect = useStudioStore.getState().project.scenes[0].objects[0].animations?.presets?.[0];
    // Issue #112 re-pin: adds land at the shared registry default for
    // the effect (Slide: 500ms), not the flat 600ms the panel used
    // before the registry defaults.
    expect(effect).toEqual({ name: "slideOutRight", start: 0, duration: 500 });

    // Issue #112 re-pin: each timing control now pairs a slider with
    // the numeric input; the numeric inputs keep the blur-commit
    // behavior this test exercises.
    let controls = container.querySelectorAll<HTMLInputElement>(
      ".effect-item input[type=\"number\"]",
    );
    act(() => {
      controls[0].value = "250";
      controls[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    controls = container.querySelectorAll<HTMLInputElement>(
      ".effect-item input[type=\"number\"]",
    );
    act(() => {
      controls[1].value = "900";
      controls[1].dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    effect = useStudioStore.getState().project.scenes[0].objects[0].animations?.presets?.[0];
    expect(effect?.start).toBe(250);
    expect(effect?.duration).toBe(900);

    act(() => {
      container.querySelector<HTMLButtonElement>(".effect-item button")?.click();
    });
    expect(useStudioStore.getState().project.scenes[0].objects[0].animations?.presets).toEqual([]);
    expect(useStudioStore.getState().project.scenes[0].animations?.presets).toEqual([
      { name: "fadeIn", start: 100, duration: 500 },
    ]);

    act(() => {
      useStudioStore.getState().selectObject(null);
    });
    expect(container.querySelector(".effect-item strong")?.textContent).toBe("Fade in");
  });

  it("offers the full shared registry as cards and adds at registry defaults (issue #112)", () => {
    act(() => root.render(<PropsPanel pathEdit={false} setPathEdit={() => {}} />));
    const select = (label: string, value: string) => {
      const field = [...container.querySelectorAll("select")].find((item) =>
        item.closest("label")?.querySelector("span")?.textContent === label,
      );
      if (!field) throw new Error(`Missing ${label} select`);
      act(() => {
        field.value = value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    const pickCard = (name: string) => {
      const card = container.querySelector<HTMLButtonElement>(
        `[data-preset="${name}"]`,
      );
      if (!card) throw new Error(`Missing ${name} card`);
      act(() => card.click());
      return card;
    };

    // Enter group carries the two registry effects that are new to
    // both products, and selecting a card marks it selected.
    const baseline = pickCard("baselineReveal");
    expect(baseline.classList.contains("selected")).toBe(true);
    expect(baseline.textContent).toContain("Baseline Reveal");
    expect(container.querySelector('[data-preset="blockReveal"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>(".field-row button")?.click();
    });
    let presets = useStudioStore.getState().project.scenes[0].objects[0].animations?.presets;
    expect(presets).toEqual([{ name: "baselineReveal", start: 0, duration: 500 }]);

    // Each applied effect pairs a slider with its numeric input.
    expect(
      container.querySelectorAll(".effect-item input[type=\"range\"]"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".effect-item input[type=\"number\"]"),
    ).toHaveLength(2);
    const sliders = container.querySelectorAll<HTMLInputElement>(
      ".effect-item input[type=\"range\"]",
    );
    expect(sliders[0].max).toBe("5000");
    expect(sliders[1].min).toBe("100");
    expect(sliders[1].max).toBe("3000");

    // Float is applicable from the panel in the Motion group, at its
    // registry default of 2500ms.
    select("Preset type", "motion");
    pickCard("float");
    act(() => {
      container.querySelector<HTMLButtonElement>(".field-row button")?.click();
    });
    presets = useStudioStore.getState().project.scenes[0].objects[0].animations?.presets;
    expect(presets?.[1]).toEqual({ name: "float", start: 0, duration: 2500 });
  });
});
