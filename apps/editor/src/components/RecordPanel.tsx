/**
 * RecordPanel (issue #26): record the screen, the webcam, or both from
 * the browser and drop the take into the current scene as footage.
 *
 * The state machine lives in @finch-studio/media (StudioRecorder, unit
 * tested with mocked media APIs); this component wires the real
 * navigator.mediaDevices and MediaRecorder in, shows the recording
 * state (elapsed time, stop, cancel), and hands a finished clip to the
 * scene through recordedClipToAsset plus makeStudioVideo, the same
 * ingest handoff shape as uploaded footage. Real capture needs a live
 * browser and a user gesture, so it cannot run in automated tests.
 */
import { useEffect, useRef, useState } from "react";
import {
  StudioRecorder,
  formatRecordingElapsed,
  recordedClipToAsset,
  recordingModeLabel,
  unsupportedRecordingMessage,
  type MediaAsset,
  type RecordedClip,
  type RecorderDeps,
  type RecordingMode,
  type RecordingState,
} from "@finch-studio/media";
import { makeStudioVideo, useStudioStore } from "../store";

const MODES: RecordingMode[] = ["screen", "webcam", "screen-and-webcam"];

export function createBrowserRecorder(
  onStateChange?: (state: RecordingState) => void,
): StudioRecorder {
  const mediaDevices =
    typeof navigator !== "undefined"
      ? (navigator.mediaDevices as unknown as RecorderDeps["mediaDevices"])
      : undefined;
  const MediaRecorderCtor =
    typeof window !== "undefined"
      ? (window.MediaRecorder as unknown as RecorderDeps["MediaRecorderCtor"])
      : undefined;
  return new StudioRecorder({ mediaDevices, MediaRecorderCtor, onStateChange });
}

interface Take {
  asset: MediaAsset;
  url: string;
}

export function RecordPanel({
  recorderFactory,
  createObjectUrl,
}: {
  /** Test seam: inject a recorder built on mocked media APIs. */
  recorderFactory?: (onStateChange: (state: RecordingState) => void) => StudioRecorder;
  /** Test seam: jsdom has no URL.createObjectURL. */
  createObjectUrl?: (blob: Blob) => string;
} = {}) {
  const addObject = useStudioStore((s) => s.addObject);
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [recState, setRecState] = useState<RecordingState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState("");
  const [takes, setTakes] = useState<Take[]>([]);
  const takeCounter = useRef(0);
  const handedOff = useRef<RecordedClip | null>(null);
  const [recorder] = useState<StudioRecorder>(() =>
    (recorderFactory ?? createBrowserRecorder)((next) => setRecState(next)),
  );

  const support = recorder.support(mode);
  const busy = recState === "requesting" || recState === "recording" || recState === "stopping";

  const handoff = (clip: RecordedClip | null) => {
    if (!clip || handedOff.current === clip) return;
    handedOff.current = clip;
    const url = (createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob)))(
      clip.blob as Blob,
    );
    takeCounter.current += 1;
    const asset = recordedClipToAsset(clip, {
      id: `usr-rec-${Date.now().toString(36)}-${takeCounter.current}`,
      url,
    });
    addObject(makeStudioVideo(url, asset.name, asset.durationMs));
    setTakes((prev) => [{ asset, url }, ...prev]);
    setNote(`Added "${asset.name}" to the scene. Trim it on the timeline like other footage.`);
  };

  // Tick the elapsed clock, and pick up a browser initiated stop (the
  // user ends screen sharing from the browser chrome) whose clip has
  // no awaiting caller.
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setElapsed(recorder.elapsedMs());
      const state = recorder.getState();
      setRecState(state);
      if (state === "done") handoff(recorder.getLastClip());
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, recorder]);

  const start = async () => {
    setNote("");
    const result = await recorder.start(mode);
    setRecState(recorder.getState());
    if (!result.ok) {
      setNote(result.message);
    }
  };

  const stop = async () => {
    const clip = await recorder.stop();
    setRecState(recorder.getState());
    handoff(clip ?? recorder.getLastClip());
  };

  const cancel = () => {
    recorder.cancel();
    setRecState(recorder.getState());
    setNote("Recording cancelled. Nothing was added to the scene.");
  };

  const failureState =
    recState === "permission-denied" || recState === "unsupported" || recState === "error";

  return (
    <div>
      <div className="media-tabs" role="tablist" aria-label="Recording mode">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "active" : ""}
            onClick={() => setMode(m)}
            disabled={busy}
          >
            {recordingModeLabel(m)}
          </button>
        ))}
      </div>
      {!support.supported ? (
        <p className="muted">{unsupportedRecordingMessage(support)}</p>
      ) : recState === "requesting" ? (
        <div>
          <p className="muted">
            Waiting for permission. Use the browser prompt to choose what to share.
          </p>
          <div className="lib-row">
            <button type="button" onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : recState === "recording" || recState === "stopping" ? (
        <div>
          <p>
            Recording {recordingModeLabel(mode).toLowerCase()}: {formatRecordingElapsed(elapsed)}
          </p>
          <div className="lib-row">
            <button type="button" onClick={() => void stop()} disabled={recState === "stopping"}>
              Stop recording
            </button>
            <button type="button" onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <p className="muted">
            {mode === "screen" &&
              "Record your screen or a window. Your browser will ask what to share."}
            {mode === "webcam" && "Record from your camera and microphone."}
            {mode === "screen-and-webcam" &&
              "Record your screen and your webcam together into one clip."}
          </p>
          <button type="button" className="primary" onClick={() => void start()}>
            Record {recordingModeLabel(mode).toLowerCase()}
          </button>
        </div>
      )}
      {failureState && recorder.errorMessage && (
        <p className="muted">{recorder.errorMessage}</p>
      )}
      {note && <p className="muted">{note}</p>}
      {takes.length > 0 && (
        <div>
          {takes.map((take) => (
            <div key={take.asset.id} className="lib-snap">
              <span>
                {take.asset.name}{" "}
                <span className="muted">
                  {formatRecordingElapsed(take.asset.durationMs ?? 0)}
                </span>
              </span>
              <button
                type="button"
                onClick={() =>
                  addObject(
                    makeStudioVideo(take.url, take.asset.name, take.asset.durationMs),
                  )
                }
              >
                Add to scene
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
