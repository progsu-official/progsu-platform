// Asserts the actual rendered UI, not just the DB: seeds an unclaimed
// legacy_members row, creates an auth user with that same email (firing
// handle_new_user()'s claim-backfill), mints a real session for that user,
// and checks /onboarding/profile actually shows the "Welcome back" banner.
// Lives on the profile page, not verify-email, because profile is the
// guaranteed first page after OAuth — verify-email is optional and easily
// skipped. smoke-legacy-claim-backfill.ts already covers the DB side of this
// (phone_number backfilled, claimed_at set) — this covers the part a person
// actually sees.
//
// Requires a dev server already running (this repo's other Playwright smoke
// tests assume the same). Point NEXT_PUBLIC_SUPABASE_URL/keys and
// NEXT_PUBLIC_SITE_URL at whatever project the server is serving from.
//
// Usage: pnpm tsx scripts/smoke-legacy-claim-banner.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { chromium } from "@playwright/test";

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const email = `smoke-banner-${Date.now()}@example.com`;
  const password = "smoke-banner-password-12345";
  let userId: string | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const { error: seedErr } = await admin.from("legacy_members").insert({
      full_name: "Smoke Banner",
      first_name: "Smoke",
      last_name: "Banner",
      personal_email: email,
      phone_number: "+14045558888",
      sms_interest: true,
      source: "smoke_test",
    });
    if (seedErr) throw new Error(`seed legacy_members: ${seedErr.message}`);
    console.log("  ✓ seeded unclaimed legacy_members row");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { given_name: "Smoke", family_name: "Banner" },
    });
    if (createErr || !created.user) throw new Error(`create user: ${createErr?.message}`);
    userId = created.user.id;
    console.log("  ✓ created auth user, first-login trigger should have fired");

    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);

    browser = await chromium.launch();
    const context = await browser.newContext();
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    const cookieValue =
      "base64-" +
      Buffer.from(
        JSON.stringify({
          access_token: signIn.session.access_token,
          refresh_token: signIn.session.refresh_token,
          expires_in: signIn.session.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + signIn.session.expires_in,
          token_type: signIn.session.token_type,
          user: signIn.session.user,
        })
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const siteUrl = new URL(env.NEXT_PUBLIC_SITE_URL);
    await context.addCookies([
      {
        name: `sb-${ref}-auth-token`,
        value: cookieValue,
        domain: siteUrl.hostname,
        path: "/",
      },
    ]);

    const page = await context.newPage();
    await page.goto(`${env.NEXT_PUBLIC_SITE_URL}/onboarding/profile`);
    const banner = page.getByText("Welcome back! We found your info");
    await banner.waitFor({ state: "visible", timeout: 8000 });
    console.log('  ✓ "Welcome back" banner rendered on /onboarding/profile');

    await browser.close();
    browser = null;

    const { data: legacy } = await admin
      .from("legacy_members")
      .select("claimed_at, claimed_profile_id")
      .eq("personal_email", email)
      .single();
    if (!legacy?.claimed_at || legacy.claimed_profile_id !== userId)
      throw new Error("legacy row not correctly claimed by the time the banner rendered");
    console.log("  ✓ legacy_members row claimed and linked, consistent with the banner");

    console.log("✓ legacy-claim-banner smoke OK");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from("legacy_members").delete().eq("personal_email", email);
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
