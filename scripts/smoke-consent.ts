import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROUTE_FILE = path.join(
  process.cwd(),
  "app/api/smoketest-consent/route.ts"
);
const ROUTE_SOURCE = `
import { NextResponse, type NextRequest } from "next/server";
import { recordConsents } from "@/lib/actions/consent";
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await recordConsents(body));
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
      email: `alice-consent-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!aliceCreate.user) throw new Error("create");
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
    const cookie =
      `sb-${ref}-auth-token=base64-` +
      Buffer.from(sessionJson)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    async function call(body: unknown) {
      const res = await fetch("http://localhost:3000/api/smoketest-consent", {
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

    // 1. Missing required consents → INVALID_INPUT.
    const missing = await call({
      acceptances: { privacy_policy: true, terms_of_service: false },
    });
    if (missing.ok || missing.error.code !== "INVALID_INPUT")
      throw new Error(`missing: ${JSON.stringify(missing)}`);
    console.log(`  ✓ missing required consents → INVALID_INPUT`);

    // 2. SMS opt-in without phone → INVALID_INPUT on sms_marketing.
    const noPhone = await call({
      acceptances: {
        privacy_policy: true,
        terms_of_service: true,
        age_confirmation: true,
        sms_marketing: true,
      },
    });
    if (noPhone.ok || noPhone.error.code !== "INVALID_INPUT")
      throw new Error(`noPhone: ${JSON.stringify(noPhone)}`);
    if (noPhone.error.field !== "sms_marketing")
      throw new Error(`noPhone field: ${noPhone.error.field}`);
    console.log(`  ✓ sms_marketing without phone → INVALID_INPUT on sms_marketing`);

    // 3. Happy path: accept required only → 3 rows inserted.
    const ok1 = await call({
      acceptances: {
        privacy_policy: true,
        terms_of_service: true,
        age_confirmation: true,
      },
    });
    if (!ok1.ok) throw new Error(`ok1: ${JSON.stringify(ok1)}`);
    console.log(`  ✓ required-only consent accepted`);

    const { data: rows1 } = await admin
      .from("consents")
      .select("consent_type, accepted, version")
      .eq("user_id", aliceId!);
    if (!rows1 || rows1.length !== 3)
      throw new Error(`expected 3 rows, got ${rows1?.length}`);
    // Against the CURRENT version per type, not a hardcoded "v1". Pinning the
    // literal made this smoke fail on every policy bump for a reason that has
    // nothing to do with consent recording. See CLAUDE.md, "Dynamic consent
    // versions".
    const { data: currentVersions } = await admin
      .from("consent_versions")
      .select("consent_type, version");
    const currentFor = (type: string) =>
      (currentVersions ?? []).find((v) => v.consent_type === type)?.version;
    if (!rows1.every((r) => r.version === currentFor(r.consent_type)))
      throw new Error(`versions: ${JSON.stringify(rows1)}`);
    console.log(`  ✓ 3 consent rows persisted at current versions`);

    // 4. Second submission (toggle flow) appends instead of updating — reconciliation #28.
    const ok2 = await call({
      acceptances: {
        privacy_policy: true,
        terms_of_service: true,
        age_confirmation: true,
        recruiter_resume_sharing: true,
      },
    });
    if (!ok2.ok) throw new Error(`ok2: ${JSON.stringify(ok2)}`);
    const { data: rows2 } = await admin
      .from("consents")
      .select("id")
      .eq("user_id", aliceId!);
    if (!rows2 || rows2.length !== 7)
      throw new Error(
        `expected 7 total rows after append, got ${rows2?.length}`
      );
    console.log(
      `  ✓ append-only behavior: 7 rows after second submit (3+4)`
    );

    console.log("✓ consent action smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await rm(path.dirname(ROUTE_FILE), { recursive: true, force: true }).catch(
      () => {}
    );
    if (aliceId) await admin.auth.admin.deleteUser(aliceId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
