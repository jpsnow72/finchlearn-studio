/**
 * Cue point editor panel (issue #64): add a marker at the playhead,
 * edit its payload, and delete it, all through the store.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CuePoints } from "../components/CuePoints";
import { useStudioStore } from "../store";
import { sceneCueMarkers } from "../cuePoints";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPanel(tMs: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<CuePoints tMs={tMs} setTMs={() => {}} />);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  useStudioStore.getState().newProject();
  document.body.innerHTML = "";
});

describe("CuePoints panel", () => {
  it("adds a knowledge check marker at the playhead and edits its question", () => {
    const { container, unmount } = renderPanel(2000);
    const add = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add marker at playhead"),
    );
    act(() => add?.click());

    let markers = sceneCueMarkers(useStudioStore.getState().project.scenes[0]);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ type: "knowledge-check", atMs: 2000 });

    const questionInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Knowledge check question"]',
    );
    expect(questionInput).not.toBeNull();
    setValue(questionInput!, "What comes first?");
    const choices = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Knowledge check choices"]',
    );
    setValue(choices!, "Identify the source\nStart the machine");

    markers = sceneCueMarkers(useStudioStore.getState().project.scenes[0]);
    expect(markers[0].question?.prompt).toBe("What comes first?");
    expect(markers[0].question?.choices.map((c) => c.label)).toEqual([
      "Identify the source",
      "Start the machine",
    ]);
    unmount();
  });

  it("deletes the selected marker", () => {
    useStudioStore.getState().addCueMarker("chapter", 1000);
    const { container, unmount } = renderPanel(0);
    const chip = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Edit Chapter marker"]',
    );
    act(() => chip?.click());
    const del = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete marker",
    );
    act(() => del?.click());
    expect(sceneCueMarkers(useStudioStore.getState().project.scenes[0])).toEqual([]);
    unmount();
  });

  it("shows the empty state when a scene has no markers", () => {
    const { container, unmount } = renderPanel(0);
    expect(container.textContent).toContain("No cue points on this scene yet");
    unmount();
  });
});
