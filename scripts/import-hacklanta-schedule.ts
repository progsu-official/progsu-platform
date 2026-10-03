// Idempotently loads data/hacklanta-ii-schedule.json into the Hacklanta guide
// tables: upserts edition `hacklanta-ii` and its sessions by `key`; sessions
// that are no longer in the file are marked cancelled, never deleted (a
// member may have bookmarked them). Leaves the edition unpublished unless run
// with --publish.
//
// Usage:
//   pnpm tsx scripts/import-hacklanta-schedule.ts [--publish] [--file path]
// Refuses any non-local Supabase URL unless --remote is passed.

import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env.local" });

const fileSchema = z.object({
  edition: z.literal("hacklanta-ii"),
  timeZone: z.string(),
  tentative: z.boolean(),
  sessions: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        title: z.string().min(1).max(200),
        kind: z.string().regex(/^[a-z_]{1,32}$/),
        room: z.string().max(120).nullable(),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }).nullable(),
        description: z.string().max(4000).nullable(),
        pointsNote: z.string().max(200).optional(),
      })
    )
    .min(1),
});

const EDITION = {
  slug: "hacklanta-ii",
  name: "Hacklanta II",
  starts_at: "2026-10-09T15:00:00-04:00",
  ends_at: "2026-10-11T13:45:00-04:00",
  time_zone: "America/New_York",
  venue_name: "Georgia State University Student Center",
  venue_address: "Atlanta, GA",
  // Coordinates deliberately left null until verified.
  lat: null,
  lng: null,
};

export async function importHacklantaSchedule(opts: { publish: boolean; file: string }) {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, requireServerEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const parsed = fileSchema.parse(JSON.parse(readFileSync(opts.file, "utf8")));
  const keys = new Set<string>();
  for (const s of parsed.sessions) {
    if (keys.has(s.key)) throw new Error(`duplicate session key ${s.key}`);
    keys.add(s.key);
    if (s.end && Date.parse(s.end) <= Date.parse(s.start)) throw new Error(`session ${s.key} ends before it starts`);
  }

  const { data: existing } = await admin
    .from("hacklanta_editions")
    .select("id, published_at")
    .eq("slug", EDITION.slug)
    .maybeSingle();

  const editionPatch: Record<string, unknown> = {
    ...EDITION,
    time_zone: parsed.timeZone,
    schedule_tentative: parsed.tentative,
  };
  if (opts.publish && !existing?.published_at) editionPatch.published_at = new Date().toISOString();

  const { data: edition, error: edErr } = await admin
    .from("hacklanta_editions")
    .upsert(editionPatch, { onConflict: "slug" })
    .select("id, published_at")
    .single();
  if (edErr || !edition) throw new Error(`edition upsert: ${edErr?.message}`);

  const rows = parsed.sessions.map((s) => ({
    edition_id: edition.id,
    key: s.key,
    title: s.title,
    kind: s.kind,
    room_label: s.room,
    starts_at: new Date(s.start).toISOString(),
    ends_at: s.end ? new Date(s.end).toISOString() : null,
    description: s.description,
    points_note: s.pointsNote ?? null,
    status: "scheduled",
  }));
  const { error: sErr } = await admin.from("hacklanta_sessions").upsert(rows, { onConflict: "edition_id,key" });
  if (sErr) throw new Error(`sessions upsert: ${sErr.message}`);

  const { data: all, error: allErr } = await admin
    .from("hacklanta_sessions")
    .select("id, key, status")
    .eq("edition_id", edition.id);
  if (allErr) throw new Error(`sessions read: ${allErr.message}`);
  const stale = (all ?? []).filter((r) => !keys.has(String(r.key)) && r.status !== "cancelled");
  if (stale.length > 0) {
    const { error } = await admin
      .from("hacklanta_sessions")
      .update({ status: "cancelled" })
      .in("id", stale.map((r) => r.id));
    if (error) throw new Error(`cancel stale: ${error.message}`);
  }

  return {
    editionId: String(edition.id),
    published: Boolean(edition.published_at),
    upserted: rows.length,
    cancelled: stale.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes("--publish");
  const fileIdx = args.indexOf("--file");
  const file = fileIdx >= 0 ? args[fileIdx + 1] : "data/hacklanta-ii-schedule.json";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url) && !args.includes("--remote")) {
    console.error(`refusing to write to non-local ${url}; pass --remote if you mean it`);
    process.exit(1);
  }
  const result = await importHacklantaSchedule({ publish, file });
  console.log("[import-hacklanta-schedule]", JSON.stringify(result));
}

if (process.argv[1]?.includes("import-hacklanta-schedule")) {
  main().catch((e) => {
    console.error("[import-hacklanta-schedule] failed:", e);
    process.exit(1);
  });
}
