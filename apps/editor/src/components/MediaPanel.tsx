/**
 * MediaPanel: the three source media browser (issue #15, media core #21).
 * Finch Stock and Unsplash ship sample entries until the media worker
 * search is connected; user media uploads land in the browser library
 * (localStorage index + data URL) with no duplicate uploads by hash.
 * Placing an image stamps its provenance credit onto the object name.
 */
import { useRef, useState } from "react";
import type { MediaAsset } from "@finch-studio/media";
import { useStudioStore, makeStudioImage } from "../store";

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

const LS_KEY = "finch-studio.user-media";

function loadUserItems(): UserItem[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as UserItem[];
  } catch {
    return [];
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
  const addObject = useStudioStore((s) => s.addObject);
  const [tab, setTab] = useState<"stock" | "unsplash" | "mine">("stock");
  const [mine, setMine] = useState<UserItem[]>(loadUserItems);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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

  const items = tab === "stock" ? SAMPLE_STOCK : tab === "unsplash" ? SAMPLE_UNSPLASH : [];

  return (
    <div className="panel">
      <div className="panel-title">Media</div>
      <div className="media-tabs" role="tablist">
        <button type="button" className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Finch Stock</button>
        <button type="button" className={tab === "unsplash" ? "active" : ""} onClick={() => setTab("unsplash")}>Unsplash</button>
        <button type="button" className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>My media</button>
      </div>
      {tab !== "mine" ? (
        <div className="media-grid">
          {items.map((a) => (
            <button key={a.id} type="button" className="media-thumb" onClick={() => place(a)} title={a.credit ?? a.name}>
              <img src={a.remoteUrl} alt={a.name} loading="lazy" />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      ) : (
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
        </div>
      )}
      {note && <p className="muted">{note}</p>}
    </div>
  );
}
