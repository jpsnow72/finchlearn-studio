# Extraction note
Extracted 2026-11-18 from jpsnow72/open-course-format, package @ocf/animation-studio.
Moved: SceneTimeContext, VideoScenePlayer, animatedStyle, dialogue, tts, useSceneClock, videoProject, and their tests.
Did NOT move: src/characters/ (the SVG character art), characters.css, CharacterRenderer. The existing FinchLearn characters do not look right for this product and are not built for movement (Justin, Nov 18, 2026); they stay in FinchLearn for existing courses only. New characters are a design-first workstream (issue #16, design:figma) and plug into the CharacterFigure seam in src/CharacterFigure.tsx.
