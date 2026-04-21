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

async function seedEligibleMember(admin: unknown, email: string): Promise<string> {
  // Admin client passed in as unknown — we use the supabase-js shape here.
  const client = admin as { auth: { admin: { createUser: (args: unknown) => Promise<{ data: { user: { id: string; email: string } } }> } }; from: (t: string) => unknown; storage: { from: (b: string) => unknown } };
  const { data } = await client.auth.admin.createUser({
    email,
    password: "testpassword-12345",
    email_confirm: true,
    user_metadata: { given_name: "Eligible" },
  });
  const userId = data.user.id;
  const y = new Date().getFullYear() + 1;

  const profilesUpdate = (client.from("profiles") as { update: (p: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } })
    .update({
      first_name: "Eligible",
      last_name: "User",
      student_email: `${email.split("@")[0]}@student.gsu.edu`,
      student_email_verified: true,
      student_email_verified_at: new Date().toISOString(),
      verification_method: "admin_manual",
      school: "Georgia State University",
      major: "Computer Science",
      class_standing: "junior",
      grad_year: y,
      grad_term: `Fall ${y}`,
      interested_roles: ["software_engineering"],
      linkedin_url: "https://linkedin.com/in/eligible",
      github_url: "https://github.com/eligible",
      open_to_recruiters: true,
      phone_number: "+14045551234",
    })
    .eq("id", userId);
  await profilesUpdate;

  const resumeId = crypto.randomUUID();
  const storagePath = `${userId}/${resumeId}.pdf`;
  // Put an object into storage so the signed URL has something to sign.
  const storageClient = client.storage.from("resumes") as {
    upload: (
      path: string,
      body: ArrayBuffer | Buffer,
      opts?: unknown
    ) => Promise<unknown>;
  };
  await storageClient.upload(storagePath, Buffer.from("%PDF-1.4\n"), {
    contentType: "application/pdf",
    upsert: true,
  } as unknown);

  const resumesInsert = (client.from("resumes") as { insert: (p: unknown) => Promise<unknown> }).insert({
    id: resumeId,
    user_id: userId,
    storage_path: storagePath,
    file_name: "eligible-resume.pdf",
    file_size: 9,
    mime_type: "application/pdf",
    status: "active",
    is_current: true,
  });
  await resumesInsert;

  const consents = [
    "privacy_policy",
    "terms_of_service",
    "age_confirmation",
    "recruiter_resume_sharing",
  ].map((t) => ({ user_id: userId, consent_type: t, accepted: true, version: "v1" }));
  await (client.from("consents") as { insert: (p: unknown) => Promise<unknown> }).insert(consents);

  return userId;
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
  let eligibleId: string | null = null;
  let ineligibleId: string | null = null;

  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    // Seed a Progsu admin.
    const { data: a } = await admin.auth.admin.createUser({
      email: `admin-export-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!a.user) throw new Error("admin create");
    adminId = a.user.id;
    await admin.from("profiles").update({ is_admin: true }).eq("id", adminId);

    // Seed one eligible member + one that's missing recruiter consent.
    eligibleId = await seedEligibleMember(
      admin,
      `elig-${Date.now()}@example.com`
    );
    const { data: ineligibleUser } = await admin.auth.admin.createUser({
      email: `inelig-${Date.now()}@example.com`,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!ineligibleUser.user) throw new Error("inelig create");
    ineligibleId = ineligibleUser.user.id;
    const y = new Date().getFullYear() + 1;
    await admin
      .from("profiles")
      .update({
        first_name: "Nope",
        last_name: "User",
        student_email: "nope@student.gsu.edu",
        student_email_verified: true,
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: y,
        grad_term: `Fall ${y}`,
        open_to_recruiters: true, // but NO recruiter consent → not eligible
      })
      .eq("id", ineligibleId);

    const adminCookie = await makeCookie(a.user.email!, "testpassword-12345");

    // 1. Preview count is >= 1.
    const previewRes = await fetch(
      "http://localhost:3000/admin/export",
      {
        redirect: "manual",
        headers: { cookie: adminCookie },
      }
    );
    if (previewRes.status !== 200)
      throw new Error(`preview page ${previewRes.status}`);
    console.log(`  ✓ /admin/export renders as admin`);

    // 2. Download as admin → 200 text/csv.
    const dl = await fetch("http://localhost:3000/api/admin/export", {
      redirect: "manual",
      headers: { cookie: adminCookie },
    });
    if (dl.status !== 200) throw new Error(`download ${dl.status}`);
    const ct = dl.headers.get("content-type") ?? "";
    if (!ct.startsWith("text/csv"))
      throw new Error(`content-type: ${ct}`);
    const exportId = dl.headers.get("x-export-id");
    if (!exportId) throw new Error("missing x-export-id header");
    const disp = dl.headers.get("content-disposition") ?? "";
    if (!disp.includes("attachment"))
      throw new Error(`disposition: ${disp}`);
    console.log(
      `  ✓ GET /api/admin/export → 200 text/csv (export_id=${exportId.slice(0, 8)}…)`
    );

    // 3. Body contains the eligible user + excludes the ineligible user.
    const body = await dl.text();
    if (!body.includes("Eligible"))
      throw new Error("Eligible missing from CSV");
    if (body.includes("nope@")) throw new Error("ineligible leaked");
    // Must include all D2 contact columns.
    for (const hdr of [
      "google_email",
      "student_email",
      "phone_number",
      "resume_signed_url",
      "resume_signed_url_expires_at",
    ]) {
      if (!body.includes(hdr)) throw new Error(`CSV missing ${hdr}`);
    }
    console.log(`  ✓ CSV contains D2 columns, eligible user, excludes ineligible`);

    // 4. Audit row written.
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("actor_user_id", adminId!)
      .eq("action", "admin_export_recruiter_csv")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!audit) throw new Error("audit row missing");
    if (JSON.stringify(audit.metadata).indexOf(exportId) === -1)
      throw new Error(`audit metadata missing export_id: ${JSON.stringify(audit.metadata)}`);
    console.log(`  ✓ audit row written with export_id`);

    // 5. Non-admin download → 404.
    const ineligUserRes = await admin.auth.admin.getUserById(ineligibleId!);
    const nonAdminCookie = await makeCookie(
      ineligUserRes.data.user!.email!,
      "testpassword-12345"
    );
    const forbidden = await fetch("http://localhost:3000/api/admin/export", {
      redirect: "manual",
      headers: { cookie: nonAdminCookie },
    });
    if (forbidden.status !== 404)
      throw new Error(
        `non-admin download got ${forbidden.status}, expected 404`
      );
    console.log(`  ✓ non-admin GET /api/admin/export → 404`);

    console.log("✓ export smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (adminId) await admin.auth.admin.deleteUser(adminId).catch(() => {});
    if (eligibleId) {
      const { data: objs } = await admin.storage.from("resumes").list(eligibleId);
      if (objs?.length) {
        await admin.storage
          .from("resumes")
          .remove(objs.map((o) => `${eligibleId}/${o.name}`));
      }
      await admin.auth.admin.deleteUser(eligibleId).catch(() => {});
    }
    if (ineligibleId) await admin.auth.admin.deleteUser(ineligibleId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
