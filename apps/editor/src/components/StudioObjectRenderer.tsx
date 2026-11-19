/**
 * StudioObjectRenderer — renders scene objects in the video studio canvas.
 *
 * Handles the video-friendly types (character, text, shape, image); other
 * types render a placeholder note. Character limb animation + path movement
 * come from @finch-studio/characters' RiggedCharacter (driven by
 * SceneTimeContext), on the standard skeleton and the approved
 * Direction A and B style families.
 */
import { useContext, type CSSProperties } from "react";
import type { CharacterObject, CourseObject } from "@finch-studio/core";
import { SceneTimeContext } from "@finch-studio/animation";
import {
  RiggedCharacter,
  characterForLegacyId,
  defWithColors,
  mouthAt,
  visemesFromText,
} from "@finch-studio/characters";
import { studioActionFor } from "../videoExport";

function CharacterView({ object }: { object: CharacterObject }) {
  const tMs = useContext(SceneTimeContext);
  const def = defWithColors(characterForLegacyId(object.characterId), object.colors);
  const now = tMs ?? 0;
  const line = (object.speech ?? []).find(
    (sp) => now >= sp.start && now < sp.start + sp.duration,
  );
  const mouth = line?.text
    ? mouthAt(visemesFromText(line.text), now - line.start)
    : undefined;
  return (
    <RiggedCharacter
      def={def}
      action={studioActionFor(object.characterAnimation)}
      tMs={now}
      {...(mouth ? { mouthOverride: mouth } : {})}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

export function StudioObjectRenderer({ object }: { object: CourseObject }) {
  switch (object.type) {
    case "character":
      return <CharacterView object={object} />;
    case "text": {
      const style: CSSProperties = {
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontSize: 22,
        lineHeight: 1.35,
      };
      return (
        <div
          style={style}
          dangerouslySetInnerHTML={{ __html: object.content ?? "" }}
        />
      );
    }
    case "shape": {
      const isEllipse = object.shape === "ellipse";
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: (object.fill as string) ?? "#3b82f6",
            borderRadius: isEllipse ? "50%" : 8,
          }}
        />
      );
    }
    case "image": {
      const src = (object as { resource?: string }).resource;
      return src ? (
        <img
          src={src}
          alt={object.alt ?? ""}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          draggable={false}
        />
      ) : (
        <div className="studio-placeholder">🖼 image</div>
      );
    }
    default:
      return (
        <div className="studio-placeholder" title={`Type "${object.type}" renders in the course player`}>
          {object.type}
        </div>
      );
  }
}

/** Plain-text for export canvas. */
export function studioTextContent(object: CourseObject): string {
  if (object.type === "text") return stripHtml(object.content ?? "");
  return "";
}
