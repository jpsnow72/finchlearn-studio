import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Layout pins for the 375px editor overflow (issues #132, #138, #162).
 *
 * jsdom has no layout engine, so these pins read the shipped stylesheet
 * and lock the narrow viewport rules that keep the document from growing
 * a horizontal scrollbar: below 820px the fixed desktop columns (rail,
 * flyout, properties) stack full width instead of painting past the
 * right edge, and panels scroll inside themselves.
 */
const CSS = readFileSync(
  fileURLToPath(new URL("../studio.css", import.meta.url)),
  "utf8",
);

function narrowBlock(): string {
  const start = CSS.indexOf("@media (max-width: 820px)");
  // The editor stacking block is the last media block in the file.
  const editorStart = CSS.lastIndexOf("@media (max-width: 820px)");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(editorStart);
}

describe("studio editor narrow viewport layout", () => {
  it("stacks the editor columns below 820px", () => {
    const block = narrowBlock();
    expect(block).toContain(".studio-main { flex-direction: column;");
    expect(block).toContain(".studio-left, .studio-right, .studio-flyout");
    expect(block).toContain("width: auto; flex: none;");
    expect(block).toContain(".studio-center { width: 100%; flex: none; }");
  });

  it("turns the icon rail into a horizontal strip", () => {
    const block = narrowBlock();
    expect(block).toContain(".studio-rail { flex-direction: row;");
    expect(block).toContain("overflow-x: auto");
  });

  it("clips document level horizontal overflow and wraps the top bar", () => {
    const block = narrowBlock();
    expect(block).toContain(".studio { overflow-x: clip; }");
    expect(block).toContain(".topbar { flex-wrap: wrap; }");
    expect(block).toContain(".project-name { min-width: 0;");
  });

  it("keeps the desktop fixed columns outside the narrow block", () => {
    const desktop = CSS.slice(0, CSS.lastIndexOf("@media (max-width: 820px)"));
    expect(desktop).toContain("width: 290px; flex-shrink: 0;");
    expect(desktop).toContain(".studio-flyout { width: 264px; flex: none; }");
  });

  it("clips the stage wrap so a pre-fit stage cannot spill", () => {
    expect(CSS).toContain(
      ".studio-canvas-wrap { width: 100%; min-width: 0; overflow-x: clip;",
    );
  });
});
