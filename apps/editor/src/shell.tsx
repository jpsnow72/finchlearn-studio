/**
 * Root surface resolution (issues #67 and #68).
 *
 * studio.finchlearn.com root route, resolved by session with no redirect
 * flash:
 * - embedded handoff (?embed=finchlearn or a signed handoff token) opens
 *   the editor directly, bypassing both public surfaces;
 * - signed out renders the Landing Page;
 * - signed in renders the Front Page hub (Netflix style swimlanes).
 *
 * Session seam: in production the session is the shared Supabase session on
 * .finchlearn.com, so a FinchLearn user arrives already signed in. Until the
 * Supabase project env is wired for this app, the seam below uses a local
 * session flag with the same shape (null = signed out, object = signed in),
 * so the routing logic being exercised is the production logic.
 */
import { useEffect, useState } from "react";
import { App } from "./App";

export interface StudioSession {
  userId: string;
  email: string;
}

const SESSION_KEY = "finch-studio-session";
const PROJECTS_KEY = "finch-studio-projects";
const EXPORTS_KEY = "finch-studio-exports";

export function readSession(): StudioSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StudioSession) : null;
  } catch {
    return null;
  }
}

function signInLocally(): StudioSession {
  const s: StudioSession = { userId: "local-user", email: "you@finchlearn.com" };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  return s;
}

interface SavedProject {
  id: string;
  name: string;
  updatedAt: string;
}
interface SavedExport {
  id: string;
  name: string;
  savedAt: string;
}

function readList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

export function LandingPage({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="shell shell-hero">
      <h1>Make training videos people actually finish.</h1>
      <p>
        FinchLearn Studio pairs Vyond style ease with the editing basics that
        matter: real footage, clean audio, captions, and exports that keep
        working forever, with no account required to play them.
      </p>
      <div className="shell-ctas">
        <button type="button" className="shell-cta" onClick={onContinue}>
          Start Creating Free
        </button>
        <button type="button" className="shell-cta secondary" onClick={onContinue}>
          Sign In / Continue with FinchLearn
        </button>
      </div>
    </main>
  );
}

export function FrontPage({
  session,
  onOpenEditor,
}: {
  session: StudioSession;
  onOpenEditor: () => void;
}) {
  const projects = readList<SavedProject>(PROJECTS_KEY);
  const exportsList = readList<SavedExport>(EXPORTS_KEY);
  return (
    <main className="shell">
      <h1>Welcome back</h1>
      <p className="shell-empty">Signed in as {session.email}. Pick up where you left off.</p>
      <section className="shell-lane">
        <h2>Continue Editing</h2>
        {projects.length === 0 ? (
          <p className="shell-empty">No projects yet. Start your first video.</p>
        ) : (
          <div className="shell-cards">
            {projects.map((p) => (
              <div className="shell-card" key={p.id}>
                <strong>{p.name}</strong>
                <div className="shell-empty">Edited {new Date(p.updatedAt).toLocaleDateString()}</div>
                <button type="button" onClick={onOpenEditor}>Open</button>
              </div>
            ))}
          </div>
        )}
        <div className="shell-ctas">
          <button type="button" className="shell-cta" onClick={onOpenEditor}>
            New Project
          </button>
        </div>
      </section>
      <section className="shell-lane">
        <h2>Templates</h2>
        <p className="shell-empty">Starter templates land with the template system. Your saved scene groups will live here too.</p>
      </section>
      <section className="shell-lane">
        <h2>Recent Exports</h2>
        {exportsList.length === 0 ? (
          <p className="shell-empty">Finished videos you save to your media library will show up here.</p>
        ) : (
          <div className="shell-cards">
            {exportsList.map((e) => (
              <div className="shell-card" key={e.id}>
                <strong>{e.name}</strong>
                <div className="shell-empty">Saved {new Date(e.savedAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export function Root() {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embed") === "finchlearn" || params.has("handoff");
  const [session, setSession] = useState<StudioSession | null>(() => readSession());
  const [inEditor, setInEditor] = useState(false);

  useEffect(() => {
    if (embedded) setInEditor(true);
  }, [embedded]);

  if (embedded || inEditor) return <App />;
  if (!session) return <LandingPage onContinue={() => setSession(signInLocally())} />;
  return <FrontPage session={session} onOpenEditor={() => setInEditor(true)} />;
}
