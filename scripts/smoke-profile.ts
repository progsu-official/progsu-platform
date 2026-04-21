import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROUTE_FILE = path.join(
  process.cwd(),
  "app/api/smoketest-profile/route.ts"
);
const ROUTE_SOURCE = `
import { NextResponse, type NextRequest } from "next/server";

import { updateProfile } from "@/lib/actions/profile";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const r = await updateProfile(body);
  return NextResponse.json(r);
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
      email: `profile-test-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!aliceCreate.user) throw new Error("create user");
    aliceId = aliceCreate.user.id;

    // Pre-verify so they're past step 1.
    await admin
      .from("profiles")
      .update({
        student_email: "alice@student.gsu.edu",
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "admin_manual",
      })
      .eq("id", aliceId);

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
    const authCookie = `sb-${ref}-auth-token=base64-${base64url}`;

    async function call(body: unknown) {
      const res = await fetch("http://localhost:3000/api/smoketest-profile", {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`non-JSON ${res.status}: ${text.slice(0, 200)}`);
      }
    }

    // 1. Missing required fields → INVALID_INPUT
    const bad = await call({ firstName: "A" });
    if (bad.ok || bad.error.code !== "INVALID_INPUT")
      throw new Error(`bad: ${JSON.stringify(bad)}`);
    console.log(`  ✓ missing required fields → INVALID_INPUT`);

    // 2. Bad linkedin URL → INVALID_INPUT on linkedinUrl
    const badUrl = await call({
      firstName: "Alice",
      lastName: "Example",
      school: "Georgia State University",
      major: "CS",
      classStanding: "junior",
      gradYear: new Date().getFullYear() + 1,
      gradTerm: "Fall",
      interestedRoles: ["software_engineering"],
      linkedinUrl: "https://notlinkedin.com/in/x",
    });
    if (badUrl.ok || badUrl.error.code !== "INVALID_INPUT")
      throw new Error(`badUrl: ${JSON.stringify(badUrl)}`);
    console.log(`  ✓ non-linkedin URL → INVALID_INPUT`);

    // 3. Too many roles → INVALID_INPUT
    const tooMany = await call({
      firstName: "Alice",
      lastName: "Example",
      school: "Georgia State University",
      major: "CS",
      classStanding: "junior",
      gradYear: new Date().getFullYear() + 1,
      gradTerm: "Fall",
      interestedRoles: [
        "software_engineering",
        "data_science",
        "data_engineering",
        "machine_learning",
        "product_management",
        "ui_ux_design",
        "devops_sre",
      ],
    });
    if (tooMany.ok || tooMany.error.code !== "INVALID_INPUT")
      throw new Error(`tooMany: ${JSON.stringify(tooMany)}`);
    console.log(`  ✓ >6 roles → INVALID_INPUT`);

    // 4. Happy path.
    const ok = await call({
      firstName: "Alice",
      lastName: "Example",
      preferredName: "Allie",
      school: "Georgia State University",
      major: "Computer Science",
      minor: null,
      classStanding: "junior",
      gradYear: new Date().getFullYear() + 1,
      gradTerm: "Fall",
      interestedRoles: ["software_engineering", "machine_learning"],
      linkedinUrl: "https://www.linkedin.com/in/alice",
      githubUrl: "https://github.com/alice",
      portfolioUrl: null,
      phoneNumber: null,
    });
    if (!ok.ok) throw new Error(`happy: ${JSON.stringify(ok)}`);
    console.log(`  ✓ full submit succeeded`);

    const { data: p } = await admin
      .from("profiles")
      .select(
        "first_name, last_name, preferred_name, school, major, grad_year, grad_term, interested_roles, linkedin_url"
      )
      .eq("id", aliceId)
      .single();
    if (p?.first_name !== "Alice") throw new Error(`DB first_name: ${p?.first_name}`);
    if (p?.grad_term !== `Fall ${new Date().getFullYear() + 1}`)
      throw new Error(`grad_term: ${p?.grad_term}`);
    if (!p?.interested_roles.includes("software_engineering"))
      throw new Error(`interested_roles: ${p?.interested_roles}`);
    console.log(`  ✓ DB row updated with canonical fields`);

    // 5. Non-admin cannot set is_admin via updateProfile (strict schema drops extras;
    //    even if not, RLS update policy blocks the write).
    const hack = await call({
      firstName: "Alice",
      lastName: "Example",
      school: "Georgia State University",
      major: "Computer Science",
      classStanding: "junior",
      gradYear: new Date().getFullYear() + 1,
      gradTerm: "Fall",
      interestedRoles: ["software_engineering"],
      isAdmin: true, // attempt
      is_archived: true, // attempt
    });
    if (hack.ok) {
      const { data: after } = await admin
        .from("profiles")
        .select("is_admin, is_archived")
        .eq("id", aliceId)
        .single();
      if (after?.is_admin || after?.is_archived)
        throw new Error("user escalated flags via profile action");
    }
    console.log(`  ✓ extra keys (is_admin / is_archived) not written by updateProfile`);

    // 6. Visiting /onboarding/profile as fresh unverified user → redirected back to verify-email.
    const { data: bobCreate } = await admin.auth.admin.createUser({
      email: `bob-profile-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!bobCreate.user) throw new Error("bob create");
    try {
      const signinBob = await fetch(
        `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: bobCreate.user.email,
            password: "testpassword-12345",
          }),
        }
      );
      const bobT = (await signinBob.json()) as typeof tokens;
      const bobSession = JSON.stringify({
        access_token: bobT.access_token,
        refresh_token: bobT.refresh_token,
        expires_in: bobT.expires_in,
        expires_at: Math.floor(Date.now() / 1000) + bobT.expires_in,
        token_type: bobT.token_type,
        user: bobT.user,
      });
      const bobCookie =
        `sb-${ref}-auth-token=base64-` +
        Buffer.from(bobSession)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      const bobPage = await fetch("http://localhost:3000/onboarding/profile", {
        redirect: "manual",
        headers: { cookie: bobCookie },
      });
      if (bobPage.status !== 307)
        throw new Error(`bob status ${bobPage.status}`);
      if (!bobPage.headers.get("location")?.includes("/onboarding/verify-email"))
        throw new Error(`bob redirect: ${bobPage.headers.get("location")}`);
      console.log(`  ✓ unverified user on /onboarding/profile → /onboarding/verify-email`);
    } finally {
      await admin.auth.admin.deleteUser(bobCreate.user.id).catch(() => {});
    }

    console.log("✓ profile action + page smoke OK");
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
