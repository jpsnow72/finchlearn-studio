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
 * Session: the shared Supabase project (same accounts as FinchLearn).
 * The client session persists in this subdomain's storage; full
 * cross-subdomain cookie SSO lands when FinchLearn auth moves to shared
 * .finchlearn.com cookies. Builds without the Supabase env fall back to
 * the local session flag with the same shape.
 */
import { useEffect, useState } from "react";
import { App } from "./App";
import { currentSession, signIn, signOut, supabaseEnabled } from "./supabase";
import { useStudioStore, makeStarterProject } from "./store";

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

export function LandingPage({
  onContinue,
  onSignedIn,
}: {
  onContinue: () => void;
  onSignedIn: (s: StudioSession) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await signIn(email.trim(), password);
      onSignedIn({ userId: session.user.id, email: session.user.email ?? email.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell shell-hero">
      <h1>Make training videos people actually finish.</h1>
      <p>
        FinchLearn Studio pairs Vyond style ease with the editing basics that
        matter: real footage, clean audio, captions, and exports that keep
        working forever, with no account required to play them.
      </p>
      {supabaseEnabled ? (
        <form
          className="shell-signin"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="email"
            required
            placeholder="Email (your FinchLearn account)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Password"
          />
          <button type="submit" className="shell-cta" disabled={busy}>
            {busy ? "Signing in..." : "Sign In"}
          </button>
          {error && <p className="shell-error">{error}</p>}
        </form>
      ) : (
        <div className="shell-ctas">
          <button type="button" className="shell-cta" onClick={onContinue}>
            Start Creating Free
          </button>
        </div>
      )}
      <div className="shell-features">
        <div className="shell-feature"><strong>Characters that act</strong>Animated characters with actions, expressions, and lip sync, no drawing required.</div>
        <div className="shell-feature"><strong>Real editing basics</strong>Scenes, a capped timeline, trims, transitions, audio fades and keyframes.</div>
        <div className="shell-feature"><strong>Exports that last</strong>MP4 and captions that keep working forever, with no account needed to play them.</div>
        <div className="shell-feature"><strong>Drops into courses</strong>Built for FinchLearn: send a finished video straight into a course block.</div>
      </div>
    </main>
  );
}

export function FrontPage({
  session,
  onOpenEditor,
  onSignOut,
}: {
  session: StudioSession;
  onOpenEditor: () => void;
  onSignOut: () => void;
}) {
  const projects = readList<SavedProject>(PROJECTS_KEY);
  const exportsList = readList<SavedExport>(EXPORTS_KEY);
  return (
    <main className="shell">
      <h1>Welcome back</h1>
      <p className="shell-empty">
        Signed in as {session.email}. Pick up where you left off.{" "}
        <button type="button" onClick={onSignOut}>Sign out</button>
      </p>
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
  const [session, setSession] = useState<StudioSession | null>(() =>
    supabaseEnabled ? null : readSession(),
  );
  const [inEditor, setInEditor] = useState(false);

  useEffect(() => {
    if (embedded) setInEditor(true);
  }, [embedded]);

  // First run seeding: a brand new user (nothing stored, not embedded)
  // starts from the friendly starter scene instead of a blank canvas.
  useEffect(() => {
    try {
      if (localStorage.getItem("ocf.video-studio.project.v1")) return;
      const state = useStudioStore.getState();
      const p = state.project;
      if (
        p.name === "Untitled video" &&
        p.scenes.length === 1 &&
        (p.scenes[0]?.objects.length ?? 0) === 0
      ) {
        state.loadProject(makeStarterProject("Untitled video"));
      }
    } catch {
      // Storage unavailable: leave the blank project.
    }
  }, [embedded]);
  // (An embedded open with a stashed course project is never blank, so it
  // is never seeded; an embedded open with nothing stashed gets the
  // starter like any other first run.)

  useEffect(() => {
    if (!supabaseEnabled) return;
    let live = true;
    void currentSession().then((s) => {
      if (live && s) {
        setSession({ userId: s.user.id, email: s.user.email ?? "" });
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (embedded || inEditor) return <App />;
  if (!session) {
    return (
      <LandingPage
        onContinue={() => setSession(signInLocally())}
        onSignedIn={(s) => setSession(s)}
      />
    );
  }
  return (
    <FrontPage
      session={session}
      onOpenEditor={() => setInEditor(true)}
      onSignOut={() => {
        void signOut();
        try {
          localStorage.removeItem(SESSION_KEY);
        } catch {
          // ignore
        }
        setSession(null);
      }}
    />
  );
}
