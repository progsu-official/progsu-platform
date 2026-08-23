#!/usr/bin/env tsx
// Manual testbed for the guest → member conversion flow (docs/16-guest-conversion).
//
//   pnpm tsx scripts/guest-flow-testbed.ts up      # publish a throwaway event, print what to click
//   pnpm tsx scripts/guest-flow-testbed.ts reset   # wipe guest rows + staged identities, keep the event
//   pnpm tsx scripts/guest-flow-testbed.ts status  # what the flow has written so far
//   pnpm tsx scripts/guest-flow-testbed.ts down    # remove the event and everything it created
//
// SUPABASE_DB_URL / the service-role key point at production on this project,
// so `up` publishes a REAL event that appears on the public /events list while
// it exists. The title says so in capitals. Run `down` when you are finished.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const SLUG = "zz-test-guest-flow";
const TITLE = "TEST EVENT — guest flow check (ignore)";

type Cmd = "up" | "down" | "reset" | "status";

async function main() {
  const cmd = (process.argv[2] ?? "status") as Cmd;
  if (!["up", "down", "reset", "status"].includes(cmd)) {
    console.error(`unknown command: ${cmd}\nuse: up | reset | status | down`);
    process.exit(1);
  }

  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // NEXT_PUBLIC_SITE_URL points at production on this project, but the point
  // of this script is usually to click through a local dev server. Print the
  // local origin by default; pass --prod for the deployed one.
  const site = process.argv.includes("--prod")
    ? env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
    : "http://localhost:3001"; // matches .claude/launch.json

  async function findEvent() {
    const { data } = await admin
      .from("events")
      .select("id, slug, status, starts_at")
      .eq("slug", SLUG)
      .maybeSingle();
    return data as { id: string; slug: string; status: string; starts_at: string } | null;
  }

  if (cmd === "up") {
    const existing = await findEvent();
    if (existing) {
      console.log(`event already up: ${site}/events/${SLUG}`);
      return printPlaybook(site);
    }

    // An admin id is required for created_by/updated_by. Reuse any existing
    // admin rather than minting a user just to own a test row.
    const { data: adminRow } = await admin
      .from("profiles")
      .select("id")
      .eq("is_admin", true)
      .limit(1)
      .maybeSingle();
    if (!adminRow) throw new Error("no admin profile found to own the event");
    const owner = (adminRow as { id: string }).id;

    const starts = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60_000);
    const { error } = await admin.from("events").insert({
      slug: SLUG,
      title: TITLE,
      description_md:
        "Throwaway event for testing the guest RSVP flow. Not a real event.",
      status: "published",
      visibility: "members",
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      location_text: "Nowhere",
      created_by: owner,
      updated_by: owner,
      published_at: new Date().toISOString(),
      // Off so testing does not fire real mail on every attempt.
      send_rsvp_email: false,
      send_reminder_email: false,
    });
    if (error) throw new Error(`insert event: ${error.message}`);
    console.log(`published ${site}/events/${SLUG}`);
    console.log(
      "(the event row is live in the shared database, so it is on the public" +
        " /events list — on prod too — until you run `down`)\n"
    );
    return printPlaybook(site);
  }

  const ev = await findEvent();

  if (cmd === "status") {
    if (!ev) return console.log("no test event — run `up` first");
    const { data: guests } = await admin
      .from("event_guest_rsvps")
      .select("name, email, status, claim_token")
      .eq("event_id", ev.id);
    const { data: staged } = await admin
      .from("legacy_members")
      .select("personal_email, major, grad_year, class_standing, interested_roles, sms_consent_at, answered_at, claimed_at")
      .eq("source_detail", SLUG);

    console.log(`event: ${site}/events/${SLUG}\n`);
    console.log(`guest RSVPs (${guests?.length ?? 0}):`);
    for (const g of (guests ?? []) as Array<Record<string, unknown>>) {
      console.log(`  ${g.email}  ${g.status}`);
      console.log(`    welcome page: ${site}/welcome/${g.claim_token}`);
    }
    console.log(`\nstaged identities (${staged?.length ?? 0}):`);
    for (const s of (staged ?? []) as Array<Record<string, unknown>>) {
      console.log(
        `  ${s.personal_email}\n` +
          `    major=${s.major ?? "-"} grad=${s.grad_year ?? "-"} standing=${s.class_standing ?? "-"}\n` +
          `    roles=${JSON.stringify(s.interested_roles)} sms=${s.sms_consent_at ? "yes" : "no"}\n` +
          `    answered=${s.answered_at ? "yes" : "no"} claimed=${s.claimed_at ? "yes" : "no"}`
      );
    }
    return;
  }

  if (cmd === "reset") {
    if (!ev) return console.log("no test event — nothing to reset");
    await admin.from("event_guest_rsvps").delete().eq("event_id", ev.id);
    await admin.from("legacy_members").delete().eq("source_detail", SLUG);
    console.log("guest rows and staged identities cleared; event left up");
    return;
  }

  // down
  if (!ev) return console.log("no test event — nothing to remove");
  await admin.from("legacy_members").delete().eq("source_detail", SLUG);
  await admin.from("events").delete().eq("id", ev.id); // cascades guest rows
  console.log("test event and everything it created removed");
}

function printPlaybook(site: string) {
  console.log(`Try these in order at ${site}/events/${SLUG}\n`);
  console.log("  1. NEW GUEST — Register with a school email and a phone that");
  console.log("     are not already on a member profile. Expect: redirect to");
  console.log("     /welcome/<token> showing what is already on file, and one");
  console.log("     button to create the account.\n");
  console.log("  2. THE CLAIM — Press that button. On a local build it skips");
  console.log("     Google and signs in a throwaway account, but runs the real");
  console.log("     claim. Then run `status`: the staged row should read");
  console.log("     claimed=yes, and the .edu should be on the new profile as an");
  console.log("     UNVERIFIED student email with the school filled in.\n");
  console.log("  3. COLLISION — Register again using an email already on a");
  console.log("     member profile. Expect: no redirect. The modal swaps to");
  console.log("     'You're already a member' and no guest row is written.\n");
  console.log("  4. COLLISION BY PHONE — Fresh email, but a phone already on a");
  console.log("     profile, typed in a different format (spaces vs dashes).");
  console.log("     Expect the same sign-in panel.\n");
  console.log("  5. SMS BOX — Tick it on the way through, then run `status`;");
  console.log("     sms should read yes.\n");
  console.log("  run `status` to see what landed, `reset` to go again, `down` when done");
}

main().catch((err) => {
  console.error("guest-flow-testbed failed:", err.message ?? err);
  process.exit(1);
});
