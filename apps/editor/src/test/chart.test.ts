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

  it("parses pasted tables with CR or CRLF row separators (issue #116)", () => {
    // A CR-separated paste used to collapse into one line
    // ("Month,SalesJan,10Feb,25Mar,18") and parse as a header-only table.
    const expected = {
      labels: ["Jan", "Feb", "Mar"],
      datasets: [{ label: "Sales", values: [10, 25, 18] }],
    };
    expect(parseChartTable("Month,Sales\rJan,10\rFeb,25\rMar,18")).toEqual(expected);
    expect(parseChartTable("Month,Sales\r\nJan,10\r\nFeb,25\r\nMar,18")).toEqual(expected);
    expect(parseChartTable("Month,Sales\nJan,10\nFeb,25\nMar,18")).toEqual(expected);
    expect(parseChartTable("Month\tSales\rJan\t10\rFeb\t25\rMar\t18")).toEqual(expected);
  });

  it("renders a chart from a one-shot pasted table instead of the no-data placeholder", () => {
    const pasted = makeStudioChart("bar") as Extract<
      ReturnType<typeof makeStudioChart>,
      { type: "chart" }
    >;
    const withData = {
      ...pasted,
      chart: {
        ...pasted.chart,
        csv: "Month,Sales\rJan,10\rFeb,25\rMar,18",
      },
    } as typeof pasted;
    const svg = chartSvg(withData, 1);
    expect(svg).not.toContain("Paste chart data");
    expect(svg).toContain("Jan: 10");
    expect(svg).toContain("Feb: 25");
    expect(svg).toContain("Mar: 18");
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
