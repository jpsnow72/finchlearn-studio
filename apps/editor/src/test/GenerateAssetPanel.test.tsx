// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaPanel } from "../components/MediaPanel.js";
import { useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("generate tab in the media panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem("finch-studio.generated-media");
    useStudioStore.getState().newProject();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("shows the honest not configured state and keeps generate disabled", () => {
    act(() => root.render(<MediaPanel />));
    const tab = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Generate"),
    );
    if (!tab) throw new Error("Missing Generate tab");
    act(() => tab.click());
    expect(container.textContent).toContain("not configured on this build");
    expect(container.textContent).toContain("VITE_FINCH_AI_ASSET_ENDPOINT");
    expect(container.textContent).toContain("Target style:");
    const generate = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Generate asset"),
    );
    expect(generate?.hasAttribute("disabled")).toBe(true);
  });

  it("offers the style families and asset kinds without asking for output defaults", () => {
    act(() => root.render(<MediaPanel />));
    const tab = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Generate"),
    );
    if (!tab) throw new Error("Missing Generate tab");
    act(() => tab.click());
    const styleSelect = container.querySelector<HTMLSelectElement>('[aria-label="Asset style"]');
    const options = [...(styleSelect?.options ?? [])].map((o) => o.textContent);
    expect(options.join(" ")).toContain("Match this project (automatic)");
    expect(options.join(" ")).toContain("Clean Corporate Flat");
    expect(options.join(" ")).toContain("Warm Storybook Soft");
    expect(options.join(" ")).toContain("Bold Ink Editorial");
    const kindSelect = container.querySelector<HTMLSelectElement>('[aria-label="Asset kind"]');
    expect(kindSelect?.options.length).toBe(2);
    // No output default controls: look, background, and size are baked in.
    expect(container.textContent).not.toContain("Output format");
    expect(container.querySelector('[aria-label="Background handling"]')).toBeNull();
  });
});
