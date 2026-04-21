import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";

async function waitForServer(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 307) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
}

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  let proc: ChildProcess | null = null;
  let aliceId: string | null = null;

  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    // 1. Unauthenticated visit → 307 → /login
    const noSession = await fetch("http://localhost:3000/onboarding/verify-email", {
      redirect: "manual",
    });
    if (noSession.status !== 307)
      throw new Error(`expected 307 got ${noSession.status}`);
    if (!noSession.headers.get("location")?.includes("/login"))
      throw new Error(`expected /login redirect, got ${noSession.headers.get("location")}`);
    console.log(`  ✓ no session → 307 /login`);

    // 2. Signed-in fresh user — page renders with "Verify your student email" heading.
    const { data: aliceCreate } = await admin.auth.admin.createUser({
      email: `alice-page-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Alice" },
    });
    if (!aliceCreate.user) throw new Error("create user");
    aliceId = aliceCreate.user.id;

    const signinRes = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: aliceCreate.user.email,
          password: "testpassword-12345",
        }),
      }
    );
    const tokens = (await signinRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: unknown;
    };
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    const sessionJson = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      token_type: tokens.token_type,
      user: tokens.user,
    });
    const base64url = Buffer.from(sessionJson)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const cookie = `sb-${ref}-auth-token=base64-${base64url}`;

    const authed = await fetch("http://localhost:3000/onboarding/verify-email", {
      redirect: "manual",
      headers: { cookie },
    });
    if (authed.status !== 200)
      throw new Error(`expected 200 got ${authed.status} (location=${authed.headers.get("location")})`);
    const body = await authed.text();
    if (!body.includes("Verify your student email"))
      throw new Error(`missing page heading`);
    if (!body.includes("you@student.gsu.edu"))
      throw new Error(`missing placeholder hint`);
    console.log(`  ✓ signed-in fresh user renders verify-email page`);

    // 3. Already-verified user → redirected off verify-email to profile step.
    await admin
      .from("profiles")
      .update({
        student_email: "alice@student.gsu.edu",
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "admin_manual",
      })
      .eq("id", aliceId);

    const past = await fetch("http://localhost:3000/onboarding/verify-email", {
      redirect: "manual",
      headers: { cookie },
    });
    if (past.status !== 307)
      throw new Error(`expected 307 got ${past.status}`);
    const loc = past.headers.get("location") ?? "";
    if (!loc.includes("/onboarding/profile"))
      throw new Error(`expected /onboarding/profile redirect, got ${loc}`);
    console.log(`  ✓ already-verified user redirected to /onboarding/profile`);

    // 4. Admin user visiting onboarding → redirected to /admin.
    await admin.from("profiles").update({ is_admin: true }).eq("id", aliceId);

    const adminRedir = await fetch("http://localhost:3000/onboarding/verify-email", {
      redirect: "manual",
      headers: { cookie },
    });
    if (adminRedir.status !== 307)
      throw new Error(`admin expected 307 got ${adminRedir.status}`);
    if (adminRedir.headers.get("location") !== "/admin")
      throw new Error(`admin redirect: ${adminRedir.headers.get("location")}`);
    console.log(`  ✓ admin bypass onboarding → /admin`);

    console.log("✓ verify-email page smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (aliceId) await admin.auth.admin.deleteUser(aliceId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
