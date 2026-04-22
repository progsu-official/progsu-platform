import type { SupabaseClient } from "@supabase/supabase-js";

// Shared helper for resolving event cover URLs. The event-covers bucket is
// private, so we mint a short-lived signed URL per render. 10 minutes is
// more than enough for a session and keeps exposure tight.
//
// Accepts any Supabase client — user-context (RLS-gated via can_view_event)
// or service-role (admin surfaces). Returns null on error or missing path
// so callers can render a graceful fallback without defensive try/catch.

const BUCKET = "event-covers";
const TTL_SECONDS = 10 * 60;

export async function resolveCoverUrl(
  supabase: SupabaseClient,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Batch variant for list pages. Runs signs in parallel — Supabase storage
// handles each independently and the total latency is bounded by the slowest
// one, not the sum. Preserves order and returns null for missing paths.
export async function resolveCoverUrls(
  supabase: SupabaseClient,
  paths: Array<string | null>
): Promise<Array<string | null>> {
  return Promise.all(paths.map((p) => resolveCoverUrl(supabase, p)));
}
