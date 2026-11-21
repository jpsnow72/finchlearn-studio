// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { chartProgress, chartSvg, parseChartTable } from "../chart.js";
import { makeStudioChart, useStudioStore } from "../store.js";

describe("chart elements", () => {
  it("parses pasted CSV and tabular data", () => {
    expect(parseChartTable("Label,Value\nOne,10\nTwo,25")).toEqual({
      labels: ["One", "Two"],
      datasets: [{ label: "Value", values: [10, 25] }],
    });
    expect(parseChartTable("Label\tValue\nOne\t10\nTwo\t25").datasets[0].values).toEqual([10, 25]);
  });

  it("adds bar, line, and pie chart objects through the store", () => {
    useStudioStore.getState().newProject();
    const bar = makeStudioChart("bar");
    useStudioStore.getState().addObject(bar);
    expect(useStudioStore.getState().project.scenes[0].objects).toContain(bar);
    expect(bar.type).toBe("chart");
  });

  it("renders all chart types and reveals over playback time", () => {
    const bar = makeStudioChart("bar") as Extract<ReturnType<typeof makeStudioChart>, { type: "chart" }>;
    expect(chartSvg(bar, 0.5)).toContain("<rect");
    const line = makeStudioChart("line") as Extract<ReturnType<typeof makeStudioChart>, { type: "chart" }>;
    expect(chartSvg(line, 0.5)).toContain("polyline");
    const pie = makeStudioChart("pie") as Extract<ReturnType<typeof makeStudioChart>, { type: "chart" }>;
    expect(chartSvg(pie, 0.5)).toContain("<path");
    expect(chartProgress({ ...bar, timing: { start: 0, duration: 1 } }, 500)).toBeGreaterThan(0);
  });
});
