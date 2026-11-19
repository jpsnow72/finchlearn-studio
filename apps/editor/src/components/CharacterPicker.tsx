/**
 * CharacterPicker: thumbnail grid to drop characters onto the stage.
 * Thumbnails render the real rigged characters (issue #16 approved
 * design, packages/characters) at their idle pose.
 */
import { CHARACTER_IDS, type CharacterId } from "@finch-studio/core";
import { RiggedCharacter, characterForLegacyId } from "@finch-studio/characters";
import { useStudioStore, makeStudioCharacter } from "../store";

export function CharacterPicker() {
  const addObject = useStudioStore((s) => s.addObject);

  return (
    <div className="panel character-picker">
      <div className="panel-title">Characters</div>
      <div className="char-grid">
        {CHARACTER_IDS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="char-card"
            onClick={() => addObject(makeStudioCharacter(c.id as CharacterId))}
            title={`Add ${c.label}`}
          >
            <div className="char-thumb">
              <RiggedCharacter
                def={characterForLegacyId(c.id)}
                action="idle"
                tMs={0}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
            <span className="char-card-label">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
