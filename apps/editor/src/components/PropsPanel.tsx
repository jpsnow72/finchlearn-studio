/**
 * PropsPanel — inspector for the selected scene object.
 *
 * Character: animation, facing, colors, waypoints (curve/speed), speech lines.
 * Text: content. Shape: fill. All: name, position/size.
 */
import { useState } from "react";
import type {
  AnimationPreset,
  AnimationPresetName,
  CharacterAnimationName,
  CharacterFacing,
  CharacterObject,
  CharacterSpeech,
  CourseObject,
  KenBurnsFrame,
} from "@finch-studio/core";
import { ANIMATION_PRESETS, CHARACTER_ANIMATIONS, CHARACTER_ANIMATION_GROUPS, DEFAULT_KEN_BURNS } from "@finch-studio/core";
import {
  applyKenBurns,
  applyKineticText,
  clearKenBurns,
  clearKineticText,
  getMotionMeta,
  isKineticPresetName,
  isMotionGraphicMeta,
  motionGraphicGroupOf,
  newVideoId,
  rebuildMotionGraphic,
  type KineticPresetName,
  type MotionGraphicMeta,
  type MotionGraphicParams,
} from "@finch-studio/animation";
import { useStudioStore, useCurrentScene, useSelectedObject } from "../store";
import {
  ACTION_CATALOGUE,
  INTERACTIONS,
  INTERACTION_NAMES,
  isInteractionRoleAction,
} from "@finch-studio/characters";
import type { CourseObject } from "@finch-studio/core";
import {
  NEUTRAL_COLOR_CORRECTION,
  computeAutoFixForObject,
  getObjectColorCorrection,
  isColorCorrectableObject,
  isNeutralColorCorrection,
  type ColorCorrection,
} from "../colorCorrection";
import { drawOnForObject, whiteboardForScene } from "../drawOn";
import type { WhiteboardHandStyle } from "@finch-studio/motion";

let speechCounter = 0;

export function PropsPanel({
  pathEdit,
  setPathEdit,
}: {
  pathEdit: boolean;
  setPathEdit: (v: boolean) => void;
}) {
  const obj = useSelectedObject();
  const scene = useCurrentScene();
  const updateObject = useStudioStore((s) => s.updateObject);
  const setObjectPresets = useStudioStore((s) => s.setObjectPresets);
  const setScenePresets = useStudioStore((s) => s.setScenePresets);
  const setObjectDrawOn = useStudioStore((s) => s.setObjectDrawOn);
  const setSceneWhiteboard = useStudioStore((s) => s.setSceneWhiteboard);
  const removeObject = useStudioStore((s) => s.removeObject);
  const setCharAnimation = useStudioStore((s) => s.setCharAnimation);
  const setCharFacing = useStudioStore((s) => s.setCharFacing);
  const applyInteraction = useStudioStore((s) => s.applyInteraction);
  const setCharColors = useStudioStore((s) => s.setCharColors);
  const updateWaypoint = useStudioStore((s) => s.updateWaypoint);
  const removeWaypoint = useStudioStore((s) => s.removeWaypoint);
  const addSpeech = useStudioStore((s) => s.addSpeech);
  const updateSpeech = useStudioStore((s) => s.updateSpeech);
  const removeSpeech = useStudioStore((s) => s.removeSpeech);

  const presets = obj
    ? obj.animations?.presets ?? []
    : scene?.animations?.presets ?? [];
  const updatePresets = (next: AnimationPreset[]) => {
    if (obj) setObjectPresets(obj.id, next);
    else if (scene) setScenePresets(scene.id, next);
  };
  const effectsPanel = (
    <div className="panel effects-panel">
      <div className="panel-title">Effects</div>
      <p className="muted">{obj ? "Object effects" : "Scene effects"}</p>
      <EffectsEditor presets={presets} onChange={updatePresets} />
    </div>
  );

  if (!obj) {
    const sceneWhiteboard = scene ? whiteboardForScene(scene) : undefined;
    return (
      <>
        {effectsPanel}
        <div className="panel props-panel">
          <div className="panel-title">Properties</div>
          <p className="muted">Select an object on the stage.</p>
          {scene && (
            <>
              <div className="sub-title">Whiteboard scene</div>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={sceneWhiteboard !== undefined}
                  onChange={(e) =>
                    setSceneWhiteboard(
                      scene.id,
                      e.target.checked
                        ? { surface: scene.background ?? "#ffffff" }
                        : undefined,
                    )
                  }
                />
                Whiteboard style for this scene
              </label>
              {sceneWhiteboard !== undefined && (
                <label className="field">
                  <span>Board surface</span>
                  <input
                    type="color"
                    value={
                      /^#[0-9a-fA-F]{6}$/.test(sceneWhiteboard.surface ?? "")
                        ? (sceneWhiteboard.surface as string)
                        : "#ffffff"
                    }
                    onChange={(e) =>
                      setSceneWhiteboard(scene.id, { surface: e.target.value })
                    }
                  />
                </label>
              )}
              <p className="muted">
                Objects with draw-on enabled draw themselves in, in scene order.
              </p>
            </>
          )}
        </div>
      </>
    );
  }

  const pos = obj.position ?? {};
  const isChar = obj.type === "character";
  const char = isChar ? (obj as CharacterObject) : null;
  const colors = char?.colors ?? {};

  const setPos = (patch: { x?: number; y?: number; w?: number; h?: number }) =>
    updateObject(obj.id, { position: { ...pos, ...patch } } as never);

  return (
    <>
      {effectsPanel}
      <div className="panel props-panel">
      <div className="panel-title">Properties</div>
      <label className="field">
        <span>Name</span>
        <input
          defaultValue={obj.name ?? ""}
          key={obj.name}
          onBlur={(e) => updateObject(obj.id, { name: e.target.value } as never)}
        />
      </label>
      <div className="pos-grid">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k} className="field">
            <span>{k.toUpperCase()}</span>
            <input
              type="number"
              defaultValue={pos[k] ?? 0}
              key={`${obj.id}-${k}-${pos[k]}`}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setPos({ [k]: v });
              }}
            />
          </label>
        ))}
      </div>

      {(obj.type === "shape" || obj.type === "text" || obj.type === "image") && (
        <DrawOnEditor
          treatment={drawOnForObject(obj)}
          onChange={(treatment) => setObjectDrawOn(obj.id, treatment)}
        />
      )}

      {char && (
        <>
          <label className="field">
            <span>Animation</span>
            <select
              value={char.characterAnimation ?? "idle"}
              onChange={(e) =>
                setCharAnimation(obj.id, e.target.value as CharacterAnimationName)
              }
            >
              {isInteractionRoleAction(char.characterAnimation) && (
                <option value={char.characterAnimation} disabled>
                  {ACTION_CATALOGUE.find((e) => e.name === char.characterAnimation)?.label ??
                    char.characterAnimation}{" "}
                  (two characters)
                </option>
              )}
              {CHARACTER_ANIMATION_GROUPS.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {CHARACTER_ANIMATIONS.filter((a) => a.group === g.id).map((a) => (
                    <option key={a.name} value={a.name} title={a.hint}>
                      {a.label}
                      {a.loops ? " (loops)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Facing</span>
            <div className="seg">
              {(["left", "right"] as CharacterFacing[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={(char.facing ?? "right") === f ? "active" : ""}
                  onClick={() => setCharFacing(obj.id, f)}
                >
                  {f === "left" ? "◀" : "▶"}
                </button>
              ))}
            </div>
          </div>
          {(scene?.objects ?? []).some(
            (o) => o.type === "character" && o.id !== obj.id,
          ) && (
            <div className="field">
              <span>Two characters</span>
              {INTERACTION_NAMES.map((name) => (
                <div key={name} className="seg">
                  {INTERACTIONS[name].orientations.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => applyInteraction(obj.id, name, o.id)}
                    >
                      {INTERACTIONS[name].label}: {o.label.toLowerCase()}
                    </button>
                  ))}
                </div>
              ))}
              <p className="muted small">
                Applies the interaction to this character and the nearest
                other character in the scene, moving the partner into place.
              </p>
            </div>
          )}
          <div className="field-row">
            {(
              [
                ["Skin", "skin", "#f1c27d"],
                ["Hair", "hair", "#3b2a20"],
                ["Shirt", "shirt", "#2b6cb0"],
                ["Pants", "pants", "#2d3748"],
              ] as const
            ).map(([label, key, fallback]) => (
              <label key={key} className="color-field">
                <span>{label}</span>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(colors[key] ?? "") ? (colors[key] as string) : fallback}
                  onChange={(e) => setCharColors(obj.id, { [key]: e.target.value })}
                />
              </label>
            ))}
          </div>

          <div className="sub-title">Movement path</div>
          <button
            type="button"
            className={pathEdit ? "active" : ""}
            onClick={() => setPathEdit(!pathEdit)}
          >
            {pathEdit ? "📍 Path mode: ON — click stage" : "📍 Edit path on stage"}
          </button>
          {(char.path ?? []).map((w, i) => (
            <div key={i} className="wp-row">
              <span className="wp-num">{i + 1}</span>
              <label>X<input type="number" defaultValue={w.x} key={`x${i}${w.x}`}
                onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) updateWaypoint(obj.id, i, { x: v }); }} /></label>
              <label>Y<input type="number" defaultValue={w.y} key={`y${i}${w.y}`}
                onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) updateWaypoint(obj.id, i, { y: v }); }} /></label>
              <label>T<input type="number" defaultValue={w.t} key={`t${i}${w.t}`} min={0}
                onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) updateWaypoint(obj.id, i, { t: v }); }} /></label>
              <label className="chk">
                <input type="checkbox" checked={w.curve === "smooth"}
                  onChange={(e) => updateWaypoint(obj.id, i, { curve: e.target.checked ? "smooth" : "linear" })} />
                Smooth
              </label>
              <label>Speed×<input type="number" defaultValue={w.speed ?? 1} key={`s${i}${w.speed}`} min={0.1} step={0.1}
                onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v > 0) updateWaypoint(obj.id, i, { speed: v }); }} /></label>
              <button type="button" onClick={() => removeWaypoint(obj.id, i)} aria-label="Remove waypoint">✕</button>
            </div>
          ))}

          <div className="sub-title">Dialogue</div>
          {(char.speech ?? []).map((s) => (
            <SpeechRow
              key={s.id}
              line={s}
              onUpdate={(patch) => updateSpeech(obj.id, s.id, patch)}
              onRemove={() => removeSpeech(obj.id, s.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              speechCounter += 1;
              addSpeech(obj.id, {
                id: `line-${Date.now().toString(36)}-${speechCounter}`,
                text: "Hello!",
                start: 0,
                duration: 2500,
              });
            }}
          >
            + Add line
          </button>
        </>
      )}

      {obj.type === "text" && (
        <label className="field">
          <span>Content</span>
          <textarea
            rows={4}
            defaultValue={(obj as { content?: string }).content ?? ""}
            key={obj.id}
            onBlur={(e) => updateObject(obj.id, { content: e.target.value } as never)}
          />
        </label>
      )}

      {obj.type === "shape" && (
        <label className="field">
          <span>Fill</span>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(String((obj as { fill?: string }).fill ?? "")) ? (obj as { fill: string }).fill : "#3b82f6"}
            onChange={(e) => updateObject(obj.id, { fill: e.target.value } as never)}
          />
        </label>
      )}

      {isColorCorrectableObject(obj) && (
        <ColorCorrectionSection
          key={`${obj.id}-${JSON.stringify(getObjectColorCorrection(obj))}`}
          object={obj}
        />
      )}
      <MotionSections obj={obj} sceneObjects={scene?.objects ?? []} />

      <div className="danger-zone">
        <button type="button" onClick={() => removeObject(obj.id)}>
          Delete object
        </button>
      </div>
      </div>
    </>
  );
}

const COLOR_SLIDERS: {
  key: keyof ColorCorrection;
  label: string;
}[] = [
  { key: "exposure", label: "Exposure" },
  { key: "contrast", label: "Contrast" },
  { key: "temperature", label: "Temperature" },
  { key: "tint", label: "Tint" },
  { key: "saturation", label: "Saturation" },
];

function ColorCorrectionSection({ object }: { object: CourseObject }) {
  const setObjectColorCorrection = useStudioStore(
    (s) => s.setObjectColorCorrection,
  );
  const stored = getObjectColorCorrection(object);
  const [draft, setDraft] = useState<ColorCorrection>(stored);
  const [autoFixing, setAutoFixing] = useState(false);

  const commit = (next: ColorCorrection) => {
    setDraft(next);
    setObjectColorCorrection(object.id, next);
  };

  return (
    <>
      <div className="sub-title">Colour</div>
      <p className="muted">
        Basic correction for this {object.type === "video" ? "footage" : "image"}.
        It is non-destructive and can be undone.
      </p>
      {COLOR_SLIDERS.map(({ key, label }) => (
        <label key={key} className="field">
          <span>
            {label}: {draft[key]}
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={draft[key]}
            aria-label={label}
            onChange={(e) =>
              setDraft({ ...draft, [key]: Number(e.target.value) })
            }
            onPointerUp={() => commit(draft)}
            onKeyUp={() => commit(draft)}
            onBlur={() => commit(draft)}
          />
        </label>
      ))}
      <div className="field-row">
        <button
          type="button"
          disabled={autoFixing}
          onClick={() => {
            setAutoFixing(true);
            void computeAutoFixForObject(object)
              .then((next) => commit(next))
              .finally(() => setAutoFixing(false));
          }}
        >
          {autoFixing ? "Fixing..." : "Auto fix"}
        </button>
        <button
          type="button"
          disabled={isNeutralColorCorrection(draft)}
          onClick={() => commit({ ...NEUTRAL_COLOR_CORRECTION })}
        >
          Reset
        </button>
      </div>
      <p className="muted">
        Auto fix reads the image where the browser allows it, and uses a
        gentle preset otherwise. Footage uses the preset until a preview
        frame is available.
      </p>
    </>
  );
}

function EffectsEditor({
  presets,
  onChange,
}: {
  presets: AnimationPreset[];
  onChange: (presets: AnimationPreset[]) => void;
}) {
  const [category, setCategory] = useState<"enter" | "exit" | "emphasis" | "motion">("enter");
  const [presetName, setPresetName] = useState<AnimationPresetName>("fadeIn");
  const choices = ANIMATION_PRESETS.filter((preset) => preset.category === category);
  const selectedPreset = choices.some((preset) => preset.name === presetName)
    ? presetName
    : choices[0].name;

  return (
    <>
      <label className="field">
        <span>Preset type</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
        >
          <option value="enter">Enter</option>
          <option value="exit">Exit</option>
          <option value="emphasis">Emphasis</option>
          <option value="motion">Motion</option>
        </select>
      </label>
      <div className="field-row">
        <label className="field effect-preset-select">
          <span>Preset</span>
          <select
            value={selectedPreset}
            onChange={(e) => setPresetName(e.target.value as AnimationPresetName)}
          >
            {choices.map((preset) => (
              <option key={preset.name} value={preset.name} title={preset.hint}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            onChange([...presets, { name: selectedPreset, start: 0, duration: 600 }])
          }
        >
          Add preset
        </button>
      </div>
      {presets.map((effect, index) => {
        const definition = ANIMATION_PRESETS.find((preset) => preset.name === effect.name);
        const update = (patch: Partial<AnimationPreset>) =>
          onChange(presets.map((item, i) => (i === index ? { ...item, ...patch } : item)));
        return (
          <div className="effect-item" key={`${effect.name}-${index}`}>
            <div className="effect-heading">
              <strong>{definition?.label ?? effect.name}</strong>
              <button
                type="button"
                aria-label={`Remove ${definition?.label ?? effect.name}`}
                onClick={() => onChange(presets.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
            <div className="effect-options">
              <label className="field-inline">
                Delay
                <input
                  type="number"
                  min={0}
                  step={50}
                  defaultValue={effect.start ?? 0}
                  key={`${index}-delay-${effect.start ?? 0}`}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value)) update({ start: Math.max(0, value) });
                  }}
                />
                ms
              </label>
              <label className="field-inline">
                Duration
                <input
                  type="number"
                  min={1}
                  step={50}
                  defaultValue={effect.duration ?? 600}
                  key={`${index}-duration-${effect.duration ?? 600}`}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value)) update({ duration: Math.max(1, value) });
                  }}
                />
                ms
              </label>
            </div>
          </div>
        );
      })}
    </>
  );
}

function DrawOnEditor({
  treatment,
  onChange,
}: {
  treatment: ReturnType<typeof drawOnForObject>;
  onChange: (treatment: ReturnType<typeof drawOnForObject>) => void;
}) {
  const enabled = treatment !== undefined;
  const current = treatment ?? { durationMs: 2000, handStyle: "marker" as WhiteboardHandStyle };
  const update = (patch: Partial<typeof current>) => onChange({ ...current, ...patch });
  return (
    <>
      <div className="sub-title">Whiteboard draw-on</div>
      <label className="chk">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? { durationMs: 2000, handStyle: "marker" } : undefined)
          }
        />
        Draw this object on
      </label>
      {enabled && (
        <>
          <label className="field">
            <span>Hand style</span>
            <select
              value={current.handStyle ?? "marker"}
              onChange={(e) => update({ handStyle: e.target.value as WhiteboardHandStyle })}
            >
              <option value="marker">Marker</option>
              <option value="chalk">Chalk</option>
              <option value="pen">Pen</option>
            </select>
          </label>
          <label className="field-inline">
            Draw duration
            <input
              type="number"
              min={1}
              step={100}
              defaultValue={current.durationMs ?? 2000}
              key={`drawon-duration-${current.durationMs ?? 2000}`}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0) update({ durationMs: value });
              }}
            />
            ms
          </label>
          <label className="field-inline">
            Hold before erase
            <input
              type="number"
              min={0}
              step={100}
              defaultValue={current.eraseDelayMs ?? 0}
              key={`drawon-hold-${current.eraseDelayMs ?? 0}`}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value >= 0) update({ eraseDelayMs: value });
              }}
            />
            ms
          </label>
          <label className="field-inline">
            Erase duration
            <input
              type="number"
              min={0}
              step={100}
              defaultValue={current.eraseDurationMs ?? 0}
              key={`drawon-erase-${current.eraseDurationMs ?? 0}`}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value >= 0) update({ eraseDurationMs: value });
              }}
            />
            ms (0 keeps the object)
          </label>
        </>
      )}
    </>
  );
}

function SpeechRow({
  line,
  onUpdate,
  onRemove,
}: {
  line: CharacterSpeech;
  onUpdate: (p: Partial<CharacterSpeech>) => void;
  onRemove: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  return (
    <div className="speech-row">
      <input
        defaultValue={line.text}
        key={line.id + line.text}
        onBlur={(e) => onUpdate({ text: e.target.value })}
        aria-label="Line text"
      />
      <div className="speech-times">
        <label>Start<input type="number" defaultValue={line.start} min={0}
          onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onUpdate({ start: v }); }} /></label>
        <label>Dur<input type="number" defaultValue={line.duration} min={500}
          onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onUpdate({ duration: v }); }} /></label>
        <button
          type="button"
          title="Preview with selected voice"
          disabled={previewing}
          onClick={() => {
            setPreviewing(true);
            // Preview handled by DialoguePanel's provider hookup; dispatch an event.
            window.dispatchEvent(
              new CustomEvent("ocf:preview-line", { detail: line.text }),
            );
            setTimeout(() => setPreviewing(false), 800);
          }}
        >
          🔊
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove line">✕</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motion graphics (issues #98 and #99): group parameters, Ken Burns
// framing, and kinetic text, all edited through the toolkit in
// @finch-studio/animation so the inspector and the renderers agree.
// ---------------------------------------------------------------------------

function MotionSections({
  obj,
  sceneObjects,
}: {
  obj: CourseObject;
  sceneObjects: CourseObject[];
}) {
  const meta = getMotionMeta(obj);
  return (
    <>
      {isMotionGraphicMeta(meta) && (
        <MotionGroupSection key={`group-${obj.id}`} obj={obj} meta={meta} sceneObjects={sceneObjects} />
      )}
      {(obj.type === "image" || obj.type === "video") && (
        <KenBurnsSection key={`kb-${obj.id}`} obj={obj} />
      )}
      {obj.type === "text" && (
        <KineticTextSection key={`kt-${obj.id}`} obj={obj} sceneObjects={sceneObjects} />
      )}
    </>
  );
}

function MotionGroupSection({
  meta,
  sceneObjects,
}: {
  obj: CourseObject;
  meta: MotionGraphicMeta;
  sceneObjects: CourseObject[];
}) {
  const replaceObjectGroup = useStudioStore((s) => s.replaceObjectGroup);
  const params = meta.params;
  const commit = (patch: Partial<MotionGraphicParams>) => {
    const group = motionGraphicGroupOf(sceneObjects, meta.groupId);
    if (group.length === 0) return;
    const next = rebuildMotionGraphic(group, { ...params, ...patch }, (role) =>
      newVideoId(`mg-${role}`),
    );
    replaceObjectGroup(
      group.map((object) => object.id),
      next,
    );
  };
  const kindLabel =
    meta.kind === "title" ? "Title card" : meta.kind === "lowerThird" ? "Lower third" : "Callout";
  return (
    <>
      <div className="sub-title">Motion graphic: {kindLabel}</div>
      <label className="field">
        <span>{meta.kind === "callout" ? "Label" : "Text"}</span>
        <input
          defaultValue={params.text}
          key={`text-${params.text}`}
          onBlur={(e) => commit({ text: e.target.value })}
        />
      </label>
      {meta.kind !== "callout" && (
        <label className="field">
          <span>{meta.kind === "title" ? "Subtitle" : "Second line"}</span>
          <input
            defaultValue={params.subtext ?? ""}
            key={`subtext-${params.subtext ?? ""}`}
            onBlur={(e) => commit({ subtext: e.target.value })}
          />
        </label>
      )}
      <div className="field-row">
        {(
          [
            ["Text", "textColor"],
            ["Accent", "accentColor"],
            ["Background", "backgroundColor"],
          ] as const
        ).map(([label, key]) => (
          <label key={key} className="color-field">
            <span>{label}</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(params[key]) ? params[key] : "#3b82f6"}
              onChange={(e) => commit({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="effect-options">
        <label className="field-inline">
          Start
          <input
            type="number"
            min={0}
            step={50}
            defaultValue={params.startMs}
            key={`start-${params.startMs}`}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) commit({ startMs: Math.max(0, value) });
            }}
          />
          ms
        </label>
        <label className="field-inline">
          Duration
          <input
            type="number"
            min={1}
            step={50}
            defaultValue={params.durationMs}
            key={`duration-${params.durationMs}`}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) commit({ durationMs: Math.max(1, value) });
            }}
          />
          ms
        </label>
      </div>
    </>
  );
}

function FrameFields({
  label,
  frame,
  onChange,
}: {
  label: string;
  frame: KenBurnsFrame;
  onChange: (frame: KenBurnsFrame) => void;
}) {
  const num = (value: number, step: number, apply: (v: number) => void) => (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) apply(v);
      }}
    />
  );
  return (
    <div className="effect-options">
      <span className="muted">{label}</span>
      <label className="field-inline">Scale{num(frame.scale, 0.05, (v) => onChange({ ...frame, scale: v }))}</label>
      <label className="field-inline">X{num(frame.x, 1, (v) => onChange({ ...frame, x: v }))}</label>
      <label className="field-inline">Y{num(frame.y, 1, (v) => onChange({ ...frame, y: v }))}</label>
    </div>
  );
}

function KenBurnsSection({ obj }: { obj: CourseObject }) {
  const updateObject = useStudioStore((s) => s.updateObject);
  const meta = getMotionMeta(obj);
  const kb = meta?.kind === "kenBurns" ? meta : undefined;
  const preset = (obj.animations?.presets ?? []).find((entry) => entry.name === "kenBurns");
  const [from, setFrom] = useState<KenBurnsFrame>(kb?.from ?? DEFAULT_KEN_BURNS.from);
  const [to, setTo] = useState<KenBurnsFrame>(kb?.to ?? DEFAULT_KEN_BURNS.to);
  const [start, setStart] = useState(preset?.start ?? Math.round((obj.timing?.start ?? 0) * 1000));
  const [duration, setDuration] = useState(
    preset?.duration ?? Math.round((obj.timing?.duration ?? 6) * 1000),
  );
  const commit = (next: CourseObject) =>
    updateObject(obj.id, {
      animations: next.animations,
      extensions: next.extensions,
    } as never);
  return (
    <>
      <div className="sub-title">Ken Burns</div>
      <p className="muted">Slow pan and zoom. Set the start and end framing, then apply.</p>
      <FrameFields label="Start frame" frame={from} onChange={setFrom} />
      <FrameFields label="End frame" frame={to} onChange={setTo} />
      <div className="effect-options">
        <label className="field-inline">
          Start
          <input type="number" min={0} step={50} value={start}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setStart(Math.max(0, v)); }} />
          ms
        </label>
        <label className="field-inline">
          Duration
          <input type="number" min={1} step={50} value={duration}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDuration(Math.max(1, v)); }} />
          ms
        </label>
      </div>
      <div className="field-row">
        <button type="button" onClick={() => commit(applyKenBurns(obj, { from, to }, start, duration))}>
          {kb ? "Update Ken Burns" : "Apply Ken Burns"}
        </button>
        {kb && (
          <button type="button" onClick={() => commit(clearKenBurns(obj))}>
            Remove
          </button>
        )}
      </div>
    </>
  );
}

function KineticTextSection({
  obj,
  sceneObjects,
}: {
  obj: CourseObject;
  sceneObjects: CourseObject[];
}) {
  const updateObject = useStudioStore((s) => s.updateObject);
  const meta = getMotionMeta(obj);
  const kt = meta?.kind === "kineticText" ? meta : undefined;
  const entry = (obj.animations?.presets ?? []).find((preset) => isKineticPresetName(preset.name));
  const [preset, setPreset] = useState<KineticPresetName>(kt?.preset ?? "wordReveal");
  const [pace, setPace] = useState(kt?.paceToNarration ?? false);
  const [start, setStart] = useState(entry?.start ?? 0);
  const [duration, setDuration] = useState(entry?.duration ?? 2000);
  const commit = (next: CourseObject) =>
    updateObject(obj.id, {
      animations: next.animations,
      extensions: next.extensions,
    } as never);
  const apply = () => {
    let narrationWindowMs: { startMs: number; endMs: number } | undefined;
    if (pace) {
      const lines = sceneObjects
        .filter((object) => object.type === "character")
        .flatMap((object) => (object as CharacterObject).speech ?? [])
        .sort((a, b) => a.start - b.start);
      const line = lines[0];
      if (line) narrationWindowMs = { startMs: line.start, endMs: line.start + line.duration };
    }
    commit(
      applyKineticText(obj, preset, {
        startMs: start,
        durationMs: duration,
        paceToNarration: pace,
        ...(narrationWindowMs ? { narrationWindowMs } : {}),
      }),
    );
  };
  return (
    <>
      <div className="sub-title">Kinetic text</div>
      <label className="field">
        <span>Reveal</span>
        <select value={preset} onChange={(e) => setPreset(e.target.value as KineticPresetName)}>
          <option value="typewriterReveal">Typewriter</option>
          <option value="wordReveal">Word by word</option>
          <option value="lineReveal">Line by line</option>
        </select>
      </label>
      <div className="effect-options">
        <label className="field-inline">
          Start
          <input type="number" min={0} step={50} value={start}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setStart(Math.max(0, v)); }} />
          ms
        </label>
        <label className="field-inline">
          Duration
          <input type="number" min={1} step={50} value={duration}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDuration(Math.max(1, v)); }} />
          ms
        </label>
      </div>
      <label className="chk">
        <input type="checkbox" checked={pace} onChange={(e) => setPace(e.target.checked)} />
        Pace to narration
      </label>
      <div className="field-row">
        <button type="button" onClick={apply}>
          {kt ? "Update reveal" : "Apply reveal"}
        </button>
        {kt && (
          <button type="button" onClick={() => commit(clearKineticText(obj))}>
            Remove
          </button>
        )}
      </div>
    </>
  );
}
