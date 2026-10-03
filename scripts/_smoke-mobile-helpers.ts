// Shared setup for the mobile smokes (smoke-mobile-*.ts, smoke-affiliation-
// snapshot.ts, smoke-account-deletion.ts). Seeds real auth users, signs them
// in with a password to get real access tokens, and cleans up.

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "smoke-password-12345";

export const admin: SupabaseClient = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const anon: SupabaseClient = createClient(URL_, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type SmokeUser = { id: string; email: string; token: string; db: SupabaseClient };

const created: string[] = [];
const createdEvents: string[] = [];

export function tag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function currentVersions(): Promise<Map<string, string>> {
  const { data } = await admin.from("consent_versions").select("consent_type, version");
  return new Map((data ?? []).map((r) => [String(r.consent_type), String(r.version)]));
}

export async function makeUser(
  label: string,
  opts: { admin?: boolean; onboarded?: boolean; affiliation?: string; gsuVerified?: boolean } = {}
): Promise<SmokeUser> {
  const email = `smoke-${label}-${tag()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: label, family_name: "Smoke" },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const id = data.user.id;
  created.push(id);

  const patch: Record<string, unknown> = {};
  if (opts.admin) patch.is_admin = true;
  if (opts.onboarded) {
    Object.assign(patch, {
      first_name: label,
      last_name: "Smoke",
      school: "Georgia State University",
      major: "computer_science",
      phone_number: "404-555-0100",
      affiliation: opts.affiliation ?? "gsu_student",
    });
  } else if (opts.affiliation) {
    patch.affiliation = opts.affiliation;
  }
  if (opts.gsuVerified) {
    Object.assign(patch, {
      student_email: `${label}-${tag()}@student.gsu.edu`,
      student_email_verified: true,
      student_email_verified_at: new Date().toISOString(),
      verification_method: "email_otp",
    });
  }
  if (Object.keys(patch).length) {
    const { error: pErr } = await admin.from("profiles").update(patch).eq("id", id);
    if (pErr) throw new Error(`profile ${label}: ${pErr.message}`);
  }
  if (opts.onboarded) {
    const versions = await currentVersions();
    const { error: cErr } = await admin.from("consents").insert(
      ["privacy_policy", "terms_of_service", "age_confirmation"].map((t) => ({
        user_id: id,
        consent_type: t,
        accepted: true,
        version: versions.get(t),
      }))
    );
    if (cErr) throw new Error(`consents ${label}: ${cErr.message}`);
  }

  const signer = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: sErr } = await signer.auth.signInWithPassword({ email, password: PASSWORD });
  if (sErr || !sess.session) throw new Error(`signIn ${label}: ${sErr?.message}`);
  const token = sess.session.access_token;
  const db = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { id, email, token, db };
}

export async function makeEvent(opts: {
  startsInMinutes?: number;
  durationMinutes?: number;
  visibility?: "members" | "private_invite";
  status?: "published" | "draft";
  title?: string;
}): Promise<{ id: string; slug: string }> {
  const start = new Date(Date.now() + (opts.startsInMinutes ?? 30) * 60_000);
  const end = new Date(start.getTime() + (opts.durationMinutes ?? 120) * 60_000);
  const slug = `smoke-mobile-${tag()}`;
  const status = opts.status ?? "published";
  const { data, error } = await admin
    .from("events")
    .insert({
      slug,
      title: opts.title ?? `Smoke ${slug}`,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status,
      visibility: opts.visibility ?? "members",
      published_at: status === "published" ? new Date().toISOString() : null,
      send_rsvp_email: false,
      send_reminder_email: false,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`event: ${error?.message}`);
  createdEvents.push(String(data.id));
  return { id: String(data.id), slug };
}

export async function rsvpGoing(u: SmokeUser, eventId: string) {
  const { data, error } = await u.db.rpc("rsvp_to_event", { p_event_id: eventId, p_desired: "going", p_comment: null });
  if (error) throw new Error(`rsvp: ${error.message}`);
  if (data !== "going") throw new Error(`rsvp effective ${data}`);
}

export async function cleanup() {
  for (const id of createdEvents) await admin.from("events").delete().eq("id", id);
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  created.length = 0;
  createdEvents.length = 0;
}

let failures = 0;
export function check(cond: unknown, label: string, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}
export function failureCount() {
  return failures;
}

// Asserts a role cannot EXECUTE a function (hard rule 10).
export async function assertNoExecute(client: SupabaseClient, fn: string, args: Record<string, unknown>, label: string) {
  const { error } = await client.rpc(fn, args);
  check(
    error && (error.code === "42501" || /permission denied/i.test(error.message)),
    `${label} cannot execute ${fn}`,
    error ?? "no error"
  );
}
