import type { ChartObject, CourseObject } from "@finch-studio/core";

export interface ChartData {
  labels: string[];
  datasets: { label: string; values: number[] }[];
}

export const CHART_COLORS = [
  "var(--accent)",
  "var(--accent2)",
  "var(--text)",
  "var(--muted)",
] as const;

export function parseChartTable(csv: string): ChartData {
  const rows = csv
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.includes("\t") ? line.split("\t") : line.split(","))
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.length > 0);
  if (rows.length === 0) return { labels: [], datasets: [] };

  const header = rows[0];
  const labels = rows.slice(1).map((row) => row[0] ?? "").filter(Boolean);
  const datasets = header.slice(1).map((label, datasetIndex) => ({
    label,
    values: rows.slice(1).map((row) => {
      const value = Number(row[datasetIndex + 1]);
      return Number.isFinite(value) ? value : 0;
    }),
  }));
  return { labels, datasets };
}

export function chartDataOf(object: ChartObject): ChartData {
  if (object.chart?.csv) return parseChartTable(object.chart.csv);
  return {
    labels: object.chart?.labels ?? [],
    datasets: (object.chart?.datasets ?? []).map((dataset) => ({
      label: dataset.label ?? "",
      values: dataset.values ?? [],
    })),
  };
}

export function chartProgress(object: CourseObject, sceneTimeMs: number): number {
  const startMs = (object.timing?.start ?? 0) * 1000;
  const durationMs = (object.timing?.duration ?? 5) * 1000;
  if (durationMs <= 0) return 1;
  const local = sceneTimeMs - startMs;
  return Math.max(0, Math.min(1, local / Math.min(durationMs, 900)));
}

export function resolveChartColor(color: string): string {
  if (typeof document === "undefined" || !color.startsWith("var(")) return color;
  const name = color.slice(4, -1).trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || color;
}

export function chartSvg(object: ChartObject, progress: number): string {
  const data = chartDataOf(object);
  const type = object.chart?.chartType ?? "bar";
  const w = 640;
  const h = 360;
  const colors = object.chart?.colors?.length ? object.chart.colors : [...CHART_COLORS];
  if (!data.labels.length || !data.datasets.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-label="Chart with no data"><rect width="${w}" height="${h}" rx="12" fill="var(--bg2)" stroke="var(--line)"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="var(--muted)" font-family="system-ui">Paste chart data</text></svg>`;
  }

  const pad = 48;
  const values = data.datasets.flatMap((dataset) => dataset.values);
  const max = Math.max(1, ...values);
  if (type === "pie") {
    const total = Math.max(1, values.reduce((sum, value) => sum + Math.max(0, value), 0));
    let angle = -Math.PI / 2;
    const cx = w / 2;
    const cy = h / 2;
    const r = 130;
    const sectors = data.labels.map((label, index) => {
      const value = data.datasets[0]?.values[index] ?? 0;
      const sweep = (Math.max(0, value) / total) * Math.PI * 2 * progress;
      const end = angle + sweep;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = sweep > Math.PI ? 1 : 0;
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      angle = end;
      return `<path d="${path}" fill="${colors[index % colors.length]}"><title>${label}: ${value}</title></path>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${type} chart">${sectors}</svg>`;
  }

  const chartW = w - pad * 2;
  const chartH = h - pad * 2;
  if (type === "line") {
    const groupCount = data.labels.length;
    const groupW = groupCount > 1 ? chartW / (groupCount - 1) : chartW;
    const lines = data.datasets.map((dataset, dsIndex) => {
      const points = dataset.values.map((value, index) => {
        const x = pad + index * groupW;
        const y = pad + chartH - (value / max) * chartH;
        return `${x},${y}`;
      }).join(" ");
      const revealLength = Math.max(1, dataset.values.length * 40);
      return `<polyline points="${points}" fill="none" stroke="${colors[dsIndex % colors.length]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${revealLength}" stroke-dashoffset="${revealLength * (1 - progress)}"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="line chart">${lines}</svg>`;
  }

  const groupCount = data.labels.length;
  const groupW = chartW / Math.max(1, groupCount);
  const datasetCount = data.datasets.length;
  const barW = Math.max(4, (groupW * 0.7) / datasetCount);
  const bars = data.labels.flatMap((label, groupIndex) =>
    data.datasets.map((dataset, dsIndex) => {
      const value = dataset.values[groupIndex] ?? 0;
      const bh = (value / max) * chartH * progress;
      const x = pad + groupIndex * groupW + (groupW - barW * datasetCount) / 2 + dsIndex * barW;
      const y = pad + chartH - bh;
      return `<rect x="${x}" y="${y}" width="${Math.max(2, barW - 2)}" height="${bh}" rx="4" fill="${colors[dsIndex % colors.length]}"><title>${label}: ${value}</title></rect>`;
    }),
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="bar chart">${bars}</svg>`;
}

export function drawChartCanvas(ctx: CanvasRenderingContext2D, object: ChartObject, progress: number): void {
  const data = chartDataOf(object);
  const pos = object.position ?? {};
  const w = pos.w ?? 640;
  const h = pos.h ?? 360;
  const x = pos.x ?? 0;
  const y = pos.y ?? 0;
  const colors = (object.chart?.colors?.length ? object.chart.colors : [...CHART_COLORS])
    .map(resolveChartColor);
  if (!data.labels.length || !data.datasets.length) return;

  ctx.save();
  ctx.translate(x, y);
  const type = object.chart?.chartType ?? "bar";
  const pad = Math.min(48, w * 0.12);
  const values = data.datasets.flatMap((dataset) => dataset.values);
  const max = Math.max(1, ...values);
  if (type === "pie") {
    const total = Math.max(1, data.datasets[0]?.values.reduce((sum, value) => sum + Math.max(0, value), 0) ?? 1);
    let angle = -Math.PI / 2;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.36;
    data.labels.forEach((_label, index) => {
      const value = data.datasets[0]?.values[index] ?? 0;
      const sweep = (Math.max(0, value) / total) * Math.PI * 2 * progress;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + sweep);
      ctx.closePath();
      ctx.fillStyle = colors[index % colors.length];
      ctx.fill();
      angle += sweep;
    });
  } else if (type === "line") {
    const chartW = w - pad * 2;
    const chartH = h - pad * 2;
    data.datasets.forEach((dataset, dsIndex) => {
      ctx.beginPath();
      dataset.values.forEach((value, index) => {
        const px = pad + (data.labels.length <= 1 ? chartW / 2 : index * chartW / (data.labels.length - 1));
        const py = pad + chartH - (value / max) * chartH;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px * progress + (pad) * (1 - progress), py);
      });
      ctx.strokeStyle = colors[dsIndex % colors.length];
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    });
  } else {
    const chartW = w - pad * 2;
    const chartH = h - pad * 2;
    const groupW = chartW / Math.max(1, data.labels.length);
    const datasetCount = data.datasets.length;
    const barW = Math.max(2, (groupW * 0.7) / datasetCount);
    data.labels.forEach((_label, groupIndex) => {
      data.datasets.forEach((dataset, dsIndex) => {
        const value = dataset.values[groupIndex] ?? 0;
        const bh = (value / max) * chartH * progress;
        const bx = pad + groupIndex * groupW + (groupW - barW * datasetCount) / 2 + dsIndex * barW;
        ctx.fillStyle = colors[dsIndex % colors.length];
        ctx.beginPath();
        ctx.roundRect(bx, pad + chartH - bh, Math.max(2, barW - 2), bh, 4);
        ctx.fill();
      });
    });
  }
  ctx.restore();
}
