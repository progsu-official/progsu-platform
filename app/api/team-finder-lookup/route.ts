import { NextResponse, type NextRequest } from "next/server";

import { requireTeamFinderSyncSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

// Server-to-server lookup for hacklanta-ii's team-finder: given a batch of
// applicant emails, report which ones belong to an existing Progsu member and
// hand back the profile fields team-finder mirrors (avatar, bio, discord,
// links) so a member's Progsu profile is the single source of truth for
// those once linked. Auth is the same shared-bearer pattern as the cron
// routes (see event-notifications/route.ts for the constant-time compare this
// copies); there is no per-user session, only a service calling in.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EMAILS = 500;

function authed(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  let expected: string;
  try {
    expected = `Bearer ${requireTeamFinderSyncSecret()}`;
  } catch {
    return false;
  }
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i += 1) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

type LookupBody = { emails?: unknown };

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: LookupBody;
  try {
    body = (await req.json()) as LookupBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.emails) || !body.emails.every((e) => typeof e === "string")) {
    return NextResponse.json({ ok: false, error: "emails must be a string array" }, { status: 400 });
  }
  const emails = [...new Set(body.emails.map((e) => e.trim().toLowerCase()))].filter(Boolean);
  if (emails.length === 0) {
    return NextResponse.json({ ok: true, matches: {} });
  }
  if (emails.length > MAX_EMAILS) {
    return NextResponse.json({ ok: false, error: `emails exceeds ${MAX_EMAILS}` }, { status: 400 });
  }

  try {
    const columns = "id, google_email, student_email, avatar_url, bio, discord_username, linkedin_url, github_url";
    const admin = createAdminClient();
    const [byGoogle, byStudent] = await Promise.all([
      admin.from("profiles").select(columns).in("google_email", emails),
      admin.from("profiles").select(columns).in("student_email", emails),
    ]);
    if (byGoogle.error || byStudent.error) {
      throw byGoogle.error ?? byStudent.error;
    }
    const rows = [...(byGoogle.data ?? []), ...(byStudent.data ?? [])];

    // profile_slug only resolves to a real public URL when the member has
    // also opted into discoverability — a matched member with no slug (or
    // discoverable off) just doesn't get a link, same as a non-member.
    const ids = [...new Set(rows.map((row) => row.id))];
    const { data: visibility, error: visibilityError } = await admin
      .from("profile_visibility_settings")
      .select("user_id, profile_slug, discoverable")
      .in("user_id", ids);
    if (visibilityError) throw visibilityError;
    const slugById = new Map(
      (visibility ?? [])
        .filter((v) => v.discoverable && v.profile_slug)
        .map((v) => [v.user_id, v.profile_slug as string]),
    );

    const matches: Record<
      string,
      {
        avatarUrl: string | null;
        bio: string | null;
        discordUsername: string | null;
        linkedinUrl: string | null;
        githubUrl: string | null;
        profileSlug: string | null;
      }
    > = {};
    for (const row of rows) {
      const match = {
        avatarUrl: row.avatar_url ?? null,
        bio: row.bio ?? null,
        discordUsername: row.discord_username ?? null,
        linkedinUrl: row.linkedin_url ?? null,
        githubUrl: row.github_url ?? null,
        profileSlug: slugById.get(row.id) ?? null,
      };
      if (row.google_email) matches[row.google_email.toLowerCase()] = match;
      if (row.student_email) matches[row.student_email.toLowerCase()] = match;
    }
    return NextResponse.json({ ok: true, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("team-finder-lookup failed", {
      action: "team_finder_lookup",
      error_message: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
