/**
 * Cue point editor (issue #64): add, edit, and delete timeline markers
 * on the current scene. Markers export as OCF cue-point metadata (see
 * cuePoints.ts and @finch-studio/schema's OCF mapping): knowledge checks
 * pause for a native OCF question, branch markers present choices,
 * modal markers open a popup, and chapter markers name a section.
 */
import { useState } from "react";
import {
  CUE_MARKER_TYPES,
  type CueMarker,
  type CueMarkerType,
} from "@finch-studio/schema";
import { useStudioStore } from "../store";
import {
  branchChoicesToText,
  parseBranchChoices,
  parseQuestionChoices,
  questionChoicesToText,
  sceneCueMarkers,
} from "../cuePoints";

export const CUE_MARKER_LABELS: Record<CueMarkerType, string> = {
  "knowledge-check": "Knowledge check",
  branch: "Branch point",
  modal: "Modal",
  chapter: "Chapter",
};

const TYPE_HINTS: Record<CueMarkerType, string> = {
  "knowledge-check":
    "Playback pauses and the learner answers the question before continuing.",
  branch: "Playback pauses and the learner picks where to go next.",
  modal: "Playback pauses and the named popup opens as a modal.",
  chapter: "A named section marker. Playback continues past it.",
};

export function CuePoints({
  tMs,
  setTMs,
}: {
  tMs: number | null;
  setTMs: (ms: number | null) => void;
}) {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const addCueMarker = useStudioStore((s) => s.addCueMarker);
  const updateCueMarker = useStudioStore((s) => s.updateCueMarker);
  const removeCueMarker = useStudioStore((s) => s.removeCueMarker);
  const [newType, setNewType] = useState<CueMarkerType>("knowledge-check");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scene = project.scenes.find((s) => s.id === currentSceneId);
  if (!scene) return null;
  const markers = sceneCueMarkers(scene);
  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const popupIds = scene.objects
    .filter((o) => o.type === "popup")
    .map((o) => o.id);

  const addAtPlayhead = () => {
    const marker = addCueMarker(newType, tMs ?? 0);
    setSelectedId(marker.id ?? null);
  };

  return (
    <section className="cue-points" aria-label="Cue points">
      <div className="cue-points-head">
        <span className="cue-points-title">Cue points</span>
        <label className="cue-type-select">
          Type
          <select
            aria-label="New cue point type"
            value={newType}
            onChange={(event) => setNewType(event.target.value as CueMarkerType)}
          >
            {CUE_MARKER_TYPES.map((type) => (
              <option key={type} value={type}>{CUE_MARKER_LABELS[type]}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={addAtPlayhead}>
          Add marker at playhead ({((tMs ?? 0) / 1000).toFixed(1)}s)
        </button>
        <span className="tl-time muted">{TYPE_HINTS[newType]}</span>
      </div>
      {markers.length === 0 ? (
        <p className="muted small">
          No cue points on this scene yet. Add one to pause the video for a
          question, a branch, or a modal when the course plays it.
        </p>
      ) : (
        <ul className="cue-marker-list">
          {markers.map((marker) => (
            <li key={marker.id ?? `${marker.atMs}-${marker.type}`}>
              <button
                type="button"
                className={selected?.id === marker.id ? "active" : ""}
                aria-label={`Edit ${CUE_MARKER_LABELS[marker.type]} marker at ${(marker.atMs / 1000).toFixed(1)} seconds`}
                onClick={() => {
                  setSelectedId(marker.id ?? null);
                  setTMs(marker.atMs);
                }}
              >
                {(marker.atMs / 1000).toFixed(1)}s · {CUE_MARKER_LABELS[marker.type]}
                {marker.label ? ` · ${marker.label}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <CueMarkerEditor
          marker={selected}
          sceneDurationMs={scene.durationMs}
          popupIds={popupIds}
          onChange={(patch) => selected.id && updateCueMarker(selected.id, patch)}
          onDelete={() => {
            if (selected.id) removeCueMarker(selected.id);
            setSelectedId(null);
          }}
        />
      )}
    </section>
  );
}

function CueMarkerEditor({
  marker,
  sceneDurationMs,
  popupIds,
  onChange,
  onDelete,
}: {
  marker: CueMarker;
  sceneDurationMs: number;
  popupIds: string[];
  onChange: (patch: Partial<CueMarker>) => void;
  onDelete: () => void;
}) {
  const question = marker.question ?? { prompt: "", choices: [] };
  const correctIndex = question.choices.findIndex(
    (choice) => choice.id === question.correctChoiceIds?.[0],
  );
  return (
    <div className="cue-marker-editor">
      <label>
        Time (seconds)
        <input
          type="number"
          min={0}
          max={sceneDurationMs / 1000}
          step={0.1}
          value={marker.atMs / 1000}
          aria-label="Marker time in seconds"
          onChange={(event) =>
            onChange({ atMs: Math.round(Number(event.target.value) * 1000) })
          }
        />
      </label>
      <label>
        Type
        <select
          aria-label="Marker type"
          value={marker.type}
          onChange={(event) =>
            // Switching type drops the payloads of the old type, so the
            // marker never carries a question on a branch marker and
            // similar mismatches the schema validator would flag.
            onChange({
              type: event.target.value as CueMarkerType,
              question: undefined,
              branchChoices: undefined,
              modalRef: undefined,
            })
          }
        >
          {CUE_MARKER_TYPES.map((type) => (
            <option key={type} value={type}>{CUE_MARKER_LABELS[type]}</option>
          ))}
        </select>
      </label>
      <label>
        Label
        <input
          type="text"
          value={marker.label ?? ""}
          aria-label="Marker label"
          placeholder="Marker name"
          onChange={(event) => onChange({ label: event.target.value || undefined })}
        />
      </label>
      <button type="button" onClick={onDelete}>Delete marker</button>

      {marker.type === "knowledge-check" && (
        <div className="cue-payload">
          <label>
            Question
            <input
              type="text"
              value={question.prompt}
              aria-label="Knowledge check question"
              placeholder="Type the question learners answer"
              onChange={(event) =>
                onChange({ question: { ...question, prompt: event.target.value } })
              }
            />
          </label>
          <label>
            Choices (one per line)
            <textarea
              rows={3}
              value={questionChoicesToText(question.choices)}
              aria-label="Knowledge check choices"
              onChange={(event) => {
                const choices = parseQuestionChoices(event.target.value, question.choices);
                const correctChoiceIds = (question.correctChoiceIds ?? []).filter((id) =>
                  choices.some((choice) => choice.id === id),
                );
                onChange({
                  question: { ...question, choices, correctChoiceIds },
                });
              }}
            />
          </label>
          <label>
            Correct choice
            <select
              aria-label="Correct choice"
              value={correctIndex >= 0 ? String(correctIndex) : ""}
              onChange={(event) => {
                const choice = question.choices[Number(event.target.value)];
                onChange({
                  question: {
                    ...question,
                    correctChoiceIds: choice ? [choice.id] : [],
                  },
                });
              }}
            >
              <option value="">Not graded</option>
              {question.choices.map((choice, i) => (
                <option key={choice.id} value={String(i)}>{choice.label}</option>
              ))}
            </select>
          </label>
          <label className="cue-check">
            <input
              type="checkbox"
              checked={question.requireCorrect ?? false}
              onChange={(event) =>
                onChange({
                  question: { ...question, requireCorrect: event.target.checked },
                })
              }
            />
            Learner must answer correctly to continue
          </label>
          <label>
            Or use an existing course question (id)
            <input
              type="text"
              value={marker.ocfRef ?? ""}
              aria-label="Existing course question id"
              placeholder="Optional question object id"
              onChange={(event) => onChange({ ocfRef: event.target.value || undefined })}
            />
          </label>
        </div>
      )}

      {marker.type === "branch" && (
        <div className="cue-payload">
          <label>
            Choices (one per line: Label @seconds, Label {"->"} page id, or Label {"->"} video id)
            <textarea
              rows={3}
              value={branchChoicesToText(marker.branchChoices ?? [])}
              aria-label="Branch choices"
              onChange={(event) =>
                onChange({
                  branchChoices: parseBranchChoices(
                    event.target.value,
                    marker.branchChoices ?? [],
                  ),
                })
              }
            />
          </label>
        </div>
      )}

      {marker.type === "modal" && (
        <div className="cue-payload">
          <label>
            Popup to open (object id)
            <input
              type="text"
              value={marker.modalRef ?? marker.ocfRef ?? ""}
              aria-label="Popup object id"
              placeholder="Popup object id"
              list={popupIds.length ? "cue-popup-ids" : undefined}
              onChange={(event) =>
                onChange({ modalRef: event.target.value || undefined })
              }
            />
          </label>
          {popupIds.length > 0 && (
            <datalist id="cue-popup-ids">
              {popupIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          )}
        </div>
      )}
    </div>
  );
}
