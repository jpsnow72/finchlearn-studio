/**
 * cloud.ts — Studio cloud save (issue #49).
 *
 * Two halves, both keyed to the signed-in FinchLearn account:
 *  - Projects: upserted into public.studio_projects (RLS owner-only)
 *    through the shared Supabase client. localStorage stays the working
 *    copy; the cloud row is the durable copy the hub lists and restores.
 *  - Exports: the rendered file goes to the finch-exports R2 bucket via
 *    the finch-media Worker's POST /v1/studio/exports (presigned PUT,
 *    keys s/{userId}/...), then a public.studio_exports row records it
 *    for the hub's Recent Exports lane. The worker returns a signed
 *    download URL good for 7 days; after that the file still exists in
 *    the bucket until its 30-day lifecycle, and a fresh link is a
 *    future worker addition.
 *
 * Everything no-ops (returns null / empty) when signed out or when the
 * build has no Supabase config, so local-only use never breaks.
 */
import type { VideoProject } from "@finch-studio/core";
import { supabase, supabaseEnabled } from "./supabase";

export const MEDIA_WORKER_URL = "https://finch-media.jpsnow72.workers.dev";

export interface CloudExport {
  id: string;
  name: string;
  objectKey: string;
  downloadUrl: string;
  kind: string;
  durationMs: number | null;
  savedAt: string;
}

export interface CloudProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

async function accessToken(): Promise<string | null> {
  if (!supabaseEnabled || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function cloudSignedIn(): Promise<boolean> {
  return (await accessToken()) !== null;
}

/** Upload a rendered export to the user's media library. Throws with a
 * plain-language reason on failure; returns null when signed out. */
export async function uploadExportToCloud(
  blob: Blob,
  name: string,
  projectId: string,
  durationMs: number | null,
): Promise<CloudExport | null> {
  if (!supabaseEnabled || !supabase) return null;
  const token = await accessToken();
  if (!token) return null;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const contentType = blob.type || "video/mp4";
  const begin = await fetch(`${MEDIA_WORKER_URL}/v1/studio/exports`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ byteSize: blob.size, contentType }),
  });
  if (!begin.ok) {
    let detail = "";
    try {
      const body = (await begin.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      // keep the status-based message
    }
    throw new Error(`the media service refused the upload (${begin.status})${detail ? `: ${detail}` : ""}`);
  }
  const grant = (await begin.json()) as {
    objectKey: string;
    putUrl: string;
    downloadUrl: string;
  };
  const put = await fetch(grant.putUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`the file upload failed (${put.status})`);

  const kind = contentType.includes("webm") ? "webm" : "mp4";
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: projectId,
    name,
    object_key: grant.objectKey,
    kind,
    duration_ms: durationMs,
  };
  const { error } = await supabase.from("studio_exports").insert(row);
  if (error) throw new Error(`the export record could not be saved: ${error.message}`);
  return {
    id: row.id,
    name,
    objectKey: grant.objectKey,
    downloadUrl: grant.downloadUrl,
    kind,
    durationMs,
    savedAt: new Date().toISOString(),
  };
}

export async function listCloudExports(): Promise<CloudExport[]> {
  if (!supabaseEnabled || !supabase) return [];
  const { data, error } = await supabase
    .from("studio_exports")
    .select("id,name,object_key,kind,duration_ms,created_at")
    .order("created_at", { ascending: false })
    .limit(12);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    objectKey: r.object_key as string,
    // Fresh download links need a new worker grant; rows listed from
    // the cloud carry no live URL (the upload-time URL lives in the
    // local record). Empty string = no link available right now.
    downloadUrl: "",
    kind: r.kind as string,
    durationMs: (r.duration_ms as number | null) ?? null,
    savedAt: r.created_at as string,
  }));
}

/** Debounced by callers; safe to call on every project change. */
export async function syncProjectToCloud(project: VideoProject): Promise<void> {
  if (!supabaseEnabled || !supabase) return;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  await supabase.from("studio_projects").upsert({
    id: project.id,
    user_id: userId,
    name: project.name,
    data: project,
    updated_at: new Date().toISOString(),
  });
}

export async function listCloudProjects(): Promise<CloudProjectSummary[]> {
  if (!supabaseEnabled || !supabase) return [];
  const { data, error } = await supabase
    .from("studio_projects")
    .select("id,name,updated_at")
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function fetchCloudProject(id: string): Promise<VideoProject | null> {
  if (!supabaseEnabled || !supabase) return null;
  const { data, error } = await supabase
    .from("studio_projects")
    .select("data")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data.data as VideoProject;
}
