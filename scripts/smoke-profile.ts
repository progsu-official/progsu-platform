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
  let userId: string | null = null;
  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    // Seed a fully-onboarded user.
    const { data: created } = await admin.auth.admin.createUser({
      email: `dash-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Dashy" },
    });
    if (!created.user) throw new Error("create");
    userId = created.user.id;

    const y = new Date().getFullYear() + 1;
    await admin
      .from("profiles")
      .update({
        student_email: `dash-${Date.now()}@student.gsu.edu`,
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "admin_manual",
        first_name: "Dashy",
        last_name: "Tester",
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: y,
        grad_term: `Fall ${y}`,
        interested_roles: ["software_engineering"],
      })
      .eq("id", userId);

    // Insert a current resume.
    const resumeId = crypto.randomUUID();
    await admin.from("resumes").insert({
      id: resumeId,
      user_id: userId,
      storage_path: `${userId}/${resumeId}.pdf`,
      file_name: "resume.pdf",
      file_size: 1000,
      mime_type: "application/pdf",
      status: "active",
      is_current: true,
    });
    // Insert the 3 required consents at v1.
    await admin.from("consents").insert([
      { user_id: userId, consent_type: "privacy_policy", accepted: true, version: "v1" },
      { user_id: userId, consent_type: "terms_of_service", accepted: true, version: "v1" },
      { user_id: userId, consent_type: "age_confirmation", accepted: true, version: "v1" },
    ]);

    const signinRes = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: created.user.email,
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
    const cookie =
      `sb-${ref}-auth-token=base64-` +
      Buffer.from(sessionJson)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    // 1. Fully onboarded user hits /profile → 200.
    const r1 = await fetch("http://localhost:3000/profile", {
      redirect: "manual",
      headers: { cookie },
    });
    if (r1.status !== 200) throw new Error(`r1 ${r1.status} ${r1.headers.get("location")}`);
    const body = await r1.text();
    // Greeting uses preferred_name fallback: the welcome string is "Welcome, {name}.".
    // Match the name rather than the full greeting (the period gets escaped in SSR HTML).
    if (!body.match(/Welcome[^<]+Dashy/))
      throw new Error(`dashboard missing greeting; body starts: ${body.slice(body.indexOf("Welcome") - 20, body.indexOf("Welcome") + 80)}`);
    if (!body.includes("resume.pdf"))
      throw new Error(`dashboard missing resume block`);
    console.log(`  ✓ fully onboarded → /profile 200 with profile + resume`);

    // 2. Missing one required consent → dashboard bounces to /onboarding/consent.
    await admin
      .from("consents")
      .insert({ user_id: userId!, consent_type: "age_confirmation", accepted: false, version: "v1" });
    const r2 = await fetch("http://localhost:3000/profile", {
      redirect: "manual",
      headers: { cookie },
    });
    if (r2.status !== 307 || !r2.headers.get("location")?.includes("/onboarding/consent"))
      throw new Error(`r2 ${r2.status} ${r2.headers.get("location")}`);
    console.log(`  ✓ revoked age consent → /profile bounces to /onboarding/consent`);

    // Restore so the recruiter-toggle test works.
    await admin
      .from("consents")
      .insert({ user_id: userId!, consent_type: "age_confirmation", accepted: true, version: "v1" });

    // 3. /profile/settings renders (consents + profile + resume sections).
    const r3 = await fetch("http://localhost:3000/profile/settings", {
      redirect: "manual",
      headers: { cookie },
    });
    if (r3.status !== 200) throw new Error(`settings ${r3.status}`);
    const sb = await r3.text();
    if (!sb.includes("Marketing preferences"))
      throw new Error(`settings missing marketing section`);
    if (!sb.includes("Resume"))
      throw new Error(`settings missing resume section`);
    console.log(`  ✓ /profile/settings renders all sections`);

    console.log("✓ dashboard smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (userId) {
      const { data: objs } = await admin.storage.from("resumes").list(userId);
      if (objs?.length) {
        await admin.storage
          .from("resumes")
          .remove(objs.map((o) => `${userId}/${o.name}`));
      }
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
