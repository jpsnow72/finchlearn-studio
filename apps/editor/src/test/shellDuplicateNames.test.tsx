// @vitest-environment jsdom
/**
 * Studio #348, #338, #324, #293 (segment 2 burn-down): several
 * projects that share a title and a calendar day, the common case
 * for "Untitled video" projects saved the same day, must not share
 * one identical accessible name on the workspace. Duplicated base
 * labels gain the stable tail of the project id; a label that is
 * already distinct keeps its existing wording exactly. Recent
 * Exports Download links carry the same defect in the same
 * component (every link was named just "Download") and get the
 * same treatment.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FrontPage } from "../shell.js";
import { makeStarterProject, useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("workspace duplicate accessible names", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "finch-studio-projects",
      JSON.stringify([
        { id: "vproj-test-aaaa11", name: "Untitled video", updatedAt: "2026-11-27T09:00:00.000Z" },
        { id: "vproj-test-bbbb22", name: "Untitled video", updatedAt: "2026-11-27T10:00:00.000Z" },
        { id: "vproj-test-cccc33", name: "Untitled video", updatedAt: "2026-11-27T11:00:00.000Z" },
      ]),
    );
    localStorage.setItem(
      "finch-studio-exports",
      JSON.stringify([
        { id: "exp-111111", name: "Launch Cut.mp4", savedAt: "2026-11-27T09:00:00.000Z", downloadUrl: "https://example.com/a.mp4" },
        { id: "exp-222222", name: "Launch Cut.mp4", savedAt: "2026-11-27T10:00:00.000Z", downloadUrl: "https://example.com/b.mp4" },
      ]),
    );
    useStudioStore.getState().loadProject(makeStarterProject("Quarterly Review"));
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

  it("gives every Open button a distinct accessible name", () => {
    const labels = [...container.querySelectorAll("button")]
      .filter((b) => b.textContent?.trim() === "Open")
      .map((b) => b.getAttribute("aria-label"));
    expect(labels.length).toBe(4);
    expect(new Set(labels).size).toBe(labels.length);
    const untitled = labels.filter((l) => l?.includes("Untitled video"));
    expect(untitled).toHaveLength(3);
    expect(untitled.some((l) => l?.endsWith("ID aaaa11"))).toBe(true);
    expect(untitled.some((l) => l?.endsWith("ID bbbb22"))).toBe(true);
    expect(untitled.some((l) => l?.endsWith("ID cccc33"))).toBe(true);
  });

  it("keeps an already distinct Open label unchanged", () => {
    const labels = [...container.querySelectorAll("button")]
      .filter((b) => b.textContent?.trim() === "Open")
      .map((b) => b.getAttribute("aria-label") ?? "");
    const distinct = labels.find((l) => l.includes("Quarterly Review"));
    expect(distinct).toBeDefined();
    expect(distinct).not.toContain("ID ");
    expect(distinct).toContain("Open Quarterly Review (edited ");
  });

  it("gives every Download link a distinct accessible name", () => {
    const labels = [...container.querySelectorAll("a")]
      .filter((a) => a.textContent?.trim() === "Download")
      .map((a) => a.getAttribute("aria-label"));
    expect(labels.length).toBe(2);
    expect(new Set(labels).size).toBe(2);
    for (const l of labels) expect(l).toContain("Download Launch Cut.mp4 (saved ");
    expect(labels.some((l) => l?.endsWith("ID 111111"))).toBe(true);
    expect(labels.some((l) => l?.endsWith("ID 222222"))).toBe(true);
  });
});
