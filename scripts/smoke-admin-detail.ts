import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROUTE_FILE = path.join(
  process.cwd(),
  "app/api/smoketest-admin/route.ts"
);
const ROUTE_SOURCE = `
import { NextResponse, type NextRequest } from "next/server";
import {
  adminSetManualVerification,
  adminGetSignedResumeUrl,
} from "@/lib/actions/admin";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { op, input } = body ?? {};
  if (op === "verify") return NextResponse.json(await adminSetManualVerification(input));
  if (op === "sign") return NextResponse.json(await adminGetSignedResumeUrl(input));
  return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "unknown op" } }, { status: 400 });
}
`;

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

  await mkdir(path.dirname(ROUTE_FILE), { recursive: true });
  await writeFile(ROUTE_FILE, ROUTE_SOURCE, "utf8");

  let proc: ChildProcess | null = null;
  let adminId: string | null = null;
  let targetId: string | null = null;
  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    const { data: a } = await admin.auth.admin.createUser({
      email: `admin-det-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!a.user) throw new Error("admin create");
    adminId = a.user.id;
    await admin.from("profiles").update({ is_admin: true }).eq("id", adminId);

    const { data: tgt } = await admin.auth.admin.createUser({
      email: `target-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Target" },
    });
    if (!tgt.user) throw new Error("target create");
    targetId = tgt.user.id;

    const adminCookie = await makeCookie(a.user.email!, "testpassword-12345");
    const targetCookie = await makeCookie(tgt.user.email!, "testpassword-12345");

    async function callAs(cookie: string, body: unknown) {
      const res = await fetch("http://localhost:3000/api/smoketest-admin", {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`non-JSON ${res.status}: ${text.slice(0, 200)}`);
      }
    }

    // 1. Non-admin cannot call adminSetManualVerification.
    const forbidden = await callAs(targetCookie, {
      op: "verify",
      input: { userId: targetId, verified: true, reason: "test" },
    });
    if (forbidden.ok || forbidden.error.code !== "FORBIDDEN")
      throw new Error(`forbidden: ${JSON.stringify(forbidden)}`);
    console.log(`  ✓ non-admin → FORBIDDEN`);

    // 2. Admin verifies target manually.
    const verified = await callAs(adminCookie, {
      op: "verify",
      input: { userId: targetId, verified: true, reason: "spot check" },
    });
    if (!verified.ok) throw new Error(`verify: ${JSON.stringify(verified)}`);

    const { data: afterProfile } = await admin
      .from("profiles")
      .select("student_email_verified, verification_method")
      .eq("id", targetId!)
      .single();
    if (!afterProfile?.student_email_verified)
      throw new Error("did not flip verified");
    if (afterProfile.verification_method !== "admin_manual")
      throw new Error(
        `wrong method: ${afterProfile.verification_method}`
      );
    console.log(`  ✓ admin verify flipped flags (method=admin_manual)`);

    // 3. Audit row written.
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("actor_user_id", adminId!)
      .eq("target_user_id", targetId!)
      .eq("action", "admin_manual_verify_on")
      .maybeSingle();
    if (!audit) throw new Error("no audit row");
    if (!JSON.stringify(audit.metadata).includes("spot check"))
      throw new Error(`audit reason missing: ${JSON.stringify(audit.metadata)}`);
    console.log(`  ✓ audit row written with reason`);

    // 4. Reason required.
    const noReason = await callAs(adminCookie, {
      op: "verify",
      input: { userId: targetId, verified: false, reason: "" },
    });
    if (noReason.ok || noReason.error.code !== "INVALID_INPUT")
      throw new Error(`noReason: ${JSON.stringify(noReason)}`);
    console.log(`  ✓ empty reason → INVALID_INPUT`);

    // 5. Admin viewing detail page shows target.
    const detail = await fetch(
      `http://localhost:3000/admin/members/${targetId}`,
      { redirect: "manual", headers: { cookie: adminCookie } }
    );
    if (detail.status !== 200)
      throw new Error(`detail ${detail.status} ${detail.headers.get("location")}`);
    const db = await detail.text();
    if (!db.includes("Target")) throw new Error("name missing on detail");
    if (!db.includes("Manually verify") && !db.includes("Un-verify"))
      throw new Error("verify toggle missing");
    console.log(`  ✓ admin GET /admin/members/[id] renders`);

    // 6. Non-admin hitting detail page → 404.
    const forbiddenPage = await fetch(
      `http://localhost:3000/admin/members/${targetId}`,
      { redirect: "manual", headers: { cookie: targetCookie } }
    );
    if (forbiddenPage.status !== 404)
      throw new Error(
        `non-admin detail got ${forbiddenPage.status}, expected 404`
      );
    console.log(`  ✓ non-admin /admin/members/[id] → 404`);

    console.log("✓ admin detail smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await rm(path.dirname(ROUTE_FILE), { recursive: true, force: true }).catch(
      () => {}
    );
    if (adminId) await admin.auth.admin.deleteUser(adminId).catch(() => {});
    if (targetId) await admin.auth.admin.deleteUser(targetId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
