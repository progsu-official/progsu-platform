// End-to-end check of /api/team-finder-discord, the write-back leg of the
// hacklanta-ii team-finder sync. Seeds real users in local Supabase and
// asserts: bad secret is refused, an unlinked member gets the handle plus an
// audit row, a member with a linked Discord identity is never overwritten, an
// unknown email is a no-op, a handle that isn't already valid is skipped (not
// mangled), and team_finder_set_discord refuses anon/authenticated callers.
//
// Refuses to run against anything but a local Supabase, since it writes rows.
//
// Usage: start the app (pnpm dev) against local Supabase, then
//   BASE_URL=http://localhost:3000 pnpm tsx scripts/smoke-team-finder-discord.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { strict as assert } from "node:assert";

async function main() {
  const { env, requireServerEnv, requireTeamFinderSyncSecret } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(`refusing to seed a non-local Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  }
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, requireServerEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const secret = requireTeamFinderSyncSecret();

  function post(body: unknown, auth = `Bearer ${secret}`) {
    return fetch(`${baseUrl}/api/team-finder-discord`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    });
  }

  const stamp = Date.now();
  const userIds: string[] = [];
  async function seed(label: string) {
    const email = `tf-discord-${label}-${stamp}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("createUser");
    userIds.push(data.user.id);
    return { id: data.user.id, email };
  }
  async function profile(id: string) {
    const { data } = await admin
      .from("profiles")
      .select("google_email, discord_username, discord_user_id")
      .eq("id", id)
      .single();
    return data!;
  }

  try {
    const unlinked = await seed("unlinked");
    const linked = await seed("linked");
    assert.equal((await profile(unlinked.id)).google_email, unlinked.email, "profile keyed by google_email");
    await admin
      .from("profiles")
      .update({ discord_user_id: "123456789012345678", discord_username: "verified.name" })
      .eq("id", linked.id);

    assert.equal((await post({ email: unlinked.email, discordUsername: "x" }, "Bearer nope")).status, 401);
    console.log("✓ wrong secret refused");

    const res = await post({ email: unlinked.email.toUpperCase(), discordUsername: "  John.Sang " });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, updated: true });
    assert.equal((await profile(unlinked.id)).discord_username, "john.sang");
    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("target_user_id", unlinked.id)
      .eq("action", "team_finder_discord_sync");
    assert.equal(audit?.length, 1);
    console.log("✓ unlinked member gets the normalized handle + audit row");

    const linkedRes = await post({ email: linked.email, discordUsername: "impostor" });
    assert.deepEqual(await linkedRes.json(), { ok: true, updated: false });
    assert.equal((await profile(linked.id)).discord_username, "verified.name");
    console.log("✓ linked Discord identity is never overwritten");

    const unknown = await post({ email: `nobody-${stamp}@example.com`, discordUsername: "ghost" });
    assert.deepEqual(await unknown.json(), { ok: true, updated: false });
    console.log("✓ unknown email is a no-op");

    for (const bad of ["🔥", "John#1234", "cool name", "@john"]) {
      const junk = await post({ email: unlinked.email, discordUsername: bad });
      assert.deepEqual(await junk.json(), { ok: true, updated: false, reason: "invalid_input" });
    }
    assert.equal((await profile(unlinked.id)).discord_username, "john.sang");
    console.log("✓ invalid handles skipped, not mangled, existing value kept");

    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonCall = await anon.rpc("team_finder_set_discord", {
      p_email: unlinked.email,
      p_discord_username: "hijack",
    });
    assert.ok(anonCall.error, "anon must not execute team_finder_set_discord");
    const { data: session } = await anon.auth.signInWithPassword({
      email: unlinked.email,
      password: "testpassword-12345",
    });
    assert.ok(session.session, "seeded user can sign in");
    const authedCall = await anon.rpc("team_finder_set_discord", {
      p_email: unlinked.email,
      p_discord_username: "hijack",
    });
    assert.ok(authedCall.error, "authenticated must not execute team_finder_set_discord");
    assert.equal((await profile(unlinked.id)).discord_username, "john.sang");
    console.log("✓ RPC refused for anon and authenticated callers");

    assert.equal((await post({ email: 5, discordUsername: "a" })).status, 400);
    console.log("✓ malformed body is a 400");
    console.log("\nsmoke-team-finder-discord: all passed");
  } finally {
    for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
