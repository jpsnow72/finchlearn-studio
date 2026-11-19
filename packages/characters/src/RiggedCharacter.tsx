/**
 * RiggedCharacter: renders a CharacterDef posed by an action at a time,
 * as SVG part groups transformed by the sampled pose. The same component
 * renders in the editor stage and (through static markup) in exports, so
 * characters cannot drift between preview and render.
 */
import { ACTIONS, sampleAction, type ActionName } from "./actions.js";
import { STYLE_FAMILIES, type CharacterDef } from "./defs.js";
import {
  BROW_PATHS,
  EXPRESSIONS,
  EYE_PATHS,
  MOUTH_PATHS,
  type ExpressionName,
  type MouthShapeId,
} from "./expressions.js";
import type { BoneTransform } from "./skeleton.js";

export interface RiggedCharacterProps {
  def: CharacterDef;
  action?: ActionName;
  expression?: ExpressionName;
  /** When set (talking), the mouth comes from this viseme shape instead. */
  mouthOverride?: MouthShapeId;
  tMs?: number;
  style?: React.CSSProperties;
}

const t = (tr: BoneTransform, x = 0, y = 0): string =>
  `translate(${x + tr.dx} ${y + tr.dy}) rotate(${tr.rotate})`;

function HairBack({ def }: { def: CharacterDef }) {
  if (def.hairStyle === "bob" || def.hairStyle === "curly")
    return <path d="M-34 -6 a34 36 0 1 1 68 0 l0 26 -14 0 0 -18 -40 0 0 18 -14 0 Z" fill={def.hairColor} transform="translate(0 -2)" />;
  return null;
}

function HairFront({ def }: { def: CharacterDef }) {
  switch (def.hairStyle) {
    case "bob":
      return <path d="M-32 -8 a32 32 0 0 1 64 0 l0 -6 a32 26 0 0 0 -64 0 Z" fill={def.hairColor} />;
    case "curly":
      return (
        <g fill={def.hairColor}>
          <circle cx="-24" cy="-16" r="11" /><circle cx="-10" cy="-24" r="12" /><circle cx="6" cy="-26" r="12" />
          <circle cx="20" cy="-20" r="11" /><circle cx="28" cy="-8" r="9" /><circle cx="-30" cy="-4" r="9" />
        </g>
      );
    case "bun":
      return (
        <g fill={def.hairColor}>
          <circle cx="0" cy="-34" r="10" />
          <path d="M-30 -10 a30 30 0 0 1 60 0 l0 -4 a30 24 0 0 0 -60 0 Z" />
        </g>
      );
    case "bald":
      return null;
    case "gray-short":
    case "short":
    default:
      return <path d="M-29 -12 a29 29 0 0 1 58 0 l0 -2 a29 22 0 0 0 -58 0 Z" fill={def.hairColor} />;
  }
}

export function RiggedCharacter({
  def,
  action = "idle",
  expression = "neutral",
  mouthOverride,
  tMs = 0,
  style,
}: RiggedCharacterProps) {
  const family = STYLE_FAMILIES[def.family];
  const pose = sampleAction(ACTIONS[action] ?? ACTIONS.idle, tMs);
  const face = EXPRESSIONS[expression] ?? EXPRESSIONS.neutral;
  const mouth = mouthOverride ?? face.mouth;
  const r = family.roundness;
  const limbW = 15 * r;

  const leg = (side: "L" | "R") => {
    const upper = pose[side === "L" ? "legUpperL" : "legUpperR"];
    const lower = pose[side === "L" ? "legLowerL" : "legLowerR"];
    const hipX = side === "L" ? -13 : 13;
    return (
      <g transform={t(upper, hipX, 4)}>
        <rect x={-limbW / 2} y={-2} width={limbW} height={74} rx={7 * r} fill={def.bottomColor} />
        <g transform={t(lower, 0, 72)}>
          <rect x={-limbW / 2 + 1} y={-2} width={limbW - 2} height={76} rx={7 * r} fill={def.bottomColor} />
          <path d={`M${-limbW / 2} 70 h${limbW + 8} a6 6 0 0 1 6 6 l0 4 -${limbW + 14} 0 Z`} fill={def.shoeColor} transform="translate(-2 0)" />
        </g>
      </g>
    );
  };

  const arm = (side: "L" | "R") => {
    const upper = pose[side === "L" ? "armUpperL" : "armUpperR"];
    const lower = pose[side === "L" ? "armLowerL" : "armLowerR"];
    const shoulderX = side === "L" ? -27 : 27;
    return (
      <g transform={t(upper, shoulderX, -94)}>
        <rect x={-limbW / 2} y={-4} width={limbW} height={50} rx={7 * r} fill={def.topColor} />
        <g transform={t(lower, 0, 46)}>
          <rect x={-limbW / 2 + 1} y={-2} width={limbW - 2} height={44} rx={7 * r} fill={def.skin} />
          <circle cx="0" cy="46" r={8 * r} fill={def.skin} />
        </g>
      </g>
    );
  };

  return (
    <svg viewBox="0 0 200 400" style={style} role="img" aria-label={def.name}>
      <defs>
        <linearGradient id={`soft-${def.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <g transform={t(pose.root, 100, 238)}>
        {leg("L")}
        {leg("R")}
        <g transform={t(pose.torso, 0, -4)}>
          <path
            d={`M-30 2 L-26 -96 a8 8 0 0 1 8 -8 l36 0 a8 8 0 0 1 8 8 L30 2 a6 6 0 0 1 -6 6 l-48 0 a6 6 0 0 1 -6 -6 Z`}
            fill={def.topColor}
          />
          {family.softShading && (
            <path d="M-30 2 L-26 -96 a8 8 0 0 1 8 -8 l36 0 a8 8 0 0 1 8 8 L30 2 a6 6 0 0 1 -6 6 l-48 0 a6 6 0 0 1 -6 -6 Z" fill={`url(#soft-${def.id})`} />
          )}
          {arm("L")}
          {arm("R")}
          <g transform={t(pose.head, 0, -112)}>
            <g transform={`scale(${family.headScale})`}>
              <HairBack def={def} />
              <circle cx="0" cy="0" r="30" fill={def.skin} />
              {family.softShading && <circle cx="0" cy="0" r="30" fill={`url(#soft-${def.id})`} />}
              <g transform="translate(-32 -34) scale(1)">
                <g stroke="#2B2320" strokeWidth="2.4" fill="#2B2320" strokeLinecap="round">
                  <path d={EYE_PATHS[face.eyes].left} fill={face.eyes === "open" || face.eyes === "wide" ? "#2B2320" : "none"} />
                  <path d={EYE_PATHS[face.eyes].right} fill={face.eyes === "open" || face.eyes === "wide" ? "#2B2320" : "none"} />
                </g>
                <g stroke="#2B2320" strokeWidth="2.2" fill="none" strokeLinecap="round">
                  <path d={BROW_PATHS[face.brows].left} />
                  <path d={BROW_PATHS[face.brows].right} />
                  <path d={MOUTH_PATHS[mouth]} fill={mouth === "laugh" || mouth === "a" || mouth === "o" ? "#7A3B2E" : "none"} />
                </g>
              </g>
              <HairFront def={def} />
              {def.accessory === "glasses" && (
                <g stroke="#2B2320" strokeWidth="2.2" fill="none">
                  <circle cx="-14" cy="-2" r="10" /><circle cx="14" cy="-2" r="10" />
                  <path d="M-4 -2 L4 -2" />
                </g>
              )}
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
