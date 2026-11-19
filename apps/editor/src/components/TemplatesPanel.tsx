/**
 * TemplatesPanel: starter templates (issue #36). Each template is a
 * small complete project the user can load and make their own; loading
 * replaces the current project (autosave keeps the previous session in
 * the snapshots panel pattern: take a snapshot first if it matters).
 */
import type { VideoProject, VideoScene } from "@finch-studio/core";
import { useState } from "react";
import { useStudioStore, makeStudioCharacter, makeStudioText } from "../store";

function scene(partial: Partial<VideoScene> & { id: string; name: string }): VideoScene {
  return {
    durationMs: 6000,
    transition: "cut",
    objects: [],
    ...partial,
  };
}

function talking(id: string, animation = "talk") {
  const c = makeStudioCharacter(id === "maya" ? "businesswoman" : "businessman");
  c.characterAnimation = animation as typeof c.characterAnimation;
  return c;
}

const TEMPLATES: { id: string; name: string; blurb: string; build: () => VideoProject }[] = [
  {
    id: "welcome",
    name: "Welcome / course intro",
    blurb: "One friendly host, title card, wave hello.",
    build: () => {
      const host = talking("maya", "wave");
      host.speech = [{ id: "w1", text: "Welcome! In this course you will learn the essentials, step by step.", start: 400, duration: 3600 }];
      const title = makeStudioText();
      (title as { content?: string }).content = "<h1>Welcome to the course</h1>";
      return { id: "tpl-welcome", name: "Welcome intro", scenes: [scene({ id: "w-s1", name: "Welcome", objects: [host, title] })] };
    },
  },
  {
    id: "safety",
    name: "Safety training (2 scenes)",
    blurb: "Host explains, second scene demonstrates the point action.",
    build: () => {
      const host = talking("maya");
      host.speech = [{ id: "s1", text: "Before you start, identify the energy source and lock it out.", start: 400, duration: 3800 }];
      const demo = talking("leo", "point");
      demo.speech = [{ id: "s2", text: "The lock goes here. Tag it, then test that the machine cannot start.", start: 400, duration: 4200 }];
      return {
        id: "tpl-safety",
        name: "Safety training",
        scenes: [
          scene({ id: "sf-s1", name: "Why it matters", objects: [host] }),
          scene({ id: "sf-s2", name: "The procedure", durationMs: 7000, objects: [demo] }),
        ],
      };
    },
  },
  {
    id: "demo",
    name: "Product demo",
    blurb: "Presenter with an explain action and a headline.",
    build: () => {
      const host = talking("leo", "explain");
      host.speech = [{ id: "d1", text: "Here is the dashboard. Everything you need is one click away.", start: 400, duration: 3800 }];
      const title = makeStudioText();
      (title as { content?: string }).content = "<h1>Meet the dashboard</h1>";
      return { id: "tpl-demo", name: "Product demo", scenes: [scene({ id: "dm-s1", name: "Demo", objects: [host, title] })] };
    },
  },
];

const MORE_TEMPLATES: typeof TEMPLATES = [
  {
    id: "onboarding",
    name: "New hire onboarding",
    blurb: "Warm welcome plus what to do in week one.",
    build: () => {
      const host = talking("maya", "wave");
      host.speech = [{ id: "o1", text: "Welcome to the team. Here is what your first week looks like.", start: 400, duration: 3600 }];
      const guide = talking("leo", "explain");
      guide.speech = [{ id: "o2", text: "Day one is setup and introductions. By Friday you will ship something small.", start: 400, duration: 4200 }];
      return { id: "tpl-onboarding", name: "New hire onboarding", scenes: [scene({ id: "ob-s1", name: "Welcome", objects: [host] }), scene({ id: "ob-s2", name: "Week one", durationMs: 7000, objects: [guide] })] };
    },
  },
  {
    id: "compliance",
    name: "Compliance reminder",
    blurb: "Short, direct, with the deadline up front.",
    build: () => {
      const host = talking("leo", "point");
      host.speech = [{ id: "c1", text: "Annual privacy training is due by the end of the month. It takes about fifteen minutes.", start: 400, duration: 4600 }];
      return { id: "tpl-compliance", name: "Compliance reminder", scenes: [scene({ id: "cp-s1", name: "Reminder", durationMs: 7000, objects: [host] })] };
    },
  },
  {
    id: "walkthrough",
    name: "Software walkthrough",
    blurb: "Presenter explains a screen, step by step.",
    build: () => {
      const host = talking("maya", "explain");
      host.speech = [{ id: "w1", text: "Open Settings, choose Notifications, and turn on the alerts you care about.", start: 400, duration: 4400 }];
      return { id: "tpl-walkthrough", name: "Software walkthrough", scenes: [scene({ id: "wt-s1", name: "Walkthrough", durationMs: 7000, objects: [host] })] };
    },
  },
  {
    id: "recap",
    name: "Lesson recap / knowledge check",
    blurb: "Recap the key point, then pose the check question.",
    build: () => {
      const host = talking("leo", "think");
      host.speech = [{ id: "r1", text: "Quick check. Which step comes first in the lockout procedure?", start: 400, duration: 3800 }];
      return { id: "tpl-recap", name: "Lesson recap", scenes: [scene({ id: "rc-s1", name: "Knowledge check", durationMs: 6500, objects: [host] })] };
    },
  },
];

TEMPLATES.push(...MORE_TEMPLATES);

export function TemplatesPanel() {
  const loadProject = useStudioStore((s) => s.loadProject);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <div className="panel">
      <div className="panel-title">Templates</div>
      {TEMPLATES.map((t) => (
        <div key={t.id} className="lib-snap">
          <span>
            <strong>{t.name}</strong>
            <br />
            <span className="muted">{t.blurb}</span>
          </span>
          {confirmId === t.id ? (
            <span>
              <button
                type="button"
                onClick={() => {
                  loadProject(t.build());
                  setConfirmId(null);
                }}
              >
                Replace project
              </button>
              <button type="button" onClick={() => setConfirmId(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmId(t.id)}>
              Use
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
