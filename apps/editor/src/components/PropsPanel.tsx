/**
 * PropsPanel — inspector for the selected scene object.
 *
 * Character: animation, facing, colors, waypoints (curve/speed), speech lines.
 * Text: content. Shape: fill. All: name, position/size.
 */
import { useState } from "react";
import type {
  CharacterAnimationName,
  CharacterFacing,
  CharacterObject,
  CharacterSpeech,
} from "@finch-studio/core";
import { CHARACTER_ANIMATIONS } from "@finch-studio/core";
import { useStudioStore, useSelectedObject } from "../store";

let speechCounter = 0;

export function PropsPanel({
  pathEdit,
  setPathEdit,
}: {
  pathEdit: boolean;
  setPathEdit: (v: boolean) => void;
}) {
  const obj = useSelectedObject();
  const updateObject = useStudioStore((s) => s.updateObject);
  const removeObject = useStudioStore((s) => s.removeObject);
  const setCharAnimation = useStudioStore((s) => s.setCharAnimation);
  const setCharFacing = useStudioStore((s) => s.setCharFacing);
  const setCharColors = useStudioStore((s) => s.setCharColors);
  const updateWaypoint = useStudioStore((s) => s.updateWaypoint);
  const removeWaypoint = useStudioStore((s) => s.removeWaypoint);
  const addSpeech = useStudioStore((s) => s.addSpeech);
  const updateSpeech = useStudioStore((s) => s.updateSpeech);
  const removeSpeech = useStudioStore((s) => s.removeSpeech);

  if (!obj) {
    return (
      <div className="panel props-panel">
        <div className="panel-title">Properties</div>
        <p className="muted">Select an object on the stage.</p>
      </div>
    );
  }

  const pos = obj.position ?? {};
  const isChar = obj.type === "character";
  const char = isChar ? (obj as CharacterObject) : null;
  const colors = char?.colors ?? {};

  const setPos = (patch: { x?: number; y?: number; w?: number; h?: number }) =>
    updateObject(obj.id, { position: { ...pos, ...patch } } as never);

  return (
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
              {CHARACTER_ANIMATIONS.map((a) => (
                <option key={a.name} value={a.name} title={a.hint}>
                  {a.label}
                  {a.loops ? " (loops)" : ""}
                </option>
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

      <div className="danger-zone">
        <button type="button" onClick={() => removeObject(obj.id)}>
          Delete object
        </button>
      </div>
    </div>
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
