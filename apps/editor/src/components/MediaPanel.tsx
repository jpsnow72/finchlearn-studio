/**
 * MediaPanel: the three source media browser (issue #15, media core #21).
 * Finch Stock and Unsplash ship sample entries until the media worker
 * search is connected; user media uploads land in the browser library
 * (localStorage index + data URL) with no duplicate uploads by hash.
 * Placing an image stamps its provenance credit onto the object name.
 */
import { useEffect, useRef, useState } from "react";
import type { CourseObject } from "@finch-studio/core";
import type { MediaAsset } from "@finch-studio/media";
import { useStudioStore, makeStudioImage, makeStudioVideo } from "../store";
import { ingestVideoObjectByUrl } from "../ingestFlow";
import { RecordPanel } from "./RecordPanel";
import { GenerateAssetPanel } from "./GenerateAssetPanel";
import {
  loadPackAnimation,
  searchLottiePack,
  makeBundledLottieObject,
  type LottiePackEntry,
} from "../lottie/lottiePack";
import { renderLottieSvg } from "../lottie/lottieCore";
import { loadLottieFromBytes } from "../lottie/dotLottie";
import { makeImportedLottieObject } from "../lottie/lottieObject";
import {
  fetchGenerativeIconAnimation,
  searchGenerativeIcons,
  type GenerativeIconResult,
} from "../lottie/generativeIcons";
import {
  bundledBackgroundRef,
  bundledFamilyName,
  makeBundledPropObject,
  searchBundledBackgrounds,
  searchBundledProps,
} from "../content/bundledContent";

const SAMPLE_STOCK: MediaAsset[] = [
  { id: "stk-office", source: "finch-stock", kind: "image", name: "Modern office", remoteUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=640&q=60", credit: "Finch Stock", tags: ["office"] },
  { id: "stk-team", source: "finch-stock", kind: "image", name: "Team meeting", remoteUrl: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=640&q=60", credit: "Finch Stock", tags: ["people"] },
  { id: "stk-desk", source: "finch-stock", kind: "image", name: "Desk with laptop", remoteUrl: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=640&q=60", credit: "Finch Stock", tags: ["work"] },
];

const SAMPLE_UNSPLASH: MediaAsset[] = [
  { id: "uns-mountain", source: "unsplash", kind: "image", name: "Mountain lake", remoteUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=640&q=60", credit: "Photo via Unsplash (sample)", tags: ["nature"] },
  { id: "uns-city", source: "unsplash", kind: "image", name: "City street", remoteUrl: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=640&q=60", credit: "Photo via Unsplash (sample)", tags: ["city"] },
];

interface UserItem {
  id: string;
  name: string;
  dataUrl: string;
  hash: string;
}

interface SceneGroupPreset {
  id: string;
  name: string;
  objects: CourseObject[];
}

const LS_KEY = "finch-studio.user-media";
const GROUPS_KEY = "finch-studio.user-scene-groups";

function loadUserItems(): UserItem[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as UserItem[];
  } catch {
    return [];
  }
}

function loadSceneGroups(): SceneGroupPreset[] {
  try {
    const stored = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]") as SceneGroupPreset[];
    return Array.isArray(stored)
      ? stored.filter((group) => group && typeof group.name === "string" && Array.isArray(group.objects))
      : [];
  } catch {
    return [];
  }
}

function nameFromUrl(url: string): string {
  try {
    const tail = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
    return tail || "Video";
  } catch {
    return "Video";
  }
}

async function hashOf(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return String(text.length);
  }
}

export function MediaPanel() {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const selectedObjectIds = useStudioStore((s) => s.selectedObjectIds);
  const addObject = useStudioStore((s) => s.addObject);
  const updateObject = useStudioStore((s) => s.updateObject);
  const insertObjectGroup = useStudioStore((s) => s.insertObjectGroup);
  const setSceneBackground = useStudioStore((s) => s.setSceneBackground);
  const [tab, setTab] = useState<"stock" | "unsplash" | "mine" | "record" | "groups" | "props" | "backgrounds" | "generate" | "builtin" | "browse">("stock");
  const [bundledSearch, setBundledSearch] = useState("");
  const [lottieSearch, setLottieSearch] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseResults, setBrowseResults] = useState<GenerativeIconResult[] | null>(null);
  const [browseError, setBrowseError] = useState("");
  const [browseBusy, setBrowseBusy] = useState(false);
  const lottieFileRef = useRef<HTMLInputElement>(null);
  const [mine, setMine] = useState<UserItem[]>(loadUserItems);
  const [groups, setGroups] = useState<SceneGroupPreset[]>(loadSceneGroups);
  const [groupName, setGroupName] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scene = project.scenes.find((item) => item.id === currentSceneId);
  const selectedObjects = scene?.objects.filter((object) => selectedObjectIds.includes(object.id)) ?? [];

  const persistGroups = (next: SceneGroupPreset[]) => {
    setGroups(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {
      setNote("Saved group is available for this session only (browser storage full).");
    }
  };

  const saveSelectedGroup = () => {
    if (selectedObjects.length === 0) return;
    const name = groupName.trim() || `Scene group ${groups.length + 1}`;
    const preset: SceneGroupPreset = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      objects: JSON.parse(JSON.stringify(selectedObjects)) as CourseObject[],
    };
    persistGroups([preset, ...groups]);
    setGroupName("");
    setNote(`Saved "${name}" to your library.`);
  };

  const place = (asset: MediaAsset) => {
    if (!asset.remoteUrl) return;
    addObject(makeStudioImage(asset.remoteUrl, asset.credit ? `${asset.name} (${asset.credit})` : asset.name));
    setNote(`Added "${asset.name}" to the scene.`);
  };

  const onUpload = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const hash = await hashOf(dataUrl);
    if (mine.some((m) => m.hash === hash)) {
      setNote("That file is already in your library, no duplicate added.");
      return;
    }
    const item: UserItem = { id: `usr-${hash}`, name: file.name, dataUrl, hash };
    const next = [...mine, item];
    setMine(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      setNote("Library is full in this browser; the image was added for this session only.");
    }
    addObject(makeStudioImage(dataUrl, file.name));
    setNote(`Uploaded and added "${file.name}".`);
  };

  const addVideoByUrl = () => {
    const url = videoUrl.trim();
    if (!url) return;
    const name = nameFromUrl(url);
    const object = makeStudioVideo(url, name);
    addObject(object);
    setVideoUrl("");
    setNote(`Added "${name}" to the scene.`);
    // The object is usable at once from its original URL; the ingest
    // job (issue #7) runs behind it and switches preview to the 720p
    // proxy when its artefacts are ready.
    void ingestVideoObjectByUrl(object, updateObject).then((outcome) => {
      if (outcome.status === "done") {
        setNote(`Ingest finished for "${name}": preview now uses the 720p proxy.`);
      } else if (outcome.status === "failed") {
        setNote(
          `Ingest did not finish for "${name}" (${outcome.error}). The original video stays in the scene.`,
        );
      }
    });
  };

  const onLottieUpload = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const anim = await loadLottieFromBytes(bytes);
      addObject(makeImportedLottieObject(anim, file.name, "import"));
      setNote(`Imported "${file.name}" as an animated Lottie object.`);
    } catch (err) {
      setNote(
        err instanceof Error
          ? `Could not import "${file.name}": ${err.message}`
          : `Could not import "${file.name}".`,
      );
    }
  };

  const runBrowseSearch = async () => {
    setBrowseBusy(true);
    setBrowseError("");
    try {
      setBrowseResults(await searchGenerativeIcons(browseQuery));
    } catch (err) {
      // Honest failure: no local or invented results are substituted.
      setBrowseResults(null);
      setBrowseError(
        err instanceof Error
          ? `Browse could not reach Generative Icons: ${err.message}`
          : "Browse could not reach Generative Icons.",
      );
    } finally {
      setBrowseBusy(false);
    }
  };

  const insertBrowseResult = async (result: GenerativeIconResult) => {
    setBrowseBusy(true);
    try {
      const anim = await fetchGenerativeIconAnimation(result);
      addObject(makeImportedLottieObject(anim, result.label, "generative-icons"));
      setNote(`Added "${result.label}" from Generative Icons to the scene.`);
    } catch (err) {
      setBrowseError(
        err instanceof Error ? err.message : `Could not add "${result.label}".`,
      );
    } finally {
      setBrowseBusy(false);
    }
  };

  const items = tab === "stock" ? SAMPLE_STOCK : tab === "unsplash" ? SAMPLE_UNSPLASH : [];
  const matchingGroups = groups.filter((group) => {
    const query = groupSearch.trim().toLowerCase();
    return !query || [group.name, ...group.objects.flatMap((object) => [object.name ?? "", object.type])]
      .some((value) => value.toLowerCase().includes(query));
  });

  return (
    <div className="panel">
      <div className="panel-title">Media</div>
      <div className="media-tabs" role="tablist">
        <button type="button" className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Finch Stock</button>
        <button type="button" className={tab === "unsplash" ? "active" : ""} onClick={() => setTab("unsplash")}>Unsplash</button>
        <button type="button" className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>My media</button>
        <button type="button" className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}>Record</button>
        <button type="button" className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}>Groups</button>
        <button type="button" className={tab === "props" ? "active" : ""} onClick={() => setTab("props")}>Props</button>
        <button type="button" className={tab === "backgrounds" ? "active" : ""} onClick={() => setTab("backgrounds")}>Backgrounds</button>
        <button type="button" className={tab === "generate" ? "active" : ""} onClick={() => setTab("generate")}>Generate</button>
        <button type="button" className={tab === "builtin" ? "active" : ""} onClick={() => setTab("builtin")}>Built-in</button>
        <button type="button" className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>Browse</button>
      </div>
      {tab === "props" || tab === "backgrounds" ? (
        <div>
          <input
            type="search"
            placeholder={tab === "props" ? "Search bundled props" : "Search bundled backgrounds"}
            aria-label={tab === "props" ? "Search bundled props" : "Search bundled backgrounds"}
            value={bundledSearch}
            onChange={(e) => setBundledSearch(e.target.value)}
          />
          {tab === "props" ? (
            <div className="media-grid">
              {searchBundledProps(bundledSearch).map((prop) => (
                <button
                  key={prop.id}
                  type="button"
                  className="media-thumb prop-thumb"
                  title={`${prop.name}, ${bundledFamilyName(prop.family)}. Original bundled art, cleared for commercial use.`}
                  onClick={() => {
                    addObject(makeBundledPropObject(prop));
                    setNote(`Added "${prop.name}" to the scene.`);
                  }}
                >
                  <img src={prop.dataUri} alt={prop.name} loading="lazy" />
                  <span>{prop.name} ({prop.family})</span>
                </button>
              ))}
              {searchBundledProps(bundledSearch).length === 0 && (
                <p className="muted">No bundled props match your search.</p>
              )}
            </div>
          ) : (
            <div className="media-grid">
              {searchBundledBackgrounds(bundledSearch).map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  className="media-thumb bg-thumb"
                  title={`${bg.name}, ${bundledFamilyName(bg.family)}. Original bundled art, cleared for commercial use.`}
                  onClick={() => {
                    if (!scene) return;
                    setSceneBackground(scene.id, bundledBackgroundRef(bg));
                    setNote(`Background set to "${bg.name}".`);
                  }}
                >
                  <img src={bg.dataUri} alt={bg.name} loading="lazy" />
                  <span>{bg.name} ({bg.family})</span>
                </button>
              ))}
              {searchBundledBackgrounds(bundledSearch).length === 0 && (
                <p className="muted">No bundled backgrounds match your search.</p>
              )}
            </div>
          )}
          <p className="muted">Bundled with Studio. Original art, cleared for commercial use.</p>
        </div>
      ) : null}
      {tab === "builtin" ? (
        <div>
          <input
            type="search"
            placeholder="Search built in animations"
            aria-label="Search built in animations"
            value={lottieSearch}
            onChange={(e) => setLottieSearch(e.target.value)}
          />
          <div className="media-grid">
            {searchLottiePack(lottieSearch).map((item) => (
              <button
                key={item.id}
                type="button"
                className="media-thumb prop-thumb"
                title={`${item.name}, Generative Icons, MIT license. Animated Lottie object.`}
                onClick={() => {
                  addObject(makeBundledLottieObject(item));
                  setNote(`Added "${item.name}" to the scene.`);
                }}
              >
                <LottiePackThumb item={item} />
                <span>{item.name}</span>
              </button>
            ))}
            {searchLottiePack(lottieSearch).length === 0 && (
              <p className="muted">No built in animations match your search.</p>
            )}
          </div>
          <p className="muted">
            Built in animated icons from Generative Icons, MIT license. Click to place one
            as an animated object; it renders in preview and in exports.
          </p>
        </div>
      ) : tab === "browse" ? (
        <div>
          <div className="lib-row">
            <input
              type="search"
              placeholder="Search Generative Icons"
              aria-label="Search Generative Icons"
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
            />
            <button type="button" onClick={() => void runBrowseSearch()} disabled={browseBusy}>
              {browseBusy ? "Searching" : "Search"}
            </button>
          </div>
          {browseError && <p className="muted" role="alert">{browseError}</p>}
          {browseResults === null && !browseError && (
            <p className="muted">Search the live Generative Icons catalogue and click a result to add it to the scene.</p>
          )}
          <div className="media-grid">
            {(browseResults ?? []).map((result) => (
              <button
                key={result.id}
                type="button"
                className="media-thumb"
                title={result.description ?? result.label}
                disabled={browseBusy}
                onClick={() => void insertBrowseResult(result)}
              >
                <span>{result.label}</span>
                {result.category && <span className="muted">{result.category}</span>}
              </button>
            ))}
          </div>
          {browseResults !== null && browseResults.length === 0 && !browseError && (
            <p className="muted">No icons matched that search on Generative Icons.</p>
          )}
          <p className="muted">Live results from generativeicons.com, MIT license.</p>
        </div>
      ) : null}
      {tab === "stock" || tab === "unsplash" ? (
        <div className="media-grid">
          {items.map((a) => (
            <button key={a.id} type="button" className="media-thumb" onClick={() => place(a)} title={a.credit ?? a.name}>
              <img src={a.remoteUrl} alt={a.name} loading="lazy" />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      ) : tab === "mine" ? (
        <div>
          <div className="media-grid">
            {mine.map((m) => (
              <button
                key={m.id}
                type="button"
                className="media-thumb"
                onClick={() => addObject(makeStudioImage(m.dataUrl, m.name))}
              >
                <img src={m.dataUrl} alt={m.name} loading="lazy" />
                <span>{m.name}</span>
              </button>
            ))}
            {mine.length === 0 && <p className="muted">Nothing uploaded yet.</p>}
          </div>
          <button type="button" onClick={() => fileRef.current?.click()}>Upload image</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = "";
            }}
          />
          <div className="sub-title">Video by URL</div>
          <div className="media-add-url">
            <input
              type="url"
              placeholder="Video file URL (mp4, webm)"
              aria-label="Video URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
            <button type="button" disabled={!videoUrl.trim()} onClick={addVideoByUrl}>
              Add video
            </button>
          </div>
          <p className="muted">
            The video lands in the scene right away from its original URL. When the
            ingest service is configured, a 720p proxy, waveform peaks, and a thumbnail
            strip are generated in the background, and preview switches to the proxy
            when they are ready. Exports always use the original.
          </p>
          <div className="sub-title">Lottie animation</div>
          <button type="button" onClick={() => lottieFileRef.current?.click()}>
            Import Lottie (.json, .lottie)
          </button>
          <input
            ref={lottieFileRef}
            type="file"
            accept=".json,.lottie,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onLottieUpload(f);
              e.target.value = "";
            }}
          />
          <p className="muted">
            A Lottie file lands on the stage as a first class animated object you can move,
            scale, rotate, and time like any other object. You can also drop a rendered
            MP4 or MOV file in as a video object today.
          </p>
        </div>
      ) : tab === "record" ? (
        <RecordPanel />
      ) : tab === "generate" ? (
        <GenerateAssetPanel />
      ) : tab === "groups" ? (
        <div>
          <div className="lib-row">
            <input
              type="text"
              placeholder="Name this group"
              aria-label="Saved group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <button type="button" onClick={saveSelectedGroup} disabled={selectedObjects.length === 0}>
              Save {selectedObjects.length || ""} selected
            </button>
          </div>
          <input
            type="search"
            placeholder="Search saved groups"
            aria-label="Search saved groups"
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
          />
          <div className="scene-group-list">
            {matchingGroups.map((group) => (
              <div key={group.id} className="lib-snap">
                <span>{group.name} <span className="muted">{group.objects.length} objects</span></span>
                <span>
                  <button type="button" onClick={() => {
                    insertObjectGroup(group.objects);
                    setNote(`Added "${group.name}" to the scene.`);
                  }}>Insert</button>
                  <button type="button" onClick={() => persistGroups(groups.filter((item) => item.id !== group.id))}>Delete</button>
                </span>
              </div>
            ))}
            {matchingGroups.length === 0 && (
              <p className="muted">{groups.length === 0 ? "No saved groups yet. Shift-click objects on stage to select more than one." : "No groups match your search."}</p>
            )}
          </div>
        </div>
      ) : null}
      {note && <p className="muted">{note}</p>}
    </div>
  );
}

/**
 * Animated thumbnail for a built in pack icon: one frame of the shared
 * deterministic renderer, loaded through the same pack loader the
 * stage uses. Falls back to the icon name while loading or on failure.
 */
function LottiePackThumb({ item }: { item: LottiePackEntry }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    loadPackAnimation(item)
      .then((anim) => {
        if (live) setSvg(renderLottieSvg(anim, 600, { loop: true }));
      })
      .catch(() => {
        if (live) setSvg("");
      });
    return () => {
      live = false;
    };
  }, [item]);
  if (!svg) return <span aria-hidden="true">{item.name}</span>;
  return (
    <span
      aria-hidden="true"
      style={{ display: "block", width: 48, height: 48, margin: "0 auto" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
