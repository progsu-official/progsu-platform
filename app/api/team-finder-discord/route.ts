import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { teamFinderSyncAuthed } from "@/lib/team-finder-sync-auth";

// Write-back leg of the team-finder sync: when a hacklanta-ii applicant sets
// their Discord there, mirror it onto their Progsu profile. hacklanta-ii only
// sends the applicant's signed-in Google email (never an email they typed on
// the form). Matching, the linked-identity guard, and the audit row all live
// in team_finder_set_discord (20260929180000) so they commit together.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same rule as the profiles.discord_username check constraint. Rejected, not
// sanitized: "John#1234" -> "john1234" would put a handle on someone's
// member card that isn't actually theirs.
const DISCORD_PATTERN = /^[a-z0-9._]{2,32}$/;

type Body = { email?: unknown; discordUsername?: unknown };

export async function POST(req: NextRequest) {
  if (!teamFinderSyncAuthed(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.discordUsername !== "string") {
    return NextResponse.json(
      { ok: false, error: "email and discordUsername must be strings" },
      { status: 400 }
    );
  }
  const email = body.email.trim().toLowerCase();
  const discordUsername = body.discordUsername.trim().toLowerCase();
  if (!email || !DISCORD_PATTERN.test(discordUsername)) {
    return NextResponse.json({ ok: true, updated: false, reason: "invalid_input" });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("team_finder_set_discord", {
      p_email: email,
      p_discord_username: discordUsername,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, updated: data !== null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("team-finder-discord failed", {
      action: "team_finder_discord",
      error_message: message,
    });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
