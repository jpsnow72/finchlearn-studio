/**
 * LibraryPanel: project persistence and snapshots (issues #6 and #62).
 * Snapshots are named, non destructive copies of the whole project kept
 * in the browser library; the project itself autosaves continuously
 * (see App) and can be downloaded or imported as JSON.
 */
import { useRef, useState } from "react";
import type { VideoProject } from "@finch-studio/core";
import { useStudioStore } from "../store";

interface Snapshot {
  id: string;
  name: string;
  at: string;
  project: VideoProject;
}

const LS_KEY = "finch-studio.snapshots";

function loadSnapshots(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as Snapshot[];
  } catch {
    return [];
  }
}

export function LibraryPanel() {
  const project = useStudioStore((s) => s.project);
  const loadProject = useStudioStore((s) => s.loadProject);
  const [snaps, setSnaps] = useState<Snapshot[]>(loadSnapshots);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (next: Snapshot[]) => {
    setSnaps(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      setNote("Snapshot kept for this session only (browser storage full).");
    }
  };

  const take = () => {
    const snap: Snapshot = {
      id: `snap-${Date.now()}`,
      name: name.trim() || `Snapshot ${snaps.length + 1}`,
      at: new Date().toLocaleString(),
      project: JSON.parse(JSON.stringify(project)) as VideoProject,
    };
    persist([snap, ...snaps]);
    setName("");
    setNote(`Saved "${snap.name}".`);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(project.name || "studio-project").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as VideoProject;
      if (!parsed || !Array.isArray(parsed.scenes)) throw new Error("not a studio project");
      loadProject(parsed);
      setNote(`Imported "${parsed.name ?? "project"}".`);
    } catch {
      setNote("That file is not a studio project JSON.");
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">Project & snapshots</div>
      <div className="lib-row">
        <input
          type="text"
          placeholder="Snapshot name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" onClick={take}>Take snapshot</button>
      </div>
      {snaps.map((s) => (
        <div key={s.id} className="lib-snap">
          <span>{s.name} <span className="muted">{s.at}</span></span>
          <span>
            <button
              type="button"
              onClick={() => {
                loadProject(JSON.parse(JSON.stringify(s.project)) as VideoProject);
                setNote(`Restored "${s.name}".`);
              }}
            >
              Restore
            </button>
            <button type="button" onClick={() => persist(snaps.filter((x) => x.id !== s.id))}>
              Delete
            </button>
          </span>
        </div>
      ))}
      <div className="lib-row">
        <button type="button" onClick={download}>Download project JSON</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {note && <p className="muted">{note}</p>}
    </div>
  );
}
