/**
 * Deterministic script to scenes import (issue #55, promoted into
 * Round 1/2 by the Nov 18, 2026 roadmap amendment).
 *
 * Plain text or markdown in, StudioProject out. No AI: the parse is exact
 * and repeatable, so the same script always produces the same rough cut.
 *
 * Format:
 *   [Scene: Title]            starts a new scene
 *   NAME: dialogue line       a speaker tag binds the line to that speaker
 *   Any other non-empty line  a narration line (speaker "Narrator")
 *   Blank lines               ignored
 *
 * Scene duration derives from the lines: about 800 ms per word of dialogue
 * at a natural pace, with a 2 second floor, so the rough cut is watchable
 * before TTS replaces the estimates with real audio lengths.
 */
import { makeStudioProject, makeStudioScene, type StudioProject } from "./schema.js";

const MS_PER_WORD = 800;
const MIN_SCENE_MS = 2000;

const SCENE_PREFIX = "[scene:";
const SPEAKER_NAME_RE = /^[A-Z][A-Za-z0-9 .'-]{0,40}$/;

export function parseScript(script: string, projectName = "Imported script"): StudioProject {
  const project = makeStudioProject(projectName);
  project.scenes = [];
  let scene = makeStudioScene("Scene 1");
  project.scenes.push(scene);
  let sceneHasContent = false;
  let lineNo = 0;

  const pushLine = (speaker: string, text: string) => {
    lineNo += 1;
    scene.dialogue.push({ id: `line-${scene.id}-${lineNo}`, text, voiceId: undefined });
    void speaker;
    sceneHasContent = true;
  };

  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lowerLine = line.toLowerCase();
    if (lowerLine.startsWith(SCENE_PREFIX) && line.endsWith("]")) {
      const sceneName = line.slice(SCENE_PREFIX.length, -1).trim();
      if (!sceneHasContent && project.scenes.length === 1 && scene === project.scenes[0]) {
        scene.name = sceneName;
      } else {
        scene = makeStudioScene(sceneName);
        project.scenes.push(scene);
      }
      sceneHasContent = true;
      continue;
    }
    const colon = line.indexOf(":");
    const speaker = colon > 0 ? line.slice(0, colon) : "";
    const afterColon = colon > 0 ? line.slice(colon + 1) : "";
    if (
      SPEAKER_NAME_RE.test(speaker) &&
      /^\s/.test(afterColon) &&
      afterColon.trimStart()
    ) {
      pushLine(speaker, afterColon.trimStart());
    } else {
      pushLine("Narrator", line);
    }
  }

  for (const s of project.scenes) {
    const words = s.dialogue.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
    s.durationMs = Math.max(MIN_SCENE_MS, words * MS_PER_WORD);
  }
  return project;
}
