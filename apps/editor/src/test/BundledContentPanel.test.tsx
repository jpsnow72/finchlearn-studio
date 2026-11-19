// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaPanel } from "../components/MediaPanel.js";
import { useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("bundled content in the media panel (issue #101)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<MediaPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const clickTab = (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    );
    if (!button) throw new Error(`Missing ${label} tab`);
    act(() => button.click());
  };

  const setSearch = (label: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      `[aria-label="${label}"]`,
    );
    if (!input) throw new Error(`Missing ${label} input`);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("browses and searches bundled props, then places one on the scene", () => {
    clickTab("Props");
    expect(container.querySelectorAll(".prop-thumb").length).toBeGreaterThanOrEqual(40);

    setSearch("Search bundled props", "laptop");
    const thumbs = [...container.querySelectorAll<HTMLButtonElement>(".prop-thumb")];
    expect(thumbs).toHaveLength(2);

    const before = useStudioStore.getState().project.scenes[0].objects.length;
    act(() => thumbs[0].click());
    const objects = useStudioStore.getState().project.scenes[0].objects;
    expect(objects).toHaveLength(before + 1);
    const placed = objects[objects.length - 1] as unknown as {
      type: string;
      resource: string;
      extensions?: Record<string, Record<string, string>>;
    };
    expect(placed.type).toBe("image");
    expect(placed.resource).toContain("data:image/svg+xml");
    expect(placed.extensions?.["x-finch-studio"]?.bundledAssetId).toBe("prop-laptop-a");
  });

  it("applies a bundled background to the current scene in one click", () => {
    clickTab("Backgrounds");
    expect(container.querySelectorAll(".bg-thumb").length).toBeGreaterThanOrEqual(10);

    setSearch("Search bundled backgrounds", "warehouse");
    const thumbs = [...container.querySelectorAll<HTMLButtonElement>(".bg-thumb")];
    expect(thumbs).toHaveLength(2);

    act(() => thumbs[0].click());
    expect(useStudioStore.getState().project.scenes[0].background)
      .toBe("bundled-bg:bg-warehouse-a");
  });

  it("clears the scene background through the store action", () => {
    const sceneId = useStudioStore.getState().project.scenes[0].id;
    act(() => {
      useStudioStore.getState().setSceneBackground(sceneId, "bundled-bg:bg-office-b");
    });
    expect(useStudioStore.getState().project.scenes[0].background)
      .toBe("bundled-bg:bg-office-b");
    act(() => {
      useStudioStore.getState().setSceneBackground(sceneId, undefined);
    });
    expect(useStudioStore.getState().project.scenes[0].background).toBeUndefined();
  });
});
