#!/usr/bin/env tsx
// Manual testbed for the guest → member conversion flow (docs/16-guest-conversion).
//
//   pnpm tsx scripts/guest-flow-testbed.ts up        # publish a throwaway event, print what to click
//   pnpm tsx scripts/guest-flow-testbed.ts identity  # a fresh name/email/phone guaranteed not to collide
//   pnpm tsx scripts/guest-flow-testbed.ts check ... # explain exactly why an email or phone was rejected
//   pnpm tsx scripts/guest-flow-testbed.ts status    # what the flow has written so far
//   pnpm tsx scripts/guest-flow-testbed.ts reset     # wipe everything the flow created, keep the event
//   pnpm tsx scripts/guest-flow-testbed.ts down      # remove the event and everything it created
//
// `identity` exists because the collision check matches email OR normalized
// phone, and 157 of 203 profiles carry a matchable phone. Reusing your own
// number blocks every attempt no matter how many fresh emails you try, which
// reads as "it is broken" rather than "it is working".
//
// SUPABASE_DB_URL / the service-role key point at production on this project,
// so `up` publishes a REAL event that appears on the public /events list while
// it exists. The title says so in capitals. Run `down` when you are finished.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const SLUG = "zz-test-guest-flow";
const TITLE = "TEST EVENT — guest flow check (ignore)";

type Cmd = "up" | "down" | "reset" | "status" | "identity" | "check";

async function main() {
  const cmd = (process.argv[2] ?? "status") as Cmd;
  if (!["up", "down", "reset", "status", "identity", "check"].includes(cmd)) {
    console.error(
      `unknown command: ${cmd}\nuse: up | identity | check | status | reset | down`
    );
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

  // A name/email/phone triple verified against the same three columns
  // guest_rsvp_to_event checks, so it cannot bounce. 555-01xx is the reserved
  // fictional range, so these can never reach a real person if something ever
  // does try to text them.
  if (cmd === "identity") {
    const stamp = Date.now().toString(36);
    const email = `test-${stamp}@student.gsu.edu`;

    let phone: string | null = null;
    for (let n = 0; n < 100; n += 1) {
      const candidate = `+1678555${String(100 + n).padStart(4, "0")}`;
      const { data: hit } = await admin
        .from("profiles")
        .select("id")
        .eq("phone_e164", candidate)
        .maybeSingle();
      if (!hit) {
        phone = candidate;
        break;
      }
    }
    if (!phone) throw new Error("no free number in the 555-01xx range");

    const pretty = `(678) 555-${phone.slice(-4)}`;
    console.log("Paste these into the RSVP form — none of them collide:\n");
    console.log(`  Full name     Test Student`);
    console.log(`  School email  ${email}`);
    console.log(`  Phone         ${pretty}`);
    console.log(`\nRun \`identity\` again for another set. \`reset\` clears them all.`);
    return;
  }

  // Answers "why was this rejected?" against the real check, so a failure in
  // the UI stops being a guessing game.
  if (cmd === "check") {
    const value = process.argv[3];
    if (!value) {
      console.error("usage: check <email-or-phone>");
      process.exit(1);
    }
    const isEmail = value.includes("@");
    if (isEmail) {
      const { data } = await admin
        .from("profiles")
        .select("id, google_email, student_email")
        .or(`google_email.eq.${value},student_email.eq.${value}`)
        .maybeSingle();
      console.log(
        data
          ? `BLOCKED — that email is on profile ${(data as { id: string }).id}`
          : "clear — no profile has that email"
      );
      return;
    }
    const { data: norm } = await admin.rpc("normalize_phone_e164", {
      p_phone: value,
    });
    if (!norm) {
      console.log(
        "clear — that phone does not normalize to a US number, so it can never match"
      );
      return;
    }
    const { data: hit } = await admin
      .from("profiles")
      .select("id")
      .eq("phone_e164", norm as string)
      .maybeSingle();
    console.log(
      hit
        ? `BLOCKED — ${norm} is on profile ${(hit as { id: string }).id}. This is the usual culprit: a fresh email will not help.`
        : `clear — ${norm} is on no profile`
    );
    return;
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
      console.log(`    welcome page: ${site}/joined/${g.claim_token}`);
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
    await deleteDevAccounts(admin);
    console.log(
      "cleared: guest rows, staged identities, and the dev-login test accounts"
    );
    return;
  }

  // down
  if (!ev) return console.log("no test event — nothing to remove");
  await admin.from("legacy_members").delete().eq("source_detail", SLUG);
  await admin.from("events").delete().eq("id", ev.id); // cascades guest rows
  await deleteDevAccounts(admin);
  console.log("test event and everything it created removed");
}

// The dev bypass signs in fixed throwaway accounts. Left behind they are
// harmless but they are still rows in a real members table, and a stale one
// can collide with the next run's email.
async function deleteDevAccounts(admin: {
  auth: { admin: { listUsers: (a: { perPage: number }) => Promise<{ data: { users: Array<{ id: string; email?: string }> } }>; deleteUser: (id: string) => Promise<unknown> } };
}) {
  const DEV_EMAILS = [
    "dev-onboarding@example.com",
    "dev-member@example.com",
    "dev-admin@example.com",
  ];
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users) {
    if (u.email && DEV_EMAILS.includes(u.email)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

function printPlaybook(site: string) {
  console.log(`Try these in order at ${site}/events/${SLUG}\n`);
  console.log("  1. NEW GUEST — Register with a school email and a phone that");
  console.log("     are not already on a member profile. Expect: redirect to");
  console.log("     /joined/<token> showing what is already on file, and one");
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
