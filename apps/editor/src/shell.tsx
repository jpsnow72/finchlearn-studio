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
import { currentSession, signIn, signInWithGoogle, signOut, supabaseEnabled } from "./supabase";
import { useStudioStore, makeStarterProject, readProjectLibrary, libraryProject } from "./store";
import {
  fetchCloudProject,
  listCloudExports,
  listCloudProjects,
  type CloudExport,
  type CloudProjectSummary,
} from "./cloud";
import {
  handoffRejectMessage,
  resolveEmbed,
  type EmbedResolution,
  type HandoffRejectReason,
} from "./embed";

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
  downloadUrl?: string;
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

  const google = async () => {
    setError("");
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign in failed.");
    }
  };

  return (
    <main className="shell landing">
      <header className="landing-nav">
        <div className="landing-brand">🎬 FinchLearn Studio</div>
        <a className="shell-cta secondary" href="#signin">
          Sign in
        </a>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <h1>Make training videos people actually finish.</h1>
          <p className="landing-sub">
            FinchLearn Studio pairs Vyond style ease with the editing basics
            that matter: animated characters that act and speak, real footage,
            clean audio, captions, and exports that keep working forever.
          </p>
          <ul className="landing-checks">
            <li>Paste a script, get a directed video: scenes, dialogue, and lip sync built for you</li>
            <li>39 production voices, from warm basic narration to premium studio voices</li>
            <li>Send finished videos straight into your FinchLearn courses</li>
          </ul>
          <p className="landing-launch">
            Launching with FinchLearn in mid-December 2026.
          </p>
        </div>

        <div className="landing-signin" id="signin">
          <h2>Welcome back</h2>
          <p className="muted">Sign in with your FinchLearn account.</p>
          {supabaseEnabled ? (
            <>
              <button type="button" className="google-btn" onClick={() => void google()}>
                <span className="google-g">G</span> Continue with Google
              </button>
              <div className="signin-divider">
                <span>or</span>
              </div>
              <form
                className="shell-signin landing-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <input
                  type="email"
                  required
                  placeholder="Email"
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
              <div className="landing-newaccount">
                <strong>New to FinchLearn?</strong> Account sign-up is not
                open yet. Studio accounts arrive with the FinchLearn launch
                in mid-December 2026. Want early access to the beta? Email{" "}
                <a href="mailto:support@finchlearn.com?subject=Studio%20beta%20access">
                  support@finchlearn.com
                </a>{" "}
                and mention Studio.
              </div>
            </>
          ) : (
            <div className="shell-ctas">
              <button type="button" className="shell-cta" onClick={onContinue}>
                Start Creating Free
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="landing-section">
        <h2>How it works</h2>
        <div className="landing-steps">
          <div className="landing-step">
            <strong>1. Write or paste a script</strong>
            Studio builds the scenes, assigns the dialogue, and times every
            line to real narration.
          </div>
          <div className="landing-step">
            <strong>2. Direct your cast</strong>
            Pick characters, actions, and expressions. Add footage, images,
            music, and captions on a simple timeline.
          </div>
          <div className="landing-step">
            <strong>3. Export anywhere</strong>
            MP4 and captions that play forever with no account or
            subscription, or drop the video straight into a FinchLearn
            course.
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2>Why creators switch</h2>
        <div className="shell-features landing-features">
          <div className="shell-feature">
            <strong>Characters that act</strong>
            A rigged cast with ten actions, switchable expressions, and lip
            sync from your dialogue. No drawing, no stock-photo stiffness.
          </div>
          <div className="shell-feature">
            <strong>Voices that sound human</strong>
            39 production voices built in, basic and premium, generated per
            line and mixed into every export automatically.
          </div>
          <div className="shell-feature">
            <strong>Real editing basics</strong>
            Scenes, a capped timeline, trims, transitions, audio fades,
            volume keyframes, and music that ducks under narration.
          </div>
          <div className="shell-feature">
            <strong>Captions without the chore</strong>
            Caption files from your dialogue in one click, plus a burned-in
            captions option for muted autoplay feeds.
          </div>
          <div className="shell-feature">
            <strong>Made for courses</strong>
            Studio is the video companion to FinchLearn: open it inside a
            course block, finish the video, and it lands in the course.
          </div>
          <div className="shell-feature">
            <strong>Exports that last</strong>
            Your MP4s keep working forever. Cancel, downgrade, walk away:
            published videos never phone home.
          </div>
        </div>
      </section>

      <section className="landing-band">
        <h2>Switch &amp; Keep</h2>
        <div className="landing-band-points">
          <span>Cheaper at every tier than the big animation suites</span>
          <span>Exports run forever, no subscription required to play them</span>
          <span>No expiring AI credits, plain generous allowances</span>
          <span>Your work stays yours: download everything, any time</span>
        </div>
        <p className="muted">
          FinchLearn plans: Community free · Keeper $99/yr · Creator $29/mo ·
          Studio $49/mo. Full details at finchlearn.com.
        </p>
      </section>

      <footer className="landing-footer">
        <span>🎬 FinchLearn Studio</span>
        <span>
          Questions? <a href="mailto:support@finchlearn.com">support@finchlearn.com</a>
        </span>
      </footer>
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
  const listed = readList<SavedProject>(PROJECTS_KEY);
  const localExports = readList<SavedExport>(EXPORTS_KEY);
  const current = useStudioStore((s) => s.project);
  const loadProject = useStudioStore((s) => s.loadProject);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [cloudExports, setCloudExports] = useState<CloudExport[]>([]);
  const [restoreNote, setRestoreNote] = useState("");
  useEffect(() => {
    let live = true;
    void listCloudProjects().then((rows) => {
      if (live) setCloudProjects(rows);
    });
    void listCloudExports().then((rows) => {
      if (live) setCloudExports(rows);
    });
    return () => {
      live = false;
    };
  }, []);
  const library = readProjectLibrary();
  const projects: SavedProject[] = [
    { id: current.id, name: current.name, updatedAt: new Date().toISOString() },
    ...library
      .filter((e) => e.project.id !== current.id)
      .map((e) => ({ id: e.project.id, name: e.project.name, updatedAt: e.updatedAt })),
    ...listed.filter(
      (p) => p.id !== current.id && !library.some((e) => e.project.id === p.id),
    ),
  ];
  const openLocalProject = (id: string) => {
    if (id === current.id) {
      onOpenEditor();
      return;
    }
    const data = libraryProject(id);
    if (data) {
      loadProject(data);
      onOpenEditor();
    } else {
      setRestoreNote("That project is not stored on this device. Check the cloud list below.");
    }
  };
  const cloudOnlyProjects = cloudProjects.filter(
    (cp) => !projects.some((p) => p.id === cp.id),
  );
  const exportsList: SavedExport[] = [
    ...localExports,
    ...cloudExports
      .filter((ce) => !localExports.some((le) => le.name === ce.name && le.savedAt.slice(0, 10) === ce.savedAt.slice(0, 10)))
      .map((ce) => ({ id: ce.id, name: ce.name, savedAt: ce.savedAt })),
  ];
  const openCloudProject = async (id: string) => {
    setRestoreNote("Loading from your library…");
    const data = await fetchCloudProject(id);
    if (data) {
      loadProject(data);
      onOpenEditor();
    } else {
      setRestoreNote("That project could not be loaded. It may have been removed.");
    }
  };
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
                <button type="button" onClick={() => openLocalProject(p.id)}>Open</button>
              </div>
            ))}
            {cloudOnlyProjects.map((p) => (
              <div className="shell-card" key={p.id}>
                <strong>{p.name}</strong>
                <div className="shell-empty">
                  ☁ Cloud · Saved {new Date(p.updatedAt).toLocaleDateString()}
                </div>
                <button type="button" onClick={() => void openCloudProject(p.id)}>
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
        {restoreNote && <p className="shell-empty">{restoreNote}</p>}
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
                {e.downloadUrl && (
                  <a href={e.downloadUrl} target="_blank" rel="noreferrer">
                    Download
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/** Error surface for a handoff that failed verification (issue #49).
 * Fail closed: no editor, no project, just plain guidance. */
export function EmbedError({ reason }: { reason: HandoffRejectReason }) {
  return (
    <main className="shell">
      <h1>This course link did not check out</h1>
      <p className="shell-empty">{handoffRejectMessage(reason)}</p>
    </main>
  );
}

export function Root() {
  const [resolution, setResolution] = useState<EmbedResolution | null>(null);
  const [session, setSession] = useState<StudioSession | null>(() =>
    supabaseEnabled ? null : readSession(),
  );
  const [inEditor, setInEditor] = useState(false);

  // Embed resolution (issue #49): a signed handoff is verified before
  // anything opens. Legacy ?embed=<objectId> keeps its local bridge.
  useEffect(() => {
    let live = true;
    void resolveEmbed(window.location.search).then(async (resolved) => {
      if (!live) return;
      if (resolved.kind === "handoff") {
        const { context } = resolved;
        const state = useStudioStore.getState();
        state.setEmbedContext(context);
        try {
          const openedKey = `finch-studio.embed-opened.${context.nonce}`;
          if (!sessionStorage.getItem(openedKey)) {
            sessionStorage.setItem(openedKey, "1");
            if (context.mode === "create") {
              state.newProject();
            } else if (context.projectId) {
              // Edit again: reopen the same project. The cloud copy is
              // the durable one; a local copy with the same id is the
              // fallback, and if neither exists the editor still opens
              // bound to the block so the work is never lost.
              const cloud = await fetchCloudProject(context.projectId);
              if (cloud) useStudioStore.getState().loadProject(cloud);
            }
          }
        } catch {
          // Storage unavailable: the verified context still stands.
        }
        if (live) setInEditor(true);
      } else if (resolved.kind === "legacy") {
        setInEditor(true);
      }
      if (live) setResolution(resolved);
    });
    return () => {
      live = false;
    };
  }, []);

  const embedded = resolution?.kind === "handoff" || resolution?.kind === "legacy";

  // First run seeding: a brand new user (nothing stored, not embedded)
  // starts from the friendly starter scene instead of a blank canvas.
  useEffect(() => {
    if (resolution === null || embedded) return;
    try {
      const fresh = new URLSearchParams(window.location.search).has("fresh");
      if (!fresh && localStorage.getItem("ocf.video-studio.project.v1")) return;
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
  }, [resolution, embedded]);
  // (Embedded opens never seed: a legacy open loads its stashed project,
  // a handoff open starts fresh in create mode or reopens the bound
  // project in edit mode.)

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

  if (resolution?.kind === "invalid") {
    return <EmbedError reason={resolution.reason} />;
  }
  if (resolution === null) {
    // Resolving the surface (session or handoff) with no flash of the
    // wrong one, per the #67 no-flash rule.
    return (
      <main className="shell">
        <p className="shell-empty">Opening Studio...</p>
      </main>
    );
  }
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
