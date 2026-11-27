// @vitest-environment jsdom
/**
 * Issues #341, #342, #351, #353, #365 and #294: each project card Open
 * button must name its project. Fix wave (Studio #391): the card strips
 * themselves are scroll containers, not controls, and must not carry
 * interactive semantics; their content stays keyboard reachable through
 * the named inner buttons and links.
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

  it("keeps both shell-cards strips non-interactive containers (fix wave, Studio #391)", () => {
    // The strips are scroll containers, not controls: the click audit
    // flagged the Continue editing strip as a dead control while it
    // carried tabIndex/role/aria-label. Only the inner per-project
    // buttons and links act, and they keep their accessible names;
    // keyboard users reach the strip content through those controls.
    const strips = [...container.querySelectorAll(".shell-cards")];
    expect(strips.length).toBe(2);
    for (const strip of strips) {
      expect(strip.getAttribute("tabindex")).toBeNull();
      expect(strip.getAttribute("role")).toBeNull();
    }
  });

  it("names each Open button after its project", () => {
    const open = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Open",
    );
    if (!open) throw new Error("Missing Open button");
    expect(open.getAttribute("aria-label")).toContain("Open S64 Matte Check");
  });
});
