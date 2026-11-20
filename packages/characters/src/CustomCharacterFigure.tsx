/**
 * CustomCharacterFigure: renders a user rigged character (issue #74)
 * posed by an action, in the same SVG stage space as RiggedCharacter
 * (200 x 400), so custom characters sit in scenes, previews, and
 * exports exactly like the built in cast.
 *
 * Rendering follows the rig mode honestly:
 *  - segmented: each part image (or template SVG group) is drawn at its
 *    bone and posed by forward kinematics over the user's bone map, so
 *    joints bend cleanly.
 *  - puppet-warp: the single base image is drawn in three clipped bands
 *    (upper body, left leg, right leg) that rotate around the neck and
 *    hip joints. It reads as the figure bending, with the stretching
 *    the wizard's quality note warns about.
 *
 * The face pack overlays the standard expression and viseme face: the
 * full face for segmented characters (template heads ship blank), and
 * the mouth only for puppet warp characters, whose own art already
 * carries eyes. Blink closes the eyes on the pack's blink interval.
 */
import type { CSSProperties, ReactNode } from "react";
import { ACTIONS, sampleAction, type ActionName } from "./actions.js";
import {
  BONES,
  type BoneId,
  type BoneTransform,
} from "./skeleton.js";
import {
  BROW_PATHS,
  EYE_PATHS,
  MOUTH_PATHS,
  type ExpressionName,
  type MouthShapeId,
} from "./expressions.js";
import {
  faceForExpression,
  type BoneMap,
  type CustomCharacterDef,
} from "./rigging.js";

export interface WorldJoint {
  x: number;
  y: number;
  angle: number;
}

/**
 * Forward kinematics: world position and angle per bone, composing the
 * sampled pose over the bone map's rest joints. Mirrors the nested
 * group transforms RiggedCharacter renders with.
 */
export function worldJoints(
  map: BoneMap,
  pose: Record<BoneId, BoneTransform>,
): Record<BoneId, WorldJoint> {
  const rest = new Map(map.joints.map((j) => [j.bone, j]));
  const out = {} as Record<BoneId, WorldJoint>;
  for (const b of BONES) {
    const joint = rest.get(b.id) ?? { x: 100, y: 200 };
    const tr = pose[b.id] ?? { rotate: 0, dx: 0, dy: 0 };
    if (!b.parent) {
      out[b.id] = { x: joint.x + tr.dx, y: joint.y + tr.dy, angle: tr.rotate };
      continue;
    }
    const parentRest = rest.get(b.parent) ?? { x: 100, y: 200 };
    const parent = out[b.parent];
    const localX = joint.x - parentRest.x + tr.dx;
    const localY = joint.y - parentRest.y + tr.dy;
    const rad = (parent.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    out[b.id] = {
      x: parent.x + localX * cos - localY * sin,
      y: parent.y + localX * sin + localY * cos,
      angle: parent.angle + tr.rotate,
    };
  }
  return out;
}

/** Extract one named group's inner markup from template SVG text. */
export function svgGroupInner(svgText: string, group: string): string | null {
  const re = new RegExp(
    `<g\\b[^>]*\\bid\\s*=\\s*"${group}"[^>]*>([\\s\\S]*?)</g>`,
    "i",
  );
  const m = re.exec(svgText);
  return m ? m[1] : null;
}

const SLOT_BONE: Record<string, BoneId> = {
  head: "head",
  face: "head",
  hairBack: "head",
  hairFront: "head",
  neck: "neck",
  torso: "torso",
  armUpperL: "armUpperL",
  armLowerL: "armLowerL",
  armUpperR: "armUpperR",
  armLowerR: "armLowerR",
  handL: "armLowerL",
  handR: "armLowerR",
  legUpperL: "legUpperL",
  legLowerL: "legLowerL",
  legUpperR: "legUpperR",
  legLowerR: "legLowerR",
  shoeL: "legLowerL",
  shoeR: "legLowerR",
};

export interface CustomCharacterFigureProps {
  def: CustomCharacterDef;
  action?: ActionName;
  expression?: ExpressionName;
  mouthOverride?: MouthShapeId;
  tMs?: number;
  style?: CSSProperties;
}

export function CustomCharacterFigure({
  def,
  action = "idle",
  expression = "neutral",
  mouthOverride,
  tMs = 0,
  style,
}: CustomCharacterFigureProps) {
  const rig = def.customRig;
  const pose = sampleAction(ACTIONS[action] ?? ACTIONS.idle, tMs);
  const world = worldJoints(rig.boneMap, pose);
  const rest = new Map(rig.boneMap.joints.map((j) => [j.bone, j]));
  const face = faceForExpression(rig.facePack, expression);
  const blinkCycle = (rig.facePack.blinkMs.min + rig.facePack.blinkMs.max) / 2;
  const blinking = tMs % blinkCycle < 130 && face.eyes !== "closed";
  const eyes = blinking ? "closed" : face.eyes;
  const mouth = mouthOverride ?? face.mouth;
  const headWorld = world.head;
  const headRest = rest.get("head") ?? { x: 100, y: 118 };
  const faceDx = rig.facePack.anchor.x - headRest.x;
  const faceDy = rig.facePack.anchor.y - headRest.y;

  const faceOverlay = (mouthOnly: boolean) => (
    <g
      transform={`translate(${headWorld.x} ${headWorld.y}) rotate(${headWorld.angle}) translate(${faceDx} ${faceDy}) scale(${rig.facePack.scale}) translate(-32 -32)`}
    >
      {!mouthOnly && (
        <>
          <g stroke="#2B2320" strokeWidth="2.4" fill="#2B2320" strokeLinecap="round">
            <path d={EYE_PATHS[eyes].left} fill={eyes === "open" || eyes === "wide" ? "#2B2320" : "none"} />
            <path d={EYE_PATHS[eyes].right} fill={eyes === "open" || eyes === "wide" ? "#2B2320" : "none"} />
          </g>
          <g stroke="#2B2320" strokeWidth="2.2" fill="none" strokeLinecap="round">
            <path d={BROW_PATHS[face.brows].left} />
            <path d={BROW_PATHS[face.brows].right} />
          </g>
        </>
      )}
      <g stroke="#2B2320" strokeWidth="2.2" fill="none" strokeLinecap="round">
        <path
          d={MOUTH_PATHS[mouth]}
          fill={mouth === "laugh" || mouth === "a" || mouth === "o" ? "#7A3B2E" : "none"}
        />
      </g>
    </g>
  );

  let body: ReactNode = null;
  if (rig.mode === "segmented" && rig.sourceKind === "svg-template" && rig.baseImageRef) {
    const svgText = rig.baseImageRef;
    body = (
      <>
        {(rig.parts ?? []).map((part) => {
          const bone = SLOT_BONE[part.slot];
          if (!bone) return null;
          const inner = svgGroupInner(svgText, part.ref);
          if (!inner) return null;
          const w = world[bone];
          const r = rest.get(bone) ?? { x: 0, y: 0 };
          return (
            <g
              key={part.slot}
              transform={`translate(${w.x} ${w.y}) rotate(${w.angle}) translate(${-r.x} ${-r.y})`}
              dangerouslySetInnerHTML={{ __html: inner }}
            />
          );
        })}
      </>
    );
  } else if (rig.mode === "segmented" && rig.parts && rig.parts.length > 0) {
    body = (
      <>
        {rig.parts.map((part) => {
          const bone = SLOT_BONE[part.slot];
          if (!bone) return null;
          const w = world[bone];
          const len = rig.boneMap.lengths[bone] ?? 52;
          const isHead = bone === "head";
          const width = isHead ? 68 * rig.facePack.scale : bone === "torso" ? 64 : 22;
          const height = isHead ? 68 * rig.facePack.scale : len + 14;
          const y = isHead ? -height + 10 : bone === "torso" ? -height + 8 : -3;
          return (
            <g key={part.slot} transform={`translate(${w.x} ${w.y}) rotate(${w.angle})`}>
              <image
                href={part.ref}
                x={-width / 2}
                y={y}
                width={width}
                height={height}
                preserveAspectRatio="none"
              />
            </g>
          );
        })}
      </>
    );
  } else if (rig.baseImageRef) {
    const hipY = Math.max(
      rest.get("legUpperL")?.y ?? 244,
      rest.get("legUpperR")?.y ?? 244,
    );
    const neck = rest.get("neck") ?? { x: 100, y: 128 };
    const rootDy = pose.root.dy;
    const band = (clipId: string, transform: string) => (
      <g key={clipId} clipPath={`url(#${clipId}-${def.id})`} transform={transform}>
        <image
          href={rig.baseImageRef}
          x={0}
          y={0}
          width={200}
          height={400}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    );
    body = (
      <>
        <defs>
          <clipPath id={`upper-${def.id}`}>
            <rect x={0} y={0} width={200} height={hipY} />
          </clipPath>
          <clipPath id={`legL-${def.id}`}>
            <rect x={0} y={hipY} width={100} height={400 - hipY} />
          </clipPath>
          <clipPath id={`legR-${def.id}`}>
            <rect x={100} y={hipY} width={100} height={400 - hipY} />
          </clipPath>
        </defs>
        <g transform={`translate(0 ${rootDy})`}>
          {band(
            "legL",
            `rotate(${world.legUpperL.angle} ${rest.get("legUpperL")?.x ?? 86} ${hipY})`,
          )}
          {band(
            "legR",
            `rotate(${world.legUpperR.angle} ${rest.get("legUpperR")?.x ?? 114} ${hipY})`,
          )}
          {band(
            "upper",
            `rotate(${world.torso.angle * 0.6} ${neck.x} ${neck.y})`,
          )}
        </g>
      </>
    );
  }

  return (
    <svg viewBox="0 0 200 400" style={style} role="img" aria-label={def.name}>
      {body}
      {faceOverlay(rig.mode === "puppet-warp")}
    </svg>
  );
}

/**
 * A stick figure pose preview over a bone map: the wizard uses it so a
 * custom character can be previewed walking, pointing, and sitting on
 * its own proportions before any art rendering decisions matter.
 */
export function RigPosePreview({
  map,
  action = "idle",
  tMs = 0,
  style,
}: {
  map: BoneMap;
  action?: ActionName;
  tMs?: number;
  style?: CSSProperties;
}) {
  const pose = sampleAction(ACTIONS[action] ?? ACTIONS.idle, tMs);
  const world = worldJoints(map, pose);
  const lines: { from: WorldJoint; to: WorldJoint; key: string }[] = [];
  for (const b of BONES) {
    if (!b.parent) continue;
    lines.push({ from: world[b.parent], to: world[b.id], key: b.id });
  }
  const head = world.head;
  return (
    <svg viewBox="0 0 200 400" style={style} role="img" aria-label={`${action} pose preview`}>
      {lines.map((l) => (
        <line
          key={l.key}
          x1={l.from.x}
          y1={l.from.y}
          x2={l.to.x}
          y2={l.to.y}
          stroke="currentColor"
          strokeWidth={5}
          strokeLinecap="round"
          opacity={0.75}
        />
      ))}
      <circle cx={head.x} cy={head.y - 14} r={17} fill="none" stroke="currentColor" strokeWidth={4} />
      {lines.map((l) => (
        <circle key={`j-${l.key}`} cx={l.to.x} cy={l.to.y} r={3.4} fill="currentColor" />
      ))}
    </svg>
  );
}
