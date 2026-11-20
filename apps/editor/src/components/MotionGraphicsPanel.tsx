/**
 * MotionGraphicsPanel: insert animated title cards, lower thirds, and
 * callouts (issues #98 and #99). Each insert is a parameterized group of
 * ordinary timeline objects built by the motion graphics toolkit in
 * @finch-studio/animation; once inserted, the group's text, colors, and
 * timing are edited in the Properties panel like any other object.
 */
import { useState } from "react";
import {
  buildCallout,
  buildLowerThird,
  buildTitleCard,
  motionGraphicColorsFromTheme,
  type MotionGraphicParams,
} from "@finch-studio/animation";
import { useStudioStore } from "../store";

function baseParams(text: string, subtext?: string): MotionGraphicParams {
  return {
    ...motionGraphicColorsFromTheme(),
    text,
    ...(subtext ? { subtext } : {}),
    startMs: 0,
    durationMs: 5000,
    enterMs: 600,
    exitMs: 500,
  };
}

export function MotionGraphicsPanel() {
  const insertObjectGroup = useStudioStore((s) => s.insertObjectGroup);
  const [title, setTitle] = useState("Your title here");
  const [subtitle, setSubtitle] = useState("A short supporting line");
  const [name, setName] = useState("Alex Rivera");
  const [role, setRole] = useState("Course instructor");
  const [label, setLabel] = useState("Look here");

  return (
    <div className="panel">
      <div className="panel-title">Motion graphics</div>
      <p className="muted">
        Animated titles, lower thirds, and callouts. Insert one, then edit its text, colors, and
        timing in Properties.
      </p>

      <div className="sub-title">Title card</div>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Subtitle</span>
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => insertObjectGroup(buildTitleCard(baseParams(title || "Title", subtitle)))}
      >
        Add title card
      </button>

      <div className="sub-title">Lower third</div>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Role</span>
        <input value={role} onChange={(e) => setRole(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => insertObjectGroup(buildLowerThird(baseParams(name || "Name", role)))}
      >
        Add lower third
      </button>

      <div className="sub-title">Callout</div>
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => insertObjectGroup(buildCallout(baseParams(label || "Look here")))}
      >
        Add callout
      </button>
    </div>
  );
}
