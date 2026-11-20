// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPanel } from "../components/MediaPanel.js";
import { useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("media panel Lottie tabs (#97, #100)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  const clickButton = (label: string) => {
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(label),
    );
    if (!button) throw new Error(`Missing ${label} button`);
    act(() => button.click());
  };

  it("lists the built in pack and places an icon as a lottie object", async () => {
    // Pack thumbnails load through fetch; offline here, they fall back
    // to the icon name and placement still works.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    act(() => root.render(<MediaPanel />));
    clickButton("Built-in");
    expect(container.textContent).toContain("Confetti");
    expect(container.textContent).toContain("Trophy");
    expect(container.textContent).toContain("Generative Icons, MIT license");
    const before = useStudioStore.getState().project.scenes[0].objects.length;
    clickButton("Confetti");
    const objects = useStudioStore.getState().project.scenes[0].objects;
    expect(objects).toHaveLength(before + 1);
    const placed = objects[objects.length - 1] as { type: string; packId?: string };
    expect(placed.type).toBe("lottie");
    expect(placed.packId).toBe("confetti");
  });

  it("fails honestly in Browse when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    act(() => root.render(<MediaPanel />));
    clickButton("Browse");
    clickButton("Search");
    // Let the rejected search settle into the error state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("could not reach Generative Icons");
    expect(container.textContent).not.toContain("Confetti");
  });

  it("shows the Lottie import and the rendered video note in My media", () => {
    act(() => root.render(<MediaPanel />));
    clickButton("My media");
    expect(container.textContent).toContain("Import Lottie (.json, .lottie)");
    expect(container.textContent).toContain("MP4 or MOV");
    const input = container.querySelector<HTMLInputElement>('input[accept*=".lottie"]');
    expect(input).toBeTruthy();
  });
});
