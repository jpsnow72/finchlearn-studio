/**
 * CharacterPicker: the studio cast, grouped by style family (Direction
 * A: Clean Corporate Flat, Direction B: Warm Storybook Soft). Each card
 * stores the canonical legacy id for that character, so the name the
 * user picks is the character they get.
 */
import { RiggedCharacter, STUDIO_CHARACTERS, CANONICAL_LEGACY_ID, STYLE_FAMILIES } from "@finch-studio/characters";
import type { CharacterId } from "@finch-studio/core";
import { useStudioStore, makeStudioCharacter } from "../store";

export function CharacterPicker() {
  const addObject = useStudioStore((s) => s.addObject);
  const families = ["A", "B"] as const;

  return (
    <div className="panel character-picker">
      <div className="panel-title">Characters</div>
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
