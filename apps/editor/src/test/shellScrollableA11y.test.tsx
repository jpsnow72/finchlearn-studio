// @vitest-environment jsdom
/**
 * Issues #341, #342, #351, #353, #365 and #294: workspace card strips are
 * horizontally scrollable, so they must be keyboard focusable with an
 * accessible name, and each project card Open button must name its project.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FrontPage } from "../shell.js";
import { makeStarterProject, useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("workspace scrollable regions and Open buttons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "finch-studio-exports",
      JSON.stringify([
        { id: "e1", name: "Launch Cut.mp4", savedAt: "2026-11-20T00:00:00.000Z" },
      ]),
    );
    useStudioStore.getState().loadProject(makeStarterProject("S64 Matte Check"));
    container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root.render(
        <FrontPage
          session={{ userId: "u1", email: "kavitest@example.com" }}
          onOpenEditor={() => {}}
          onSignOut={() => {}}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("makes both shell-cards strips focusable with accessible names", () => {
    const strips = [...container.querySelectorAll(".shell-cards")];
    expect(strips.length).toBe(2);
    for (const strip of strips) {
      expect(strip.getAttribute("tabindex")).toBe("0");
      expect(strip.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    }
    const labels = strips.map((s) => s.getAttribute("aria-label"));
    expect(labels).toContain("Continue editing projects list");
    expect(labels).toContain("Recent exports list");
  });

  it("names each Open button after its project", () => {
    const open = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Open",
    );
    if (!open) throw new Error("Missing Open button");
    expect(open.getAttribute("aria-label")).toContain("Open S64 Matte Check");
  });
});
