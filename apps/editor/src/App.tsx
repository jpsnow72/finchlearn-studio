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
import { MediaPanel } from "./components/MediaPanel";
import { AudioPanel } from "./components/AudioPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { ScriptImport } from "./components/ScriptImport";
import { TemplatesPanel } from "./components/TemplatesPanel";
import { Timeline } from "./components/Timeline";
import { useStudioStore, useCurrentScene, makeStudioShape, makeStudioText } from "./store";

export function App() {
  const scene = useCurrentScene();
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const tts = useStudioStore((s) => s.tts);
  const splitTimelineAt = useStudioStore((s) => s.splitTimelineAt);
  const toggleTimelineSnap = useStudioStore((s) => s.toggleTimelineSnap);
  const rippleDeleteGapAt = useStudioStore((s) => s.rippleDeleteGapAt);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const focusedInput = target?.closest("input") as HTMLInputElement | null;
      if (
        target?.isContentEditable ||
        target?.closest("textarea, select, [contenteditable='true']") ||
        (focusedInput && focusedInput.type !== "range")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && key === "b") {
        event.preventDefault();
        splitTimelineAt(clock.tMs);
      } else if (key === "j" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const nextRate = clock.playbackRate <= -4
          ? -1
          : clock.playbackRate < 0
            ? clock.playbackRate * 2
            : -1;
        clock.setPlaybackRate(nextRate);
      } else if (key === "k" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        clock.pause();
      } else if (key === "l" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const nextRate = clock.playbackRate >= 4
          ? 1
          : clock.playbackRate > 0
            ? clock.playbackRate * 2
            : 1;
        clock.setPlaybackRate(nextRate);
      } else if (key === "s" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        toggleTimelineSnap();
      } else if (event.key === "Backspace" && event.shiftKey) {
        event.preventDefault();
        rippleDeleteGapAt(clock.tMs);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clock.pause,
    clock.playbackRate,
    clock.setPlaybackRate,
    clock.tMs,
    redo,
    rippleDeleteGapAt,
    splitTimelineAt,
    toggleTimelineSnap,
    undo,
  ]);

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
          <MediaPanel />
          <TemplatesPanel />
          <ScriptImport />
        </aside>
        <main className="studio-center">
          <StudioCanvas tMs={clock.tMs} pathEdit={pathEdit} />
          <Timeline
            playing={clock.playing}
            setPlaying={(v) => (v ? clock.play() : clock.pause())}
            tMs={clock.tMs}
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
          <AudioPanel tMs={clock.tMs} />
          <LibraryPanel />
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
