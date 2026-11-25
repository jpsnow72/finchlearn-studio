// @vitest-environment jsdom
/**
 * Issue #283: the workspace hub New Project button only entered the
 * editor, so it reopened whatever project the store had restored
 * from autosave. It must start a fresh project first.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrontPage } from "../shell.js";
import { makeStarterProject, useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("hub New Project (issue #283)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    useStudioStore.getState().loadProject(makeStarterProject("S64 Matte Check"));
    expect(useStudioStore.getState().project.name).toBe("S64 Matte Check");
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("starts a fresh blank project instead of reopening the current one", () => {
    const onOpenEditor = vi.fn();
    act(() => {
      root.render(
        <FrontPage
          session={{ userId: "u1", email: "kavitest@example.com" }}
          onOpenEditor={onOpenEditor}
          onSignOut={() => {}}
        />,
      );
    });
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New Project"),
    );
    if (!button) throw new Error("Missing New Project button");
    act(() => button.click());
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    const project = useStudioStore.getState().project;
    expect(project.name).toBe("Untitled video");
    expect(project.scenes).toHaveLength(1);
    expect(project.scenes[0]?.objects).toHaveLength(0);
  });
});
