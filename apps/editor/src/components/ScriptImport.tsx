/**
 * ScriptImport: paste a plain text script and turn it into a project
 * (issue #55). Parsing is @finch-studio/schema's parseScript (SCENE
 * headings, NAME: dialogue lines); the parsed scenes convert to the
 * editor's project model with one character per scene and the dialogue
 * as timed speech lines (duration estimated from line length until TTS
 * timings replace it).
 */
import { useState } from "react";
import { parseScript, type StudioProject } from "@finch-studio/schema";
import type { CharacterSpeech, VideoProject, VideoScene } from "@finch-studio/core";
import { useStudioStore, makeStudioCharacter } from "../store";

const SAMPLE = `SCENE 1 - Welcome
MAYA: Welcome to safety training. Today we cover lockout basics.
LEO: Glad to be here. Where do we start?
MAYA: With the energy source. Always identify it first.

SCENE 2 - The procedure
MAYA: Step one, notify everyone affected.
LEO: Step two, shut the equipment down.`;

export function scriptToProject(parsed: StudioProject): VideoProject {
  const scenes: VideoScene[] = parsed.scenes.map((s, i) => {
    let cursor = 400;
    const speech: CharacterSpeech[] = (s.dialogue ?? []).map((line) => {
      const duration = Math.max(1400, Math.round(line.text.length * 62));
      const entry: CharacterSpeech = { id: line.id, text: line.text, start: cursor, duration };
      cursor += duration + 350;
      return entry;
    });
    const character = makeStudioCharacter(i % 2 === 0 ? "businesswoman" : "businessman");
    character.speech = speech;
    character.characterAnimation = "talk";
    return {
      id: s.id,
      name: s.name || `Scene ${i + 1}`,
      durationMs: Math.max(3000, cursor + 600),
      transition: "cut",
      objects: [character],
    } satisfies VideoScene;
  });
  return { id: parsed.id, name: parsed.name, scenes };
}

export function ScriptImport() {
  const loadProject = useStudioStore((s) => s.loadProject);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <div className="panel">
        <div className="panel-title">Script import</div>
        <button type="button" onClick={() => setOpen(true)}>Import a script</button>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title">Script import</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={"SCENE 1 - Title\nMAYA: Dialogue line one.\nLEO: Reply line."}
        style={{ width: "100%" }}
      />
      <div className="lib-row">
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => {
            const project = scriptToProject(parseScript(text, "Imported script"));
            loadProject(project);
            setNote(`Imported ${project.scenes.length} scene(s). Review and press play.`);
          }}
        >
          Build project from script
        </button>
        <button type="button" onClick={() => setText(SAMPLE)}>Load sample</button>
        <button type="button" onClick={() => setOpen(false)}>Close</button>
      </div>
      {note && <p className="muted">{note}</p>}
    </div>
  );
}
