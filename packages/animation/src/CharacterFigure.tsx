/**
 * CharacterFigure: the seam where the new rigged character system plugs in.
 *
 * Placeholder ONLY. The real characters are a design-first workstream
 * (finchlearn-studio issue #16, design:figma): no rig or art ships until
 * Justin approves the character design package. This component renders a
 * neutral silhouette with the character's label so scenes, timing, dialogue,
 * and export work end to end before the art lands.
 */
import type { CSSProperties } from "react";

export interface CharacterFigureProps {
  characterId?: string;
  label?: string;
  style?: CSSProperties;
}

export function CharacterFigure({ label, style }: CharacterFigureProps) {
  return (
    <div
      data-character-placeholder=""
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        ...style,
      }}
    >
      <div
        style={{
          width: "62%",
          height: "88%",
          borderRadius: "46% 46% 12% 12% / 30% 30% 8% 8%",
          background: "var(--studio-character-placeholder, #9aa7b4)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          textAlign: "center",
          padding: 4,
        }}
      >
        {label ?? "Character"}
      </div>
    </div>
  );
}
