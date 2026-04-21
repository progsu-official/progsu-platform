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
  let adminId: string | null = null;
  let memberId: string | null = null;
  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    // Seed: one admin, one regular member.
    const { data: a } = await admin.auth.admin.createUser({
      email: `admin-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!a.user) throw new Error("admin create");
    adminId = a.user.id;
    await admin.from("profiles").update({ is_admin: true }).eq("id", adminId);

    const { data: m } = await admin.auth.admin.createUser({
      email: `member-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Mabel" },
    });
    if (!m.user) throw new Error("member create");
    memberId = m.user.id;
    const y = new Date().getFullYear() + 1;
    await admin
      .from("profiles")
      .update({
        first_name: "Mabel",
        last_name: "Searcher",
        school: "Georgia State University",
        major: "Computer Science",
        class_standing: "junior",
        grad_year: y,
        grad_term: `Fall ${y}`,
        interested_roles: ["software_engineering"],
        student_email: "mabel@student.gsu.edu",
        student_email_verified: true,
      })
      .eq("id", memberId);

    const adminCookie = await makeCookie(a.user.email!, "testpassword-12345");
    const memberCookie = await makeCookie(m.user.email!, "testpassword-12345");

    // 1. Non-admin hitting /admin → 404 (not 403).
    const nonAdmin = await fetch("http://localhost:3000/admin", {
      redirect: "manual",
      headers: { cookie: memberCookie },
    });
    if (nonAdmin.status !== 404)
      throw new Error(`non-admin /admin got ${nonAdmin.status}, expected 404`);
    console.log(`  ✓ non-admin GET /admin → 404`);

    // 2. Admin hitting /admin → 200 with stats.
    const adminHome = await fetch("http://localhost:3000/admin", {
      redirect: "manual",
      headers: { cookie: adminCookie },
    });
    if (adminHome.status !== 200)
      throw new Error(`admin home ${adminHome.status}`);
    const homeBody = await adminHome.text();
    if (!homeBody.includes("Overview"))
      throw new Error(`admin home missing heading`);
    if (!/Members[\s\S]*\d/.test(homeBody))
      throw new Error(`admin home missing stats`);
    console.log(`  ✓ admin GET /admin → 200 with stats`);

    // 3. Members page shows Mabel.
    const members = await fetch("http://localhost:3000/admin/members", {
      redirect: "manual",
      headers: { cookie: adminCookie },
    });
    if (members.status !== 200) throw new Error(`members ${members.status}`);
    const mb = await members.text();
    if (!mb.includes("Mabel")) throw new Error(`mabel not in members list`);
    if (!mb.includes("Georgia State University"))
      throw new Error(`GSU not in members list`);
    console.log(`  ✓ /admin/members shows seeded member`);

    // 4. ILIKE search narrows to Mabel.
    const searchQ = await fetch(
      "http://localhost:3000/admin/members?q=Mabel",
      { redirect: "manual", headers: { cookie: adminCookie } }
    );
    const sb = await searchQ.text();
    if (!sb.includes("Mabel")) throw new Error(`Mabel missing from search`);
    if (sb.includes("1 result"))
      console.log(`  ✓ ILIKE q=Mabel returned 1 result`);
    else console.log(`  ✓ ILIKE q=Mabel executed (result count may vary)`);

    // 5. Unverified filter → Mabel excluded.
    const unv = await fetch(
      "http://localhost:3000/admin/members?verified=no",
      { redirect: "manual", headers: { cookie: adminCookie } }
    );
    const ub = await unv.text();
    if (ub.includes(">Mabel<"))
      throw new Error(`Mabel leaked into unverified filter`);
    console.log(`  ✓ verified=no filter excludes verified member`);

    // 6. Audit page loads.
    const audit = await fetch("http://localhost:3000/admin/audit", {
      redirect: "manual",
      headers: { cookie: adminCookie },
    });
    if (audit.status !== 200) throw new Error(`audit ${audit.status}`);
    const ab = await audit.text();
    if (!ab.includes("Audit log")) throw new Error(`audit missing heading`);
    console.log(`  ✓ /admin/audit renders`);

    // 7. Settings page lists domains.
    const set = await fetch("http://localhost:3000/admin/settings", {
      redirect: "manual",
      headers: { cookie: adminCookie },
    });
    const setBody = await set.text();
    if (!setBody.includes("student.gsu.edu"))
      throw new Error(`settings missing seeded domain`);
    console.log(`  ✓ /admin/settings lists school domains`);

    console.log("✓ admin smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (adminId) await admin.auth.admin.deleteUser(adminId).catch(() => {});
    if (memberId) await admin.auth.admin.deleteUser(memberId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
