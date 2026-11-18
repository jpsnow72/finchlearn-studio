/**
 * VideoScenePlayer — plays one VideoScene (SPEC §7.9, rev 25).
 *
 * Generic over object rendering: the host app supplies `renderObject`
 * (the course editor passes its ObjectRenderer; the standalone studio
 * passes its own). This component owns scene timing, the scene clock,
 * crossfade transitions, and dialogue/TTS scheduling.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { CourseObject, VideoScene } from "@finch-studio/core";
import { useSceneClock } from "./useSceneClock.js";
import { SceneTimeContext } from "./SceneTimeContext.js";
import { DialoguePlayer, type DialogueLine } from "./dialogue.js";
import { browserTts } from "./tts.js";
// Character limb-animation CSS ships with the new rigged characters (issue #16 design gate); the old characters.css did not move with the extraction.

export interface VideoScenePlayerProps {
  scene: VideoScene;
  /** Render one object at the current scene time. */
  renderObject: (object: CourseObject, tMs: number) => ReactNode;
  /** Incoming-transition alpha (0–1) for crossfades. Defaults to 1. */
  transitionAlpha?: number;
  autoplay?: boolean;
  loop?: boolean;
  /** Called with the dialogue player so hosts can wire voice settings. */
  onDialoguePlayer?: (player: DialoguePlayer | null) => void;
  width?: number;
  height?: number;
}

export function VideoScenePlayer({
  scene,
  renderObject,
  transitionAlpha = 1,
  autoplay = true,
  loop = false,
  onDialoguePlayer,
  width = 1280,
  height = 720,
}: VideoScenePlayerProps) {
  const clock = useSceneClock(scene.durationMs, { autoplay, loop });
  const dialogueRef = useRef<DialoguePlayer | null>(null);
  if (!dialogueRef.current) {
    dialogueRef.current = new DialoguePlayer({ provider: browserTts });
  }

  // Collect dialogue lines from character speech across the scene.
  const lines: DialogueLine[] = useMemo(() => {
    const out: DialogueLine[] = [];
    const walk = (objs: CourseObject[]) => {
      for (const o of objs) {
        if (o.type === "character") {
          for (const s of o.speech ?? []) {
            out.push({
              id: s.id,
              characterId: o.id,
              text: s.text,
              start: s.start,
              duration: s.duration,
            });
          }
        }
        const g = o as { objects?: CourseObject[] };
        if (Array.isArray(g.objects)) walk(g.objects);
      }
    };
    walk(scene.objects);
    return out.sort((a, b) => a.start - b.start);
  }, [scene]);

  useEffect(() => {
    onDialoguePlayer?.(dialogueRef.current);
    return () => onDialoguePlayer?.(null);
  }, [onDialoguePlayer]);

  // Drive dialogue from the scene clock.
  useEffect(() => {
    dialogueRef.current?.update(clock.tMs, lines);
  }, [clock.tMs, lines]);

  // Stop TTS when unmounting or when playback stops at the end.
  useEffect(() => {
    if (!clock.playing && clock.tMs >= scene.durationMs) {
      dialogueRef.current?.reset();
    }
  }, [clock.playing, clock.tMs, scene.durationMs]);

  useEffect(() => () => dialogueRef.current?.reset(), []);

  const style: CSSProperties = {
    position: "relative",
    width,
    height,
    background: scene.background ?? "#ffffff",
    overflow: "hidden",
    opacity: transitionAlpha,
  };

  return (
    <div className="vsp-scene" style={style}>
      <SceneTimeContext.Provider value={clock.tMs}>
        {scene.objects
          .filter((o) => o.visible !== false)
          .map((o) => (
            <div
              key={o.id}
              style={{
                position: "absolute",
                left: o.position?.x ?? 0,
                top: o.position?.y ?? 0,
                width: o.position?.w,
                height: o.position?.h,
              }}
            >
              {renderObject(o, clock.tMs)}
            </div>
          ))}
      </SceneTimeContext.Provider>
      <VideoSceneControls clock={clock} />
    </div>
  );
}

function VideoSceneControls({ clock }: { clock: ReturnType<typeof useSceneClock> }) {
  return (
    <div
      className="vsp-controls"
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        display: "flex",
        gap: 8,
        alignItems: "center",
        background: "rgba(0,0,0,0.55)",
        borderRadius: 8,
        padding: "4px 10px",
        color: "#fff",
        fontSize: 12,
      }}
    >
      <button onClick={clock.toggle} aria-label={clock.playing ? "Pause" : "Play"}>
        {clock.playing ? "⏸" : "▶"}
      </button>
      <button onClick={clock.replay} aria-label="Replay">
        ⟲
      </button>
      <input
        type="range"
        min={0}
        max={clock.durationMs}
        value={clock.tMs}
        onChange={(e) => clock.seek(Number(e.target.value))}
        aria-label="Seek"
        style={{ width: 160 }}
      />
      <span>
        {(clock.tMs / 1000).toFixed(1)}s / {(clock.durationMs / 1000).toFixed(1)}s
      </span>
    </div>
  );
}
