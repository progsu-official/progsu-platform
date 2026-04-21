import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";

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

  const secret = "smoke-webhook-secret";

  let proc: ChildProcess | null = null;
  let userId: string | null = null;
  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000", RESEND_WEBHOOK_SECRET: secret },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    // Seed a verified user whose student_email matches the bounce target.
    const { data: u } = await admin.auth.admin.createUser({
      email: `bounce-target-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!u.user) throw new Error("create");
    userId = u.user.id;
    const studentEmail = `bounce-target-${Date.now()}@student.gsu.edu`;
    await admin
      .from("profiles")
      .update({
        student_email: studentEmail,
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "email_otp",
      })
      .eq("id", userId);

    // 1. Bad signature → 401.
    const bad = await fetch("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "resend-signature": "notvalid",
      },
      body: JSON.stringify({ type: "email.bounced" }),
    });
    if (bad.status !== 401) throw new Error(`bad sig ${bad.status}`);
    console.log(`  ✓ invalid signature → 401`);

    // 2. Valid signature, non-bounce event → ignored (200 ok: true).
    const payload1 = JSON.stringify({ type: "email.delivered" });
    const sig1 = createHmac("sha256", secret).update(payload1).digest("hex");
    const r1 = await fetch("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "resend-signature": sig1,
      },
      body: payload1,
    });
    if (r1.status !== 200) throw new Error(`delivered ${r1.status}`);
    console.log(`  ✓ delivered event ignored (200)`);

    // 3. Valid hard bounce on student_otp email → flips verified to false.
    const payload2 = JSON.stringify({
      type: "email.bounced",
      data: {
        to: [studentEmail],
        subject: "Your Progsu verification code",
        tags: [{ name: "purpose", value: "student_otp" }],
        bounce: { type: "hard" },
      },
    });
    const sig2 = createHmac("sha256", secret).update(payload2).digest("hex");
    const r2 = await fetch("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "resend-signature": sig2,
      },
      body: payload2,
    });
    if (r2.status !== 200) throw new Error(`bounce ${r2.status}`);
    const body = (await r2.json()) as { ok: boolean; unverified?: boolean };
    if (!body.unverified) throw new Error("did not un-verify");

    const { data: after } = await admin
      .from("profiles")
      .select("student_email_verified")
      .eq("id", userId)
      .single();
    if (after?.student_email_verified !== false)
      throw new Error("student_email_verified still true after hard bounce");
    console.log(`  ✓ hard bounce un-verifies matching user`);

    // 4. Audit row written with correct action.
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("target_user_id", userId)
      .eq("action", "email_hard_bounce_unverified")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!audit) throw new Error("no audit row");
    console.log(`  ✓ audit row written for bounce`);

    console.log("✓ resend webhook smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
