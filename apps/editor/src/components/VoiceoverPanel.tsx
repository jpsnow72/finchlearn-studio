/**
 * VoiceoverPanel (issue #31): record your own voiceover for the
 * selected scene. The scene script shows as a teleprompter, a
 * countdown runs before capture, and every finished recording becomes
 * a take you can audition. Picking the best take lands it on the
 * scene voice track and sets the scene duration from the take length.
 *
 * The state machine lives in ../voiceover (VoiceoverRecorder, unit
 * tested with mocked media APIs, in the same shape as the #26 screen
 * recorder); this component wires the real navigator.mediaDevices and
 * MediaRecorder in. Real capture needs a live browser, a microphone,
 * and a user gesture, so it cannot run in automated tests.
 *
 * Rendered inside the Dialogue panel, under the generated narration
 * controls: a scene uses generated narration or a recorded voiceover,
 * and picking a take makes exports and preview use the recording
 * instead of generating the lines.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioObject } from "@finch-studio/core";
import { getAudioClipMetadata } from "../audioEditing";
import {
  isVoiceoverClip,
  makeStudioVoiceover,
  useCurrentScene,
  useStudioStore,
} from "../store";
import {
  VoiceoverRecorder,
  activeTeleprompterIndex,
  addTake,
  countdownSeconds,
  formatVoiceoverElapsed,
  makeTake,
  nextTakeName,
  removeTake,
  retimeLinesForTake,
  teleprompterCues,
  teleprompterLines,
  unsupportedVoiceoverMessage,
  type VoiceoverRecorderDeps,
  type VoiceoverState,
  type VoiceoverTake,
} from "../voiceover";

export function createBrowserVoiceoverRecorder(
  onStateChange?: (state: VoiceoverState) => void,
): VoiceoverRecorder {
  const mediaDevices =
    typeof navigator !== "undefined"
      ? (navigator.mediaDevices as unknown as VoiceoverRecorderDeps["mediaDevices"])
      : undefined;
  const MediaRecorderCtor =
    typeof window !== "undefined"
      ? (window.MediaRecorder as unknown as VoiceoverRecorderDeps["MediaRecorderCtor"])
      : undefined;
  return new VoiceoverRecorder({ mediaDevices, MediaRecorderCtor, onStateChange });
}

export function VoiceoverPanel({
  recorderFactory,
  createObjectUrl,
}: {
  /** Test seam: inject a recorder built on mocked media APIs. */
  recorderFactory?: (onStateChange: (state: VoiceoverState) => void) => VoiceoverRecorder;
  /** Test seam: jsdom has no URL.createObjectURL. */
  createObjectUrl?: (blob: Blob) => string;
} = {}) {
  const scene = useCurrentScene();
  const applyVoiceoverTake = useStudioStore((s) => s.applyVoiceoverTake);
  const clearSceneVoiceover = useStudioStore((s) => s.clearSceneVoiceover);
  const [recState, setRecState] = useState<VoiceoverState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const [note, setNote] = useState("");
  const [takes, setTakes] = useState<VoiceoverTake[]>([]);
  const takeCounter = useRef(0);
  const [recorder] = useState<VoiceoverRecorder>(() =>
    (recorderFactory ?? createBrowserVoiceoverRecorder)((next) => setRecState(next)),
  );

  const lines = useMemo(() => teleprompterLines(scene), [scene]);
  const cues = useMemo(() => teleprompterCues(lines), [lines]);
  const support = recorder.support();
  const busy =
    recState === "requesting" ||
    recState === "countdown" ||
    recState === "recording" ||
    recState === "stopping";

  const sceneVoiceover = (scene?.objects ?? []).find((o) => isVoiceoverClip(o)) as
    | AudioObject
    | undefined;
  const chosenTakeId = sceneVoiceover
    ? getAudioClipMetadata(sceneVoiceover).voiceoverTakeId
    : undefined;

  // Tick the elapsed and countdown clocks while a recording runs.
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setElapsed(recorder.elapsedMs());
      setCountdownRemaining(recorder.countdownRemainingMs());
      setRecState(recorder.getState());
    }, 200);
    return () => window.clearInterval(timer);
  }, [busy, recorder]);

  const start = async () => {
    setNote("");
    const result = await recorder.start();
    setRecState(recorder.getState());
    if (!result.ok) {
      setNote(result.message);
    }
  };

  const stop = async () => {
    const clip = await recorder.stop();
    setRecState(recorder.getState());
    if (!clip) return;
    const url = (createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob)))(
      clip.blob as Blob,
    );
    takeCounter.current += 1;
    const take = makeTake(clip, {
      id: `vo-take-${Date.now().toString(36)}-${takeCounter.current}`,
      url,
      name: nextTakeName(takes),
      createdAtMs: Date.now(),
    });
    setTakes((prev) => addTake(prev, take));
    setNote(
      `${take.name} recorded (${formatVoiceoverElapsed(take.durationMs)}). Audition the takes, then use the best one for this scene.`,
    );
  };

  const cancel = () => {
    recorder.cancel();
    setRecState(recorder.getState());
    setNote("Recording cancelled. No take was kept.");
  };

  const useTake = (take: VoiceoverTake) => {
    applyVoiceoverTake(
      makeStudioVoiceover(take.url, take.name, take.durationMs, take.id),
      retimeLinesForTake(lines, take.durationMs),
    );
    setNote(
      `${take.name} is now this scene's voiceover. The scene duration is set from the take (${formatVoiceoverElapsed(take.durationMs)}).`,
    );
  };

  const failureState =
    recState === "permission-denied" || recState === "unsupported" || recState === "error";
  const activeLine =
    recState === "recording" ? activeTeleprompterIndex(cues, elapsed) : -1;

  return (
    <div className="voiceover">
      <div className="panel-title">🎙️ Record voiceover</div>
      <p className="muted">
        Read this scene's script aloud. The chosen take becomes the scene narration and
        sets the scene duration.
      </p>
      {cues.length > 0 ? (
        <ol className="voiceover-prompter">
          {cues.map((cue, index) => (
            <li key={cue.lineId} className={index === activeLine ? "active" : ""}>
              <span className="voiceover-speaker">{cue.speaker}: </span>
              <span>{cue.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">
          This scene has no dialogue lines yet. You can still record a free voiceover, or
          add dialogue first to read from a script.
        </p>
      )}
      {!support.supported ? (
        <p className="muted">{unsupportedVoiceoverMessage(support)}</p>
      ) : recState === "requesting" ? (
        <div>
          <p className="muted">Waiting for microphone permission.</p>
          <div className="lib-row">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : recState === "countdown" ? (
        <div>
          <p>
            Get ready: {countdownSeconds(countdownRemaining)}…
          </p>
          <div className="lib-row">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : recState === "recording" || recState === "stopping" ? (
        <div>
          <p>Recording: {formatVoiceoverElapsed(elapsed)}</p>
          <div className="lib-row">
            <button type="button" onClick={() => void stop()} disabled={recState === "stopping"}>
              Stop recording
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="primary" onClick={() => void start()}>
            Record voiceover
          </button>
        </div>
      )}
      {failureState && recorder.errorMessage && <p className="muted">{recorder.errorMessage}</p>}
      {sceneVoiceover && (
        <div className="lib-row">
          <span className="muted">
            Voiceover set: {sceneVoiceover.name ?? "Voiceover"} (
            {formatVoiceoverElapsed(
              Math.round((sceneVoiceover.timing?.duration ?? 0) * 1000),
            )}
            )
          </span>
          <button type="button" onClick={() => clearSceneVoiceover()}>
            Remove voiceover
          </button>
        </div>
      )}
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      {takes.length > 0 && (
        <ul className="narration-lines">
          {takes.map((take) => (
            <li key={take.id}>
              <span className="narration-line-text">
                {take.name} ({formatVoiceoverElapsed(take.durationMs)})
                {take.id === chosenTakeId ? " · scene voiceover" : ""}
              </span>
              <audio controls src={take.url} aria-label={`Audition ${take.name}`} />
              <button
                type="button"
                onClick={() => useTake(take)}
                disabled={take.id === chosenTakeId}
              >
                Use this take
              </button>
              <button
                type="button"
                onClick={() => setTakes((prev) => removeTake(prev, take.id))}
              >
                Delete take
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
