/**
 * Cue points (issue #64): editor-side marker storage, text forms, and
 * the OCF cue-point metadata a scene exports for the FinchLearn player.
 */
import { describe, expect, it } from "vitest";
import type { VideoObject, VideoScene } from "@finch-studio/core";
import type { CueMarker } from "@finch-studio/schema";
import {
  branchChoicesToText,
  parseBranchChoices,
  parseQuestionChoices,
  projectWithCuePoints,
  questionChoicesToText,
  sceneCueMarkers,
  withSceneCueMarkers,
  withSceneCuePoints,
} from "../cuePoints";

const markers: CueMarker[] = [
  {
    id: "cue-check", atMs: 1000, type: "knowledge-check", label: "Quick check",
    question: {
      prompt: "What comes first?",
      choices: [
        { id: "a", label: "Identify the energy source" },
        { id: "b", label: "Start the machine" },
      ],
      correctChoiceIds: ["a"],
      requireCorrect: true,
    },
  },
  {
    id: "cue-branch", atMs: 2000, type: "branch", label: "Pick a path",
    branchChoices: [
      { id: "go-review", label: "Review the basics", jumpToMs: 500 },
      { id: "go-next", label: "Next lesson", pageId: "page-2" },
    ],
  },
  { id: "cue-modal", atMs: 3000, type: "modal", label: "Safety note", modalRef: "popup-safety" },
  { id: "cue-chapter", atMs: 4000, type: "chapter", label: "Part two" },
];

function sceneWith(objects: VideoScene["objects"]): VideoScene {
  return withSceneCueMarkers(
    { id: "scene-1", name: "Scene 1", durationMs: 6000, transition: "cut", objects },
    markers,
  );
}

const videoObject = (id: string): VideoObject => ({
  id,
  type: "video",
  resource: "media/clip.mp4",
  timing: { start: 0, duration: 6 },
});

describe("cue marker storage", () => {
  it("sorts markers by time and clears the field when the last one goes", () => {
    const scene = sceneWith([]);
    expect(sceneCueMarkers(scene).map((m) => m.id)).toEqual([
      "cue-check", "cue-branch", "cue-modal", "cue-chapter",
    ]);
    const cleared = withSceneCueMarkers(scene, []);
    expect(sceneCueMarkers(cleared)).toEqual([]);
    expect("cueMarkers" in cleared).toBe(false);
  });

  it("survives a JSON round trip on the scene", () => {
    const scene = JSON.parse(JSON.stringify(sceneWith([]))) as VideoScene;
    expect(sceneCueMarkers(scene)).toEqual(markers);
  });
});

describe("OCF cue point export", () => {
  it("applies native cue points, actions, and modal triggers to the first video object only", () => {
    const scene = sceneWith([videoObject("vid-1"), videoObject("vid-2")]);
    const exported = withSceneCuePoints(scene);
    const [host, other] = exported.objects as VideoObject[];
    expect(other.cuePoints).toBeUndefined();
    expect(host.cuePoints?.map((c) => c.id)).toEqual(markers.map((m) => m.id));
    expect(host.cuePoints?.map((c) => c.at)).toEqual([1, 2, 3, 4]);
    expect(host.cuePoints?.[0].action?.kind).toBe("question");
    expect(host.cuePoints?.[1].action?.kind).toBe("branch");
    if (host.cuePoints?.[1].action?.kind === "branch") {
      expect(host.cuePoints[1].action.choices[1].page).toBe("page-2");
    }
    const trigger = host.triggers?.find((t) => t.event.cuePoint === "cue-modal");
    expect(trigger?.actions).toEqual([{ type: "open-popup", target: "popup-safety" }]);
    const stored = host.extensions?.["x-finch-studio"]?.cueMarkers as CueMarker[];
    expect(stored).toEqual(markers);
    // The authored scene itself is not mutated by exporting.
    expect((scene.objects[0] as VideoObject).cuePoints).toBeUndefined();
  });

  it("carries the extension copy on the first object when the scene has no video", () => {
    const scene = sceneWith([
      { id: "tx-1", type: "text", content: "<p>Hello</p>" } as VideoScene["objects"][number],
    ]);
    const exported = withSceneCuePoints(scene);
    const stored = exported.objects[0].extensions?.["x-finch-studio"]
      ?.cueMarkers as CueMarker[];
    expect(stored).toEqual(markers);
  });

  it("leaves marker-free scenes and projects untouched", () => {
    const plain: VideoScene = {
      id: "s", name: "S", durationMs: 5000, transition: "cut",
      objects: [videoObject("v")],
    };
    expect(withSceneCuePoints(plain)).toBe(plain);
    const project = projectWithCuePoints({ id: "p", name: "P", scenes: [plain] });
    expect(project.scenes[0]).toBe(plain);
  });
});

describe("choice text forms", () => {
  it("round trips question choices and keeps ids stable per line", () => {
    const parsed = parseQuestionChoices("One\nTwo\n", []);
    expect(parsed.map((c) => c.label)).toEqual(["One", "Two"]);
    const edited = parseQuestionChoices("One\nTwo edited\n", parsed);
    expect(edited[0].id).toBe(parsed[0].id);
    expect(edited[1].id).toBe(parsed[1].id);
    expect(questionChoicesToText(parsed)).toBe("One\nTwo");
  });

  it("round trips branch choices with jump, page, and video targets", () => {
    const text = branchChoicesToText(markers[1].branchChoices ?? []);
    expect(text).toBe("Review the basics @0.5s\nNext lesson -> page page-2");
    const parsed = parseBranchChoices(`${text}\nOther clip -> video vid-9`, []);
    expect(parsed[0]).toMatchObject({ label: "Review the basics", jumpToMs: 500 });
    expect(parsed[1]).toMatchObject({ label: "Next lesson", pageId: "page-2" });
    expect(parsed[2]).toMatchObject({ label: "Other clip", videoRef: "vid-9" });
  });
});
