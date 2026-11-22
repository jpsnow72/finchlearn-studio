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
  projectTimeline,
  type DialogueLine,
} from "@finch-studio/animation";
import type { CharacterObject } from "@finch-studio/core";
import { TopBar } from "./components/TopBar";
import { SceneManager } from "./components/SceneManager";
import { StudioCanvas } from "./components/StudioCanvas";
import { CharacterPicker } from "./components/CharacterPicker";
import { RiggingWizard } from "./components/RiggingWizard";
import { PropsPanel } from "./components/PropsPanel";
import { DialoguePanel } from "./components/DialoguePanel";
import { TranslatePanel } from "./components/TranslatePanel";
import { MediaPanel } from "./components/MediaPanel";
import { AudioPanel } from "./components/AudioPanel";
import { RoughCutPanel } from "./components/RoughCutPanel";
import { FootagePanel } from "./components/FootagePanel";
import { MulticamPanel } from "./components/MulticamPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { ScriptImport } from "./components/ScriptImport";
import { TemplatesPanel } from "./components/TemplatesPanel";
import { MotionGraphicsPanel } from "./components/MotionGraphicsPanel";
import { CaptionsPanel } from "./components/CaptionsPanel";
import { Timeline } from "./components/Timeline";
import { useStudioStore, useCurrentScene, makeStudioShape, makeStudioText, makeStudioChart, characterVoiceId, isVoiceoverClip } from "./store";
import { narrationTts } from "./narrationProvider";
import { syncProjectToCloud } from "./cloud";

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
  const [flyout, setFlyout] = useState<"characters" | "media" | "templates" | "script" | "captions" | "rigging" | null>("characters");
  const clock = useSceneClock(scene?.durationMs ?? 5000, { loop: true });
  const dialogueRef = useRef(new DialoguePlayer({ provider: narrationTts }));

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

  // Drive TTS dialogue from the clock. A scene with a chosen recorded
  // voiceover (#31) does not also speak its lines with TTS in preview;
  // exports mix the recording itself (see buildProjectAudio).
  useEffect(() => {
    if (!scene) return;
    if (!clock.playing) return;
    if (scene.objects.some((o) => isVoiceoverClip(o))) return;
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
        const voice = characterVoiceId(c);
        if (voice) line.voiceId = voice;
        return line;
      }),
    );
    dialogueRef.current.update(clock.tMs, lines);
  }, [clock.tMs, clock.playing, scene?.id]);

  // Cloud save: keep the signed-in account's durable copy current
  // (debounced; no-ops when signed out). localStorage stays the
  // working copy, the cloud row is what the hub restores from.
  useEffect(() => {
    const timer = setTimeout(() => {
      void syncProjectToCloud(project);
    }, 4000);
    return () => clearTimeout(timer);
  }, [project]);

  const totalExportMs = projectTimeline(project).totalMs;

  const [coach, setCoach] = useState(() => {
    try {
      return !localStorage.getItem("finch-studio.coach-dismissed");
    } catch {
      return false;
    }
  });

  return (
    <div className="studio">
      <TopBar />
      {coach && (
        <div className="coachbar">
          <strong>Quick start:</strong>
          <span>1. Click Maya on the stage and edit her line in Dialogue</span>
          <span>2. Change her action in Properties</span>
          <span>3. Press Export and pick MP4 fast export</span>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem("finch-studio.coach-dismissed", "1");
              } catch {
                // ignore
              }
              setCoach(false);
            }}
          >
            Got it
          </button>
        </div>
      )}
      <SceneManager />
      <div className="studio-main">
        <nav className="studio-rail" aria-label="Editor panels">
          <button type="button" className={flyout === "characters" ? "active" : ""} onClick={() => setFlyout(flyout === "characters" ? null : "characters")} title="Characters and objects">🧑</button>
          <button type="button" className={flyout === "media" ? "active" : ""} onClick={() => setFlyout(flyout === "media" ? null : "media")} title="Media library">🖼️</button>
          <button type="button" className={flyout === "templates" ? "active" : ""} onClick={() => setFlyout(flyout === "templates" ? null : "templates")} title="Templates">📐</button>
          <button type="button" className={flyout === "script" ? "active" : ""} onClick={() => setFlyout(flyout === "script" ? null : "script")} title="Script import">📜</button>
          <button type="button" className={flyout === "captions" ? "active" : ""} onClick={() => setFlyout(flyout === "captions" ? null : "captions")} title="Captions" aria-label="Captions (CC)">CC</button>
          <button type="button" className={flyout === "rigging" ? "active" : ""} onClick={() => setFlyout(flyout === "rigging" ? null : "rigging")} title="Custom character rigging" aria-label="Custom character rigging">🧍</button>
        </nav>
        {flyout && (
          <aside className="studio-left studio-flyout">
            {flyout === "characters" && (
              <>
                <CharacterPicker />
                <div className="panel">
                  <div className="panel-title">Add to scene</div>
                  <ObjectAdder />
                </div>
              </>
            )}
            {flyout === "media" && <MediaPanel />}
            {flyout === "templates" && (
              <>
                <TemplatesPanel />
                <MotionGraphicsPanel />
              </>
            )}
            {flyout === "script" && <ScriptImport />}
            {flyout === "captions" && <CaptionsPanel />}
            {flyout === "rigging" && <RiggingWizard />}
          </aside>
        )}
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
          <TranslatePanel />
          <AudioPanel tMs={clock.tMs} />
          <RoughCutPanel />
          <FootagePanel tMs={clock.tMs} />
          <MulticamPanel tMs={clock.tMs} />
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
      <button type="button" onClick={() => addObject(makeStudioChart("bar"))}>
        Bar chart
      </button>
      <button type="button" onClick={() => addObject(makeStudioChart("line"))}>
        Line chart
      </button>
      <button type="button" onClick={() => addObject(makeStudioChart("pie"))}>
        Pie chart
      </button>
    </div>
  );
}
