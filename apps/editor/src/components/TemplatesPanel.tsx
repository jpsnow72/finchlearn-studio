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
