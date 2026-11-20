/**
 * CharacterPicker: the studio cast, grouped by style family (Direction
 * A: Clean Corporate Flat, Direction B: Warm Storybook Soft, Direction
 * D: Bold Ink Editorial). The family list comes from the characters
 * package registry, so a new family surfaces here with no picker edit.
 * Each card stores the canonical legacy id for that character, so the
 * name the user picks is the character they get.
 */
import { CustomCharacterFigure, RiggedCharacter, STUDIO_CHARACTERS, CANONICAL_LEGACY_ID, STYLE_FAMILIES, type StyleFamilyId } from "@finch-studio/characters";
import type { CharacterId } from "@finch-studio/core";
import { useStudioStore, makeStudioCharacter, makeStudioCustomCharacter } from "../store";

export function CharacterPicker() {
  const addObject = useStudioStore((s) => s.addObject);
  const customCharacters = useStudioStore((s) => s.customCharacters);
  const families = Object.keys(STYLE_FAMILIES) as StyleFamilyId[];

  return (
    <div className="panel character-picker">
      <div className="panel-title">Characters</div>
      {customCharacters.length > 0 && (
        <div>
          <div className="char-family">Your characters</div>
          <div className="char-grid">
            {customCharacters.map((c) => (
              <button
                key={c.id}
                type="button"
                className="char-card"
                onClick={() => addObject(makeStudioCustomCharacter(c))}
                title={`Add ${c.name}`}
              >
                <div className="char-thumb">
                  <CustomCharacterFigure def={c} action="idle" tMs={0} style={{ width: "100%", height: "100%" }} />
                </div>
                <span className="char-card-label">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {families.map((fam) => (
        <div key={fam}>
          <div className="char-family">{STYLE_FAMILIES[fam].name}</div>
          <div className="char-grid">
            {STUDIO_CHARACTERS.filter((c) => c.family === fam).map((c) => (
              <button
                key={c.id}
                type="button"
                className="char-card"
                onClick={() => addObject(makeStudioCharacter(CANONICAL_LEGACY_ID[c.id] as CharacterId))}
                title={`Add ${c.name}`}
              >
                <div className="char-thumb">
                  <RiggedCharacter def={c} action="idle" tMs={0} style={{ width: "100%", height: "100%" }} />
                </div>
                <span className="char-card-label">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
