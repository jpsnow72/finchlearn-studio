/**
 * Shared Supabase client (issue #67). Same project as FinchLearn, so a
 * FinchLearn account signs in here with the same email and password.
 * Session persistence is the client's localStorage storage; true
 * cross-subdomain cookie SSO completes when FinchLearn's auth moves to
 * shared .finchlearn.com cookies.
 */
import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseEnabled = Boolean(url && anon);
export const supabase = supabaseEnabled ? createClient(url!, anon!) : null;

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email: string, password: string): Promise<Session> {
  if (!supabase) throw new Error("Sign in is not configured in this build.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Sign in did not return a session.");
  return data.session;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
