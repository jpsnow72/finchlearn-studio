/**
 * StudioObjectRenderer — renders scene objects in the video studio canvas.
 *
 * Handles the video-friendly types (character, text, shape, image); other
 * types render a placeholder note. Character limb animation + path movement
 * come from @finch-studio/animation's CharacterRenderer (driven by
 * SceneTimeContext).
 */
import type { CSSProperties } from "react";
import type { CourseObject } from "@finch-studio/core";
import { CharacterFigure } from "@finch-studio/animation";

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

export function StudioObjectRenderer({ object }: { object: CourseObject }) {
  switch (object.type) {
    case "character":
      return <CharacterFigure label={object.name} />;
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
