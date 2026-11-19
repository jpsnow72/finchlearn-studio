/**
 * variables.ts — issue #66 variable injection: the pure half of
 * parameterized template rendering. Given a cloned template project
 * and a variable set, produce the project to render. No I/O here;
 * every problem is a caller-actionable VideoToolError.
 *
 * Injection rules (the #66 contract):
 * - scriptLines: replace dialogue text. Keyed by dialogue line id
 *   when the key matches a line in the project; otherwise keys are
 *   scene ids (replace that scene's lines in order from an array
 *   value is NOT supported here; use per-line ids or the ordered
 *   `script` list on the render tool for whole-script replacement).
 *   The simpler ordered form lives in applyScriptLines: an array of
 *   {sceneIndex?, lineIndex?, text} applied in project order.
 * - voiceId: set on every dialogue line (the TTS voice for the whole
 *   render), validated against the @finch-studio/audio catalogue.
 * - brandKitId: stamps project.brandKitRef (the Studio brand kit
 *   reference the schema carries; FinchLearn brand kits map onto it
 *   through the same ref the editor's brand flow writes).
 * - chartCsv: replace a chart element's CSV, keyed by element id or
 *   by scene id (first chart in that scene). CSV is validated: a
 *   header row plus at least one data row, consistent column counts.
 * - localizedText: replace text-element content and dialogue text by
 *   element/line id for a locale pass; also records the locale on
 *   the caption track list when a track for it does not exist yet.
 * - projectName: rename the clone.
 *
 * Unknown ids are errors, never silent no-ops: a headless caller
 * must learn that an injection missed.
 */
import { voiceById } from "@finch-studio/audio";
import type { StudioProject } from "@finch-studio/schema";
import { invalid } from "./errors.js";

export interface TemplateVariables {
  projectName?: string;
  /** Dialogue text by dialogue line id. */
  scriptLines?: Record<string, string>;
  /** Ordered dialogue replacement: applied to lines in project order. */
  script?: { sceneIndex?: number; lineIndex?: number; text: string }[];
  /** TTS voice id for every dialogue line (catalogue id). */
  voiceId?: string;
  brandKitId?: string;
  /** Chart CSV by chart element id, or by scene id for its first chart. */
  chartCsv?: Record<string, string>;
  /** Replacement text by text-element id or dialogue line id. */
  localizedText?: Record<string, string>;
  /** BCP-47 locale the localizedText is written in, when known. */
  locale?: string;
}

export function validateChartCsv(csv: string): string[] {
  const problems: string[] = [];
  const rows = csv.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (rows.length < 2) {
    problems.push("Chart CSV needs a header row and at least one data row.");
    return problems;
  }
  const width = rows[0].split(",").length;
  if (width < 2) problems.push("Chart CSV needs at least two columns.");
  rows.forEach((row, i) => {
    if (row.split(",").length !== width) {
      problems.push(`Chart CSV row ${i + 1} has a different column count than the header.`);
    }
  });
  return problems;
}

function allLines(project: StudioProject) {
  return project.scenes.flatMap((scene, sceneIndex) =>
    scene.dialogue.map((line, lineIndex) => ({ scene, sceneIndex, line, lineIndex })),
  );
}

/** Apply a variable set to a cloned project in place; returns a summary. */
export function injectVariables(
  project: StudioProject,
  vars: TemplateVariables,
): { applied: string[] } {
  const applied: string[] = [];

  if (vars.projectName !== undefined) {
    if (!vars.projectName.trim()) throw invalid("projectName must not be empty.");
    project.name = vars.projectName;
    applied.push("projectName");
  }

  if (vars.brandKitId !== undefined) {
    if (!vars.brandKitId.trim()) throw invalid("brandKitId must not be empty.");
    project.brandKitRef = vars.brandKitId;
    applied.push("brandKitId");
  }

  if (vars.voiceId !== undefined) {
    if (!voiceById(vars.voiceId)) {
      throw invalid(
        `Unknown voice id "${vars.voiceId}". Use a voice id from the FinchLearn narration catalogue.`,
      );
    }
    for (const { line } of allLines(project)) line.voiceId = vars.voiceId;
    applied.push("voiceId");
  }

  if (vars.scriptLines) {
    const byId = new Map(allLines(project).map(({ line }) => [line.id, line]));
    for (const [lineId, text] of Object.entries(vars.scriptLines)) {
      const line = byId.get(lineId);
      if (!line) throw invalid(`scriptLines names dialogue line "${lineId}", which is not in this project.`);
      line.text = text;
      // New text invalidates any audio generated for the old text.
      delete line.audio;
      delete line.wordTimings;
    }
    applied.push("scriptLines");
  }

  if (vars.script) {
    const lines = allLines(project);
    vars.script.forEach((entry, position) => {
      const target =
        entry.sceneIndex !== undefined || entry.lineIndex !== undefined
          ? lines.find(
              ({ sceneIndex, lineIndex }) =>
                sceneIndex === (entry.sceneIndex ?? 0) && lineIndex === (entry.lineIndex ?? 0),
            )
          : lines[position];
      if (!target) {
        throw invalid(
          `script entry for scene ${entry.sceneIndex ?? "?"} line ${entry.lineIndex ?? "?"} does not match a dialogue line in this project.`,
        );
      }
      target.line.text = entry.text;
      delete target.line.audio;
      delete target.line.wordTimings;
    });
    applied.push("script");
  }

  if (vars.chartCsv) {
    for (const [key, csv] of Object.entries(vars.chartCsv)) {
      const problems = validateChartCsv(csv);
      if (problems.length) throw invalid(problems.join(" "));
      let done = false;
      for (const scene of project.scenes) {
        for (const el of scene.elements) {
          if (el.kind === "chart" && (el.id === key || scene.id === key)) {
            el.csv = csv;
            done = true;
            break;
          }
        }
        if (done) break;
      }
      if (!done) throw invalid(`chartCsv names "${key}", which is not a chart element id or a scene with a chart in this project.`);
    }
    applied.push("chartCsv");
  }

  if (vars.localizedText) {
    const lineById = new Map(allLines(project).map(({ line }) => [line.id, line]));
    for (const [id, text] of Object.entries(vars.localizedText)) {
      let done = false;
      const line = lineById.get(id);
      if (line) {
        line.text = text;
        delete line.audio;
        delete line.wordTimings;
        done = true;
      } else {
        for (const scene of project.scenes) {
          const el = scene.elements.find((e) => e.id === id && e.kind === "text");
          if (el && el.kind === "text") {
            el.text = text;
            done = true;
            break;
          }
        }
      }
      if (!done) throw invalid(`localizedText names "${id}", which is not a dialogue line or text element in this project.`);
    }
    if (vars.locale) {
      project.captions = project.captions ?? [];
      if (!project.captions.some((c) => c.lang === vars.locale)) {
        project.captions.push({ id: `cap-${vars.locale}`, lang: vars.locale });
      }
    }
    applied.push("localizedText");
  }

  return { applied };
}
