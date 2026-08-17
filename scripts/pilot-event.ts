#!/usr/bin/env tsx
// Pilot event tool. Subcommands for the Phase B rollout walkthrough per
// docs/09-events-platform-plan.md §14.2:
//
//   pnpm tsx scripts/pilot-event.ts create    # seeds a draft pilot event
//   pnpm tsx scripts/pilot-event.ts publish   # publishes + enqueues reminders
//   pnpm tsx scripts/pilot-event.ts status    # prints roster, RSVPs, attendance, pending jobs
//   pnpm tsx scripts/pilot-event.ts cancel    # cancels w/ reason + fans out emails
//   pnpm tsx scripts/pilot-event.ts archive   # archives a cancelled/completed pilot
//
// REST service-role client throughout. Designed to be run against
// production — prints every side effect and asks before anything
// destructive.
//
// Picks up the most recent event whose slug starts with `pilot-` unless you
// pass --id <uuid> or --slug <slug>.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

type Cmd = "create" | "publish" | "status" | "cancel" | "archive" | "help";

const HELP = `Pilot event tool.

Usage:
  pnpm tsx scripts/pilot-event.ts <cmd> [flags]

Commands:
  create                 Create a new draft pilot event (interactive).
  publish [--id X]       Publish + enqueue reminders. Check-in QR is generated
                          automatically per-attendee on RSVP, nothing to set up.
  status [--id X]        Show current pilot event state (roster, jobs).
  cancel [--id X]        Cancel with a reason. Fans out cancellation emails.
  archive [--id X]       Archive a cancelled or past pilot.
  help                   Show this message.

Flags:
  --id <uuid>            Target a specific event. Default: latest slug^=pilot-.
  --slug <slug>          Target by slug. Ignored if --id present.
  --yes                  Skip confirmation prompts.

Safety:
  All write operations require an explicit confirmation unless --yes is passed.
  Runs print what they're about to do before doing it.`;

function parseArgs() {
  const argv = process.argv.slice(2);
  const cmd = (argv[0] ?? "help") as Cmd;
  const flags: Record<string, string | true> = {};
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { cmd, flags };
}

async function confirm(message: string, skip: boolean): Promise<boolean> {
  if (skip) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message} `);
  rl.close();
  return answer.trim();
}

function toIso(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Bad datetime: ${local}`);
  }
  return d.toISOString();
}

async function main() {
  const { cmd, flags } = parseArgs();
  if (cmd === "help") {
    console.log(HELP);
    return;
  }

  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const skip = flags.yes === true;

  async function findEvent(): Promise<{ id: string; slug: string; title: string; status: string } | null> {
    if (flags.id && typeof flags.id === "string") {
      const { data } = await admin
        .from("events")
        .select("id, slug, title, status")
        .eq("id", flags.id)
        .maybeSingle();
      return data as never;
    }
    if (flags.slug && typeof flags.slug === "string") {
      const { data } = await admin
        .from("events")
        .select("id, slug, title, status")
        .eq("slug", flags.slug)
        .maybeSingle();
      return data as never;
    }
    const { data } = await admin
      .from("events")
      .select("id, slug, title, status")
      .like("slug", "pilot-%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as never;
  }

  async function findAdmin(): Promise<string> {
    // First admin user in the DB — used as created_by when the RPC requires a
    // valid auth.uid() context. We can't call create_event() directly from
    // service-role (the RPC checks auth.uid()), so we do a direct insert as
    // service role, which bypasses RLS.
    const { data } = await admin
      .from("profiles")
      .select("id, first_name")
      .eq("is_admin", true)
      .limit(1)
      .maybeSingle();
    if (!data) throw new Error("No admin profile found. Seed one first.");
    return (data as { id: string }).id;
  }

  if (cmd === "create") {
    console.log("Creating a new pilot event. Hit enter for defaults.");
    const title =
      (await prompt("Title [Progsu Pilot Event]:")) || "Progsu Pilot Event";
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setHours(18, 0, 0, 0);
    const twoHoursLater = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);
    const defaultSlug = `pilot-${new Date().toISOString().slice(0, 10)}`;
    const slug = (await prompt(`Slug [${defaultSlug}]:`)) || defaultSlug;
    const startsRaw =
      (await prompt(`Starts at (local, e.g. ${tomorrow.toISOString().slice(0, 16)}):`)) ||
      tomorrow.toISOString();
    const endsRaw =
      (await prompt(`Ends at (local, e.g. ${twoHoursLater.toISOString().slice(0, 16)}):`)) ||
      twoHoursLater.toISOString();
    const location =
      (await prompt("Location text [Discord huddle]:")) || "Discord huddle";
    const capacityRaw =
      (await prompt("Capacity (blank = unlimited):")) || "";
    const capacity = capacityRaw ? Number.parseInt(capacityRaw, 10) : null;

    const adminId = await findAdmin();
    const ok = await confirm(
      `Create draft event "${title}" (${slug}) starting ${startsRaw}?`,
      skip
    );
    if (!ok) return;

    const eventId = randomUUID();
    const { error } = await admin.from("events").insert({
      id: eventId,
      slug,
      title,
      status: "draft",
      visibility: "members",
      starts_at: toIso(startsRaw),
      ends_at: toIso(endsRaw),
      location_text: location,
      capacity,
      waitlist_enabled: capacity !== null,
      send_rsvp_email: true,
      send_reminder_email: true,
      created_by: adminId,
      updated_by: adminId,
    });
    if (error) throw new Error(`insert events: ${error.message}`);

    await admin.rpc("write_audit", {
      p_action: "event.create",
      p_actor: adminId,
      p_target: null,
      p_metadata: { event_id: eventId, slug, via: "pilot-event.ts" },
    });

    console.log(`\n✓ Draft created.`);
    console.log(`   id:   ${eventId}`);
    console.log(`   slug: ${slug}`);
    console.log(`   URL:  ${env.NEXT_PUBLIC_SITE_URL}/admin/events/${eventId}`);
    console.log(`\nNext:`);
    console.log(
      `   pnpm tsx scripts/pilot-event.ts publish --id ${eventId}`
    );
    return;
  }

  const target = await findEvent();
  if (!target) {
    console.error(
      "No pilot event found. Run `create` first, or pass --id/--slug."
    );
    process.exit(1);
  }

  if (cmd === "status") {
    const { data: event } = await admin
      .from("events")
      .select(
        "id, slug, title, status, visibility, starts_at, ends_at, capacity, waitlist_enabled, reminder_sent_at, cancelled_at, cancellation_reason, send_reminder_email, send_rsvp_email"
      )
      .eq("id", target.id)
      .single();

    const [{ count: goingCount }, { count: waitlistCount }, { count: declinedCount }] =
      await Promise.all([
        admin
          .from("event_rsvps")
          .select("*", { count: "exact", head: true })
          .eq("event_id", target.id)
          .eq("status", "going"),
        admin
          .from("event_rsvps")
          .select("*", { count: "exact", head: true })
          .eq("event_id", target.id)
          .eq("status", "waitlisted"),
        admin
          .from("event_rsvps")
          .select("*", { count: "exact", head: true })
          .eq("event_id", target.id)
          .in("status", ["declined", "cancelled"]),
      ]);

    const { count: attendedCount } = await admin
      .from("event_attendances")
      .select("*", { count: "exact", head: true })
      .eq("event_id", target.id);

    const { data: jobs } = await admin
      .from("event_notification_jobs")
      .select("kind, status")
      .eq("event_id", target.id);

    const jobSummary = (jobs ?? []).reduce<Record<string, number>>((acc, j) => {
      const key = `${j.kind}:${j.status}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`\n${event?.title} (${event?.slug})`);
    console.log(`   id:         ${event?.id}`);
    console.log(`   status:     ${event?.status}`);
    console.log(`   visibility: ${event?.visibility}`);
    console.log(`   when:       ${event?.starts_at} → ${event?.ends_at}`);
    console.log(`   capacity:   ${event?.capacity ?? "unlimited"}`);
    if (event?.reminder_sent_at) {
      console.log(`   reminder:   SENT at ${event.reminder_sent_at}`);
    } else {
      console.log(`   reminder:   not yet sent`);
    }
    if (event?.cancelled_at) {
      console.log(`   cancelled:  ${event.cancelled_at}`);
      console.log(`   reason:     ${event.cancellation_reason}`);
    }

    console.log(`\nRoster:`);
    console.log(`   going:        ${goingCount ?? 0}`);
    console.log(`   waitlisted:   ${waitlistCount ?? 0}`);
    console.log(`   declined/cxl: ${declinedCount ?? 0}`);
    console.log(`   attended:     ${attendedCount ?? 0}`);

    console.log(`\nNotification jobs:`);
    if (Object.keys(jobSummary).length === 0) {
      console.log(`   (none)`);
    } else {
      for (const [k, v] of Object.entries(jobSummary)) {
        console.log(`   ${k}: ${v}`);
      }
    }
    return;
  }

  if (cmd === "publish") {
    if (target.status !== "draft") {
      console.error(`Cannot publish: event is ${target.status}.`);
      process.exit(1);
    }

    const ok = await confirm(`Publish "${target.title}"?`, skip);
    if (!ok) return;

    const adminId = await findAdmin();

    const { error: updErr } = await admin
      .from("events")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        updated_by: adminId,
      })
      .eq("id", target.id);
    if (updErr) throw new Error(`publish: ${updErr.message}`);

    await admin.rpc("write_audit", {
      p_action: "event.publish",
      p_actor: adminId,
      p_target: null,
      p_metadata: { event_id: target.id, via: "pilot-event.ts" },
    });

    console.log(`\n✓ Published.`);
    console.log(
      `   Each attendee's check-in QR generates automatically the moment they RSVP going, nothing to set up here.`
    );
    console.log(
      `   event URL:     ${env.NEXT_PUBLIC_SITE_URL}/events/${target.slug}`
    );
    console.log(
      `   admin URL:     ${env.NEXT_PUBLIC_SITE_URL}/admin/events/${target.id}`
    );
    console.log(
      `\nReminders will enqueue via cron when starts_at is 20–30h out.`
    );
    console.log(`Run 'status' anytime to check RSVPs and attendance.`);
    return;
  }

  if (cmd === "cancel") {
    if (target.status === "cancelled") {
      console.log(`Already cancelled.`);
      return;
    }
    if (target.status === "archived") {
      console.error(`Cannot cancel an archived event.`);
      process.exit(1);
    }
    const reason = await prompt("Cancellation reason (shown to members):");
    if (!reason) {
      console.error("Reason is required.");
      process.exit(1);
    }
    const ok = await confirm(
      `Cancel "${target.title}"? Members with going/waitlisted/attended will get an email.`,
      skip
    );
    if (!ok) return;

    const adminId = await findAdmin();
    const { error } = await admin
      .from("events")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        updated_by: adminId,
      })
      .eq("id", target.id);
    if (error) throw new Error(`cancel: ${error.message}`);

    await admin.rpc("write_audit", {
      p_action: "event.cancel",
      p_actor: adminId,
      p_target: null,
      p_metadata: { event_id: target.id, reason, via: "pilot-event.ts" },
    });

    // Enqueue cancellation fan-out. Mirrors enqueueEventCancellation in
    // lib/email/events.ts (which can't be imported here — it has
    // "server-only"). Union going/waitlisted RSVPs with event_attendances,
    // dedupe by user_id, enqueue one cancellation job each.
    const [{ data: rsvpRows }, { data: attendRows }] = await Promise.all([
      admin
        .from("event_rsvps")
        .select("user_id")
        .eq("event_id", target.id)
        .in("status", ["going", "waitlisted"]),
      admin
        .from("event_attendances")
        .select("user_id")
        .eq("event_id", target.id),
    ]);
    const userIds = new Set<string>();
    for (const r of (rsvpRows ?? []) as Array<{ user_id: string }>) {
      userIds.add(r.user_id);
    }
    for (const r of (attendRows ?? []) as Array<{ user_id: string }>) {
      userIds.add(r.user_id);
    }
    const nowIso = new Date().toISOString();
    let enqueued = 0;
    for (const userId of userIds) {
      const { error: enqErr } = await admin.rpc("enqueue_event_notification", {
        p_event_id: target.id,
        p_kind: "cancellation",
        p_user_id: userId,
        p_scheduled_for: nowIso,
        p_dedupe_key: `cancellation:${target.id}:${userId}`,
      });
      if (!enqErr) enqueued += 1;
    }
    console.log(`\n✓ Cancelled. ${enqueued} cancellation jobs enqueued.`);
    console.log(
      `   The cron worker will drain them within ~5 min (or run the worker route manually).`
    );
    return;
  }

  if (cmd === "archive") {
    if (target.status === "archived") {
      console.log(`Already archived.`);
      return;
    }
    if (target.status === "draft") {
      console.error(`Draft events can't be archived — delete instead.`);
      process.exit(1);
    }
    const ok = await confirm(`Archive "${target.title}"?`, skip);
    if (!ok) return;

    const adminId = await findAdmin();
    const { error } = await admin
      .from("events")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        updated_by: adminId,
      })
      .eq("id", target.id);
    if (error) throw new Error(`archive: ${error.message}`);

    await admin.rpc("write_audit", {
      p_action: "event.archive",
      p_actor: adminId,
      p_target: null,
      p_metadata: { event_id: target.id, via: "pilot-event.ts" },
    });
    console.log(`\n✓ Archived.`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error("[pilot-event] FAILED:", err);
  process.exit(1);
});
