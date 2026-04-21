import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROUTE_FILE = path.join(
  process.cwd(),
  "app/api/smoketest-resume/route.ts"
);
const ROUTE_SOURCE = `
import { NextResponse, type NextRequest } from "next/server";
import {
  createResumeUploadUrl,
  finalizeResumeUpload,
  deleteResume,
} from "@/lib/actions/resume";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { op, input } = body ?? {};
  if (op === "create") return NextResponse.json(await createResumeUploadUrl(input));
  if (op === "finalize") return NextResponse.json(await finalizeResumeUpload(input));
  if (op === "delete") return NextResponse.json(await deleteResume(input));
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
      email: `alice-resume-${Date.now()}@example.com`,
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

    async function call(op: string, input: unknown) {
      const res = await fetch("http://localhost:3000/api/smoketest-resume", {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ op, input }),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`non-JSON status=${res.status}: ${text.slice(0, 200)}`);
      }
    }

    // 1. Bad file name → INVALID_INPUT.
    const badName = await call("create", {
      fileName: "resume.docx",
      fileSize: 1000,
    });
    if (badName.ok || badName.error.code !== "INVALID_INPUT")
      throw new Error(`badName: ${JSON.stringify(badName)}`);
    console.log(`  ✓ non-PDF filename → INVALID_INPUT`);

    // 2. >10MB → INVALID_INPUT.
    const tooBig = await call("create", {
      fileName: "resume.pdf",
      fileSize: 11 * 1024 * 1024,
    });
    if (tooBig.ok || tooBig.error.code !== "INVALID_INPUT")
      throw new Error(`tooBig: ${JSON.stringify(tooBig)}`);
    console.log(`  ✓ >10MB → INVALID_INPUT`);

    // 3. Happy path — create, PUT, finalize.
    const created = await call("create", {
      fileName: "alice-resume.pdf",
      fileSize: 1234,
    });
    if (!created.ok) throw new Error(`create: ${JSON.stringify(created)}`);
    const { resumeId, signedUrl, path: objectPath } = created.data;
    console.log(`  ✓ created pending row resumeId=${resumeId} path=${objectPath}`);

    // PUT a 1234-byte minimal-looking PDF. The Supabase storage bucket enforces PDF mime.
    const pdfBytes = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(1234 - "%PDF-1.4\n".length, 0x20),
    ]);
    const putRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: pdfBytes,
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new Error(`PUT status=${putRes.status}: ${t.slice(0, 200)}`);
    }
    console.log(`  ✓ PUT to signed URL succeeded`);

    const finalized = await call("finalize", { resumeId });
    if (!finalized.ok) throw new Error(`finalize: ${JSON.stringify(finalized)}`);
    console.log(`  ✓ finalize succeeded`);

    const { data: row } = await admin
      .from("resumes")
      .select("status, is_current, file_size")
      .eq("id", resumeId)
      .single();
    if (row?.status !== "active" || !row.is_current)
      throw new Error(`row state wrong: ${JSON.stringify(row)}`);
    console.log(`  ✓ row is active + is_current=true`);

    // 4. Re-finalize same pending row → CONFLICT (already active).
    const refinal = await call("finalize", { resumeId });
    if (refinal.ok || refinal.error.code !== "CONFLICT")
      throw new Error(`refinal: ${JSON.stringify(refinal)}`);
    console.log(`  ✓ re-finalize blocked (CONFLICT)`);

    // 5. Deleting the CURRENT resume → CONFLICT (policy: no current-resume deletion).
    const delCurrent = await call("delete", { resumeId });
    if (delCurrent.ok || delCurrent.error.code !== "CONFLICT")
      throw new Error(`delCurrent: ${JSON.stringify(delCurrent)}`);
    console.log(`  ✓ deleting current resume → CONFLICT`);

    // 6. Upload a second resume; first demoted.
    const second = await call("create", {
      fileName: "alice-resume-v2.pdf",
      fileSize: 2048,
    });
    if (!second.ok) throw new Error(`second create: ${JSON.stringify(second)}`);
    const pdf2 = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(2048 - "%PDF-1.4\n".length, 0x20),
    ]);
    const put2 = await fetch(second.data.signedUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: pdf2,
    });
    if (!put2.ok) throw new Error(`put2 ${put2.status}`);
    const final2 = await call("finalize", { resumeId: second.data.resumeId });
    if (!final2.ok) throw new Error(`final2: ${JSON.stringify(final2)}`);

    const { data: rows } = await admin
      .from("resumes")
      .select("id, status, is_current, file_size")
      .eq("user_id", aliceId!)
      .order("file_size");
    const first = rows?.find((r) => r.id === resumeId);
    const latest = rows?.find((r) => r.id === second.data.resumeId);
    if (!first || !latest) throw new Error(`rows missing`);
    if (first.is_current || !latest.is_current)
      throw new Error(`flip didn't happen: first.is_current=${first.is_current} latest.is_current=${latest.is_current}`);
    console.log(`  ✓ second upload demoted first; latest.is_current=true, first.is_current=false`);

    // 7. Now the first resume (no longer current) can be soft-deleted.
    const delHistory = await call("delete", { resumeId });
    if (!delHistory.ok) throw new Error(`delHistory: ${JSON.stringify(delHistory)}`);
    const { data: afterDel } = await admin
      .from("resumes")
      .select("status, deleted_at")
      .eq("id", resumeId)
      .single();
    if (afterDel?.status !== "deleted" || !afterDel.deleted_at)
      throw new Error(`soft-delete didn't flip status: ${JSON.stringify(afterDel)}`);
    console.log(`  ✓ non-current resume soft-deleted (status='deleted', deleted_at set)`);

    console.log("✓ resume actions smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await rm(path.dirname(ROUTE_FILE), { recursive: true, force: true }).catch(
      () => {}
    );
    if (aliceId) {
      // Clean up storage + audit + user.
      const { data: objs } = await admin.storage.from("resumes").list(aliceId);
      if (objs?.length) {
        await admin.storage
          .from("resumes")
          .remove(objs.map((o) => `${aliceId}/${o.name}`));
      }
      await admin.auth.admin.deleteUser(aliceId).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
