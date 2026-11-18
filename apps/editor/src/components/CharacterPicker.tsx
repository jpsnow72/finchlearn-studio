/**
 * CharacterPicker — thumbnail grid to drop characters onto the stage.
 *
 * Thumbnails use the CharacterFigure seam. Real character art is a
 * design-first workstream (issue #16) and plugs into that seam.
 */
import { CHARACTER_IDS, type CharacterId } from "@finch-studio/core";
import { CharacterFigure, SceneTimeContext } from "@finch-studio/animation";
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
            <SceneTimeContext.Provider value={null}>
              <div className="char-thumb">
                <CharacterFigure label={c.label} />
              </div>
            </SceneTimeContext.Provider>
            <span className="char-card-label">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

