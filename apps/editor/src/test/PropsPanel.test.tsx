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

    expect(container.querySelector(".effect-item")).toBeNull();
    select("Preset type", "exit");
    select("Preset", "slideOutRight");
    act(() => {
      container.querySelector<HTMLButtonElement>(".field-row button")?.click();
    });

    const objectId = useStudioStore.getState().selectedObjectId;
    if (!objectId) throw new Error("Object should remain selected");
    let effect = useStudioStore.getState().project.scenes[0].objects[0].animations?.presets?.[0];
    expect(effect).toEqual({ name: "slideOutRight", start: 0, duration: 600 });

    let controls = container.querySelectorAll<HTMLInputElement>(".effect-item input");
    act(() => {
      controls[0].value = "250";
      controls[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    controls = container.querySelectorAll<HTMLInputElement>(".effect-item input");
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
});
