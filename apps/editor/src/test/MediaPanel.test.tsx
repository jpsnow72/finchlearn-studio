// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaPanel } from "../components/MediaPanel.js";
import { makeStudioShape, useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("saved scene groups", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem("finch-studio.user-scene-groups");
    useStudioStore.getState().newProject();
    const first = makeStudioShape();
    const second = makeStudioShape();
    useStudioStore.getState().addObject(first);
    useStudioStore.getState().addObject(second);
    useStudioStore.getState().selectObject(first.id);
    useStudioStore.getState().selectObject(second.id, true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("saves selected objects, searches the group, and inserts it", () => {
    act(() => root.render(<MediaPanel />));
    const setInput = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const clickButton = (label: string) => {
      const button = [...container.querySelectorAll("button")].find((item) =>
        item.textContent?.includes(label),
      );
      if (!button) throw new Error(`Missing ${label} button`);
      act(() => button.click());
    };

    clickButton("Groups");
    const nameInput = container.querySelector<HTMLInputElement>('[aria-label="Saved group name"]');
    if (!nameInput) throw new Error("Missing saved group name input");
    act(() => {
      setInput(nameInput, "Lower third");
    });
    clickButton("Save 2 selected");

    const saved = JSON.parse(localStorage.getItem("finch-studio.user-scene-groups") ?? "[]") as {
      name: string;
      objects: unknown[];
    }[];
    expect(saved[0].name).toBe("Lower third");
    expect(saved[0].objects).toHaveLength(2);

    const search = container.querySelector<HTMLInputElement>('[aria-label="Search saved groups"]');
    if (!search) throw new Error("Missing saved group search");
    act(() => {
      setInput(search, "shape");
    });
    expect(container.textContent).toContain("Lower third");
    const initialCount = useStudioStore.getState().project.scenes[0].objects.length;
    clickButton("Insert");
    expect(useStudioStore.getState().project.scenes[0].objects).toHaveLength(initialCount + 2);
  });
});
