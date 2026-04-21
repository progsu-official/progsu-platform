// End-to-end OTP flow smoke. Invokes the server actions through a test Next.js
// route handler we register below — this is the cleanest way to hit the real
// auth-scoped supabase server client + bcrypt + DB transaction.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const ROUTE_FILE = path.join(
  process.cwd(),
  "app/api/smoketest-verification/route.ts"
);

const ROUTE_SOURCE = `
import { NextResponse, type NextRequest } from "next/server";

import {
  requestStudentEmailCode,
  verifyStudentEmailCode,
} from "@/lib/actions/verification";

export async function POST(req: NextRequest) {
  // Smoke-test harness. Relies on a valid sb-<ref>-auth-token cookie from the caller;
  // /api/smoketest-* paths are excluded from middleware so the cookie arrives intact.
  const body = await req.json().catch(() => ({}));
  const { op, input } = body ?? {};
  if (op === "request") {
    const r = await requestStudentEmailCode(input);
    return NextResponse.json(r);
  }
  if (op === "verify") {
    const r = await verifyStudentEmailCode(input);
    return NextResponse.json(r);
  }
  return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "unknown op" } }, { status: 400 });
}
`;

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

  // 1. Seed the throwaway test route + start dev server.
  await mkdir(path.dirname(ROUTE_FILE), { recursive: true });
  await writeFile(ROUTE_FILE, ROUTE_SOURCE, "utf8");

  let proc: ChildProcess | null = null;
  let aliceId: string | null = null;
  let bobId: string | null = null;

  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    // 2. Seed alice + bob; sign alice in via password (same trick as the RLS smoke).
    const { data: aliceCreate } = await admin.auth.admin.createUser({
      email: `alice-otp-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Alice" },
    });
    const { data: bobCreate } = await admin.auth.admin.createUser({
      email: `bob-otp-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Bob" },
    });
    if (!aliceCreate.user || !bobCreate.user) throw new Error("seed failed");
    aliceId = aliceCreate.user.id;
    bobId = bobCreate.user.id;

    // Pre-verify bob with the student email "bob@gsu.edu" so we can test the
    // "email already verified on another account" path.
    await admin
      .from("profiles")
      .update({
        student_email: "bob@gsu.edu",
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "admin_manual",
      })
      .eq("id", bobId);

    // 3. Build an auth'd cookie jar for alice by signing her in via GoTrue and
    //    grabbing the access_token + refresh_token cookies. Supabase SSR expects
    //    a `sb-<project-ref>-auth-token` cookie with a base64-encoded token array.
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
      user: { id: string };
    };
    if (!tokens.access_token) throw new Error(`signin failed: ${JSON.stringify(tokens)}`);

    // Build the sb-<ref>-auth-token cookie. @supabase/auth-js 2.104+ stores the FULL
    // session object (not the old 5-tuple array) at `storageKey`. @supabase/ssr wraps
    // that JSON in base64url and prefixes with "base64-".
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
    const cookieValue = `base64-${base64url}`;
    const authCookie = `sb-${ref}-auth-token=${cookieValue}`;

    async function call(op: string, input: unknown): Promise<{
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string; retryAfterMs?: number; attemptsRemaining?: number; field?: string };
    }> {
      const res = await fetch("http://localhost:3000/api/smoketest-verification", {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          cookie: authCookie,
        },
        body: JSON.stringify({ op, input }),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          `non-JSON response (status=${res.status}, location=${res.headers.get("location")}): ${text.slice(0, 200)}`
        );
      }
    }

    // --- Invariant 1: non-allowlisted domain rejected ---
    const bad = await call("request", { studentEmail: "alice@example.com" });
    if (bad.ok || bad.error?.code !== "DOMAIN_NOT_ALLOWED")
      throw new Error(`domain check: ${JSON.stringify(bad)}`);
    console.log(`  ✓ non-allowlisted domain rejected (DOMAIN_NOT_ALLOWED)`);

    // --- Invariant 2: duplicate verified email rejected ---
    const dup = await call("request", { studentEmail: "bob@gsu.edu" });
    if (dup.ok || dup.error?.code !== "EMAIL_TAKEN")
      throw new Error(`dup check: ${JSON.stringify(dup)}`);
    console.log(`  ✓ email already verified on another account rejected (EMAIL_TAKEN)`);

    // --- Invariant 3: valid domain succeeds, DB row created ---
    const aliceEmail = "alice@student.gsu.edu";
    const good = await call("request", { studentEmail: aliceEmail });
    if (!good.ok) throw new Error(`valid request: ${JSON.stringify(good)}`);
    console.log(`  ✓ valid request succeeded (expiresAt=${(good.data as { expiresAt: string }).expiresAt})`);

    // Fetch the code from the DB to pretend to be the email reader.
    const { data: codeRow } = await admin
      .from("email_verification_codes")
      .select("id, code_hash, attempts, expires_at")
      .eq("user_id", aliceId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!codeRow) throw new Error("no EVC row found");

    // --- Invariant 4: cooldown blocks immediate resend ---
    const cool = await call("request", { studentEmail: aliceEmail });
    if (cool.ok || cool.error?.code !== "RATE_LIMITED")
      throw new Error(`cooldown: ${JSON.stringify(cool)}`);
    if (!cool.error?.retryAfterMs || cool.error.retryAfterMs <= 0)
      throw new Error(`cooldown missing retryAfterMs`);
    console.log(
      `  ✓ 60s cooldown blocks immediate resend (retryAfterMs=${cool.error.retryAfterMs})`
    );

    // --- Invariant 5: wrong code → OTP_INVALID with attemptsRemaining ---
    const wrong = await call("verify", { studentEmail: aliceEmail, code: "000000" });
    if (wrong.ok) throw new Error(`wrong code should fail`);
    if (wrong.error?.code !== "OTP_INVALID")
      throw new Error(`expected OTP_INVALID got ${JSON.stringify(wrong)}`);
    if (typeof wrong.error.attemptsRemaining !== "number")
      throw new Error(`no attemptsRemaining`);
    console.log(
      `  ✓ wrong code → OTP_INVALID, attemptsRemaining=${wrong.error.attemptsRemaining}`
    );

    // The wrong attempt incremented attempts in DB; verify.
    const { data: afterWrong } = await admin
      .from("email_verification_codes")
      .select("attempts")
      .eq("id", codeRow.id)
      .single();
    if (afterWrong?.attempts !== 1)
      throw new Error(`attempts=${afterWrong?.attempts}, expected 1`);
    console.log(`  ✓ attempts incremented atomically`);

    // --- Invariant 6: correct code → success, profile flipped, audit written ---
    // We don't know the raw code; we invalidate the existing row and insert a known one.
    const knownCode = "424242";
    const { default: bcrypt } = await import("bcryptjs");
    const knownHash = await bcrypt.hash(knownCode, 4); // low cost — this is a test
    await admin
      .from("email_verification_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", codeRow.id);
    await admin.from("email_verification_codes").insert({
      user_id: aliceId,
      email: aliceEmail,
      code_hash: knownHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      max_attempts: 5,
    });

    const goodVerify = await call("verify", { studentEmail: aliceEmail, code: knownCode });
    if (!goodVerify.ok)
      throw new Error(`correct code failed: ${JSON.stringify(goodVerify)}`);
    console.log(`  ✓ correct code verified`);

    const { data: aliceProfile } = await admin
      .from("profiles")
      .select("student_email, student_email_verified, verification_method")
      .eq("id", aliceId)
      .single();
    if (!aliceProfile?.student_email_verified)
      throw new Error(`profile not flipped: ${JSON.stringify(aliceProfile)}`);
    if (aliceProfile.verification_method !== "email_otp")
      throw new Error(`verification_method wrong: ${aliceProfile.verification_method}`);
    console.log(
      `  ✓ profile flipped (student_email=${aliceProfile.student_email}, method=${aliceProfile.verification_method})`
    );

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, target_user_id, metadata")
      .eq("actor_user_id", aliceId)
      .eq("action", "student_email_verified")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!audit) throw new Error(`no audit row written`);
    console.log(`  ✓ audit row written (action=${audit.action})`);

    // --- Invariant 7: replay rejected (code already consumed) ---
    const replay = await call("verify", { studentEmail: aliceEmail, code: knownCode });
    if (replay.ok) throw new Error(`replay should fail`);
    if (replay.error?.code !== "OTP_INVALID")
      throw new Error(`replay: ${JSON.stringify(replay)}`);
    console.log(`  ✓ replay rejected (OTP_INVALID)`);

    console.log("✓ OTP flow smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await rm(path.dirname(ROUTE_FILE), { recursive: true, force: true }).catch(() => {});
    if (aliceId) await admin.auth.admin.deleteUser(aliceId).catch(() => {});
    if (bobId) await admin.auth.admin.deleteUser(bobId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
