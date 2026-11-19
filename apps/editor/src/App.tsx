/**
 * Video Studio app shell.
 *
 * Layout: topbar → scene manager | canvas + timeline | properties.
 * The preview clock drives the canvas; playback loops the current scene
 * and speaks dialogue lines via the TTS provider.
 */
import { useEffect, useRef, useState } from "react";
import {
  useSceneClock,
  DialoguePlayer,
  browserTts,
  projectTimeline,
  type DialogueLine,
} from "@finch-studio/animation";
import type { CharacterObject } from "@finch-studio/core";
import { TopBar } from "./components/TopBar";
import { SceneManager } from "./components/SceneManager";
import { StudioCanvas } from "./components/StudioCanvas";
import { CharacterPicker } from "./components/CharacterPicker";
import { PropsPanel } from "./components/PropsPanel";
import { DialoguePanel } from "./components/DialoguePanel";
import { Timeline } from "./components/Timeline";
import { useStudioStore, useCurrentScene, makeStudioShape, makeStudioText } from "./store";

export function App() {
  const scene = useCurrentScene();
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const tts = useStudioStore((s) => s.tts);

  const [pathEdit, setPathEdit] = useState(false);
  const clock = useSceneClock(scene?.durationMs ?? 5000, { loop: true });
  const dialogueRef = useRef(new DialoguePlayer({ provider: browserTts }));

  // Reset clock + dialogue when switching scenes.
  useEffect(() => {
    clock.replay();
    clock.pause();
    clock.seek(0);
    dialogueRef.current.reset();
  }, [currentSceneId]);

  // Drive TTS dialogue from the clock.
  useEffect(() => {
    if (!scene) return;
    if (!clock.playing) return;
    const lines = (
      scene.objects.filter((o) => o.type === "character") as CharacterObject[]
    ).flatMap((c) =>
      (c.speech ?? []).map((s) => {
        const line: DialogueLine = {
          id: s.id,
          characterId: c.characterId,
          text: s.text,
          start: s.start,
          duration: s.duration,
          rate: tts.rate,
          pitch: tts.pitch,
        };
        if (tts.voiceId !== undefined) line.voiceId = tts.voiceId;
        return line;
      }),
    );
    dialogueRef.current.update(clock.tMs, lines);
  }, [clock.tMs, clock.playing, scene?.id]);

  const totalExportMs = projectTimeline(project).totalMs;

  return (
    <div className="studio">
      <TopBar />
      <SceneManager />
      <div className="studio-main">
        <aside className="studio-left">
          <CharacterPicker />
          <div className="panel">
            <div className="panel-title">Add to scene</div>
            <ObjectAdder />
          </div>
        </aside>
        <main className="studio-center">
          <StudioCanvas tMs={clock.playing ? clock.tMs : null} pathEdit={pathEdit} />
          <Timeline
            playing={clock.playing}
            setPlaying={(v) => (v ? clock.play() : clock.pause())}
            tMs={clock.playing ? clock.tMs : null}
            setTMs={(ms) => clock.seek(ms ?? 0)}
          />
          <div className="export-plan muted">
            Export plan: {project.scenes.length} scene{project.scenes.length === 1 ? "" : "s"},{" "}
            {(totalExportMs / 1000).toFixed(1)}s total
          </div>
        </main>
        <aside className="studio-right">
          <PropsPanel pathEdit={pathEdit} setPathEdit={setPathEdit} />
          <DialoguePanel />
        </aside>
      </div>
    </div>
  );
}

function ObjectAdder() {
  const addObject = useStudioStore((s) => s.addObject);
  return (
    <div className="adder-row">
      <button type="button" onClick={() => addObject(makeStudioText())}>
        T Text
      </button>
      <button type="button" onClick={() => addObject(makeStudioShape())}>
        ▢ Shape
      </button>
    </div>
  );
}
