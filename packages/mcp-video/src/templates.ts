/**
 * templates.ts — the built-in template catalog the video tools build
 * from: whole-project templates (clone targets for issue #66) and
 * single-scene templates (add_scene_from_template, issue #50).
 *
 * These mirror the editor's seven starter templates
 * (apps/editor/src/components/TemplatesPanel.tsx: welcome, safety,
 * demo, onboarding, compliance, walkthrough, recap) re-expressed in
 * the StudioProject contract. The editor's builders are component-local
 * VideoProject factories today; if the ship coordinator prefers one
 * catalog, this is the copy to promote and point the panel at.
 *
 * A template's dialogue lines and text elements are its injectable
 * surface for issue #66: variables.ts replaces them by line id /
 * element id, or by scene order when ids are not supplied.
 */
import {
  makeStudioProject,
  makeStudioScene,
  newStudioId,
  type StudioProject,
  type StudioScene,
} from "@finch-studio/schema";

export interface ProjectTemplate {
  id: string;
  name: string;
  blurb: string;
  build: () => StudioProject;
}

export interface SceneTemplate {
  id: string;
  name: string;
  blurb: string;
  build: () => StudioScene;
}

function hostScene(
  name: string,
  characterRef: string,
  action: string,
  lineId: string,
  lineText: string,
  durationMs = 6000,
): StudioScene {
  const scene = makeStudioScene(name);
  scene.durationMs = durationMs;
  const line = { id: lineId, text: lineText };
  scene.dialogue.push(line);
  scene.elements.push({
    kind: "character",
    id: newStudioId("el"),
    startMs: 0,
    durationMs,
    characterRef,
    action,
    dialogueLineId: lineId,
  });
  return scene;
}

function titleElement(text: string) {
  return {
    kind: "text" as const,
    id: newStudioId("el"),
    startMs: 0,
    durationMs: 5000,
    text,
  };
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "welcome",
    name: "Welcome / course intro",
    blurb: "One friendly host, title card, wave hello.",
    build: () => {
      const p = makeStudioProject("Welcome intro");
      p.scenes = [
        (() => {
          const s = hostScene("Welcome", "maya", "wave", "line-welcome", "Welcome! In this course you will learn the essentials, step by step.");
          s.elements.push(titleElement("Welcome to the course"));
          return s;
        })(),
      ];
      return p;
    },
  },
  {
    id: "safety",
    name: "Safety training (2 scenes)",
    blurb: "Host explains, second scene demonstrates the point action.",
    build: () => {
      const p = makeStudioProject("Safety training");
      p.scenes = [
        hostScene("Why it matters", "maya", "talk", "line-safety-1", "Before you start, identify the energy source and lock it out."),
        hostScene("The procedure", "leo", "point", "line-safety-2", "The lock goes here. Tag it, then test that the machine cannot start.", 7000),
      ];
      return p;
    },
  },
  {
    id: "demo",
    name: "Product demo",
    blurb: "Presenter with an explain action and a headline.",
    build: () => {
      const p = makeStudioProject("Product demo");
      const s = hostScene("Demo", "leo", "explain", "line-demo", "Here is the dashboard. Everything you need is one click away.");
      s.elements.push(titleElement("Meet the dashboard"));
      p.scenes = [s];
      return p;
    },
  },
  {
    id: "onboarding",
    name: "New hire onboarding",
    blurb: "Warm welcome plus what to do in week one.",
    build: () => {
      const p = makeStudioProject("New hire onboarding");
      p.scenes = [
        hostScene("Welcome", "maya", "wave", "line-onboard-1", "Welcome to the team. Here is what your first week looks like."),
        hostScene("Week one", "leo", "explain", "line-onboard-2", "Day one is setup and introductions. By Friday you will ship something small.", 7000),
      ];
      return p;
    },
  },
  {
    id: "compliance",
    name: "Compliance reminder",
    blurb: "Short, direct, with the deadline up front.",
    build: () => {
      const p = makeStudioProject("Compliance reminder");
      p.scenes = [
        hostScene("Reminder", "leo", "point", "line-compliance", "Annual privacy training is due by the end of the month. It takes about fifteen minutes.", 7000),
      ];
      return p;
    },
  },
  {
    id: "walkthrough",
    name: "Software walkthrough",
    blurb: "Presenter explains a screen, step by step.",
    build: () => {
      const p = makeStudioProject("Software walkthrough");
      p.scenes = [
        hostScene("Walkthrough", "maya", "explain", "line-walkthrough", "Open Settings, choose Notifications, and turn on the alerts you care about.", 7000),
      ];
      return p;
    },
  },
  {
    id: "recap",
    name: "Lesson recap / knowledge check",
    blurb: "Recap the key point, then pose the check question.",
    build: () => {
      const p = makeStudioProject("Lesson recap");
      p.scenes = [
        hostScene("Knowledge check", "leo", "think", "line-recap", "Quick check. Which step comes first in the lockout procedure?", 6500),
      ];
      return p;
    },
  },
  {
    id: "chart-brief",
    name: "Chart brief",
    blurb: "Host introduces a chart whose data is injected per render (issue #66).",
    build: () => {
      const p = makeStudioProject("Chart brief");
      const s = hostScene("The numbers", "maya", "explain", "line-chart", "Here is how the quarter went.");
      s.elements.push({
        kind: "chart",
        id: "chart-main",
        startMs: 0,
        durationMs: 6000,
        chartType: "bar",
        csv: "label,value\nStart,0",
      });
      p.scenes = [s];
      return p;
    },
  },
];

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: "host-intro",
    name: "Host intro",
    blurb: "A host character with one dialogue line, ready for set_scene_dialogue.",
    build: () => hostScene("Host intro", "maya", "talk", newStudioId("line"), "Your intro line here."),
  },
  {
    id: "host-point",
    name: "Host point",
    blurb: "A host character pointing, with one dialogue line.",
    build: () => hostScene("Key point", "leo", "point", newStudioId("line"), "The key point goes here."),
  },
  {
    id: "title-card",
    name: "Title card",
    blurb: "One full-duration text element and no dialogue.",
    build: () => {
      const s = makeStudioScene("Title card");
      s.elements.push(titleElement("Your title here"));
      return s;
    },
  },
  {
    id: "chart-scene",
    name: "Chart scene",
    blurb: "One chart element with placeholder CSV data.",
    build: () => {
      const s = makeStudioScene("Chart");
      s.elements.push({
        kind: "chart",
        id: newStudioId("el"),
        startMs: 0,
        durationMs: 5000,
        chartType: "bar",
        csv: "label,value\nA,1\nB,2",
      });
      return s;
    },
  },
];

export function projectTemplateById(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

export function sceneTemplateById(id: string): SceneTemplate | undefined {
  return SCENE_TEMPLATES.find((t) => t.id === id);
}
