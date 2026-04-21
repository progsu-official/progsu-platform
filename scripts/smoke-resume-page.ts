import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";

async function waitForServer(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 307) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
}

async function makeCookie(email: string, password: string) {
  const { env } = await import("../lib/env");
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    }
  );
  const t = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: unknown;
  };
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const sessionJson = JSON.stringify({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_in: t.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + t.expires_in,
    token_type: t.token_type,
    user: t.user,
  });
  return (
    `sb-${ref}-auth-token=base64-` +
    Buffer.from(sessionJson)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
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

    const { data: aliceCreate } = await admin.auth.admin.createUser({
      email: `alice-resume-page-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!aliceCreate.user) throw new Error("create");
    aliceId = aliceCreate.user.id;

    const cookie = await makeCookie(aliceCreate.user.email!, "testpassword-12345");

    // 1. Unverified user → /onboarding/verify-email redirect.
    const r1 = await fetch("http://localhost:3000/onboarding/resume", {
      redirect: "manual",
      headers: { cookie },
    });
    if (r1.status !== 307 || !r1.headers.get("location")?.includes("verify-email"))
      throw new Error(`r1: ${r1.status} ${r1.headers.get("location")}`);
    console.log(`  ✓ unverified → /onboarding/verify-email`);

    // 2. Verified but no profile → /onboarding/profile redirect.
    await admin
      .from("profiles")
      .update({
        student_email: "alice@student.gsu.edu",
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "admin_manual",
      })
      .eq("id", aliceId);

    const r2 = await fetch("http://localhost:3000/onboarding/resume", {
      redirect: "manual",
      headers: { cookie },
    });
    if (r2.status !== 307 || !r2.headers.get("location")?.includes("/onboarding/profile"))
      throw new Error(`r2: ${r2.status} ${r2.headers.get("location")}`);
    console.log(`  ✓ verified but no profile → /onboarding/profile`);

    // 3. Profile complete → /onboarding/resume renders.
    const y = new Date().getFullYear() + 1;
    await admin
      .from("profiles")
      .update({
        first_name: "Alice",
        last_name: "Example",
        school: "Georgia State University",
        major: "Computer Science",
        class_standing: "junior",
        grad_year: y,
        grad_term: `Fall ${y}`,
        interested_roles: ["software_engineering"],
      })
      .eq("id", aliceId);

    const r3 = await fetch("http://localhost:3000/onboarding/resume", {
      redirect: "manual",
      headers: { cookie },
    });
    if (r3.status !== 200)
      throw new Error(`r3 status=${r3.status} loc=${r3.headers.get("location")}`);
    const body = await r3.text();
    if (!body.includes("Upload your resume"))
      throw new Error(`no heading in body`);
    if (!body.includes("remove your SSN"))
      throw new Error(`PII tip missing`);
    console.log(`  ✓ profile complete → resume page renders with PII tip`);

    console.log("✓ resume page smoke OK");
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
