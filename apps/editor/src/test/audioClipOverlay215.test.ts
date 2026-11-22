import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Studio #215: the .audio-clip absolute positioning belongs to the
 * timeline lane only. AudioPanel / FootagePanel / RoughCutPanel reuse
 * the class for in-flow list items with no positioned ancestor; the
 * unscoped rule stretched a Ducking block over the whole right column
 * and intercepted clicks (incl. the scene strip's + Add scene button).
 */
const CSS = readFileSync(
  fileURLToPath(new URL("../studio.css", import.meta.url)),
  "utf8",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`^${escaped}\\s*{([^}]*)}`, "m"));
  return m?.[1] ?? "";
}

describe(".audio-clip overlay scope (#215)", () => {
  it("scopes the absolute positioning to the timeline lane", () => {
    const lane = rule(".timeline-audio-lane .audio-clip");
    expect(lane).toMatch(/position:\s*absolute/);
    expect(lane).toMatch(/inset-block:\s*0/);
  });

  it("keeps panel list items in normal flow", () => {
    const panel = rule(".audio-clip");
    expect(panel).toMatch(/position:\s*static/);
    expect(panel).not.toMatch(/position:\s*absolute/);
  });
});
