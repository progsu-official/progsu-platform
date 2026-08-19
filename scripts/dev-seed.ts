// Full local test dataset: two dev accounts (member + admin, both fully
// onboarded with resume + consents) plus mock members for the directory and
// mock events with RSVPs/attendance so /members, /events, QR check-in, and
// admin analytics all have real data to click through. Local Supabase only.
// Safe to rerun — upserts by fixed email/slug instead of duplicating rows.
//
// Usage: pnpm tsx scripts/dev-seed.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const PASSWORD = "dev-login-password-12345";

type Admin = import("@supabase/supabase-js").SupabaseClient;

async function ensureUser(
  admin: Admin,
  anonKey: string,
  supabaseUrl: string,
  email: string,
  givenName: string,
  familyName: string
): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: givenName, family_name: familyName },
  });
  if (created?.user) return created.user.id;
  if (!error?.message.includes("already been registered")) {
    throw new Error(`createUser(${email}) failed: ${error?.message}`);
  }
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = (await res.json()) as { user?: { id: string } };
  if (!json.user) throw new Error(`could not resolve existing user id for ${email}`);
  return json.user.id;
}

async function fullyOnboard(
  admin: Admin,
  userId: string,
  fields: {
    firstName: string;
    lastName: string;
    school: string;
    major: string;
    classStanding: string;
    gradYear: number;
    gradTerm: string;
    roles: string[];
    isAdmin?: boolean;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
    openToRecruiters?: boolean;
    discordUsername?: string;
  }
) {
  const { error } = await admin
    .from("profiles")
    .update({
      first_name: fields.firstName,
      last_name: fields.lastName,
      school: fields.school,
      major: fields.major,
      phone_number: "+14045551234",
      class_standing: fields.classStanding,
      grad_year: fields.gradYear,
      grad_term: fields.gradTerm,
      interested_roles: fields.roles,
      student_email: `${fields.firstName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${fields.lastName.toLowerCase()}@student.gsu.edu`,
      student_email_verified: true,
      student_email_verified_at: new Date().toISOString(),
      verification_method: "admin_manual",
      is_admin: fields.isAdmin ?? false,
      linkedin_url: fields.linkedinUrl ?? null,
      github_url: fields.githubUrl ?? null,
      portfolio_url: fields.portfolioUrl ?? null,
      open_to_recruiters: fields.openToRecruiters ?? false,
      discord_username: fields.discordUsername ?? null,
    })
    .eq("id", userId);
  if (error) throw new Error(`profile update failed: ${error.message}`);

  const { data: versions } = await admin
    .from("consent_versions")
    .select("consent_type, version")
    .in("consent_type", ["privacy_policy", "terms_of_service", "age_confirmation", "recruiter_resume_sharing"]);
  const versionFor = (type: string) =>
    versions?.find((v: { consent_type: string; version: string }) => v.consent_type === type)
      ?.version ?? "v1";
  const requiredConsents = fields.openToRecruiters
    ? ["privacy_policy", "terms_of_service", "age_confirmation", "recruiter_resume_sharing"]
    : ["privacy_policy", "terms_of_service", "age_confirmation"];
  // consents is an append-only ledger with no unique constraint — check for an
  // existing accepted row at the current version before inserting again so
  // reruns don't pile up duplicate ledger rows.
  for (const type of requiredConsents) {
    const version = versionFor(type);
    const { data: existing } = await admin
      .from("consents")
      .select("id")
      .eq("user_id", userId)
      .eq("consent_type", type)
      .eq("version", version)
      .eq("accepted", true)
      .maybeSingle();
    if (existing) continue;
    const { error } = await admin
      .from("consents")
      .insert({ user_id: userId, consent_type: type, accepted: true, version });
    if (error) throw new Error(`consent insert (${type}) failed: ${error.message}`);
  }

  const { error: resumeErr } = await admin.from("resumes").upsert(
    {
      id: `00000000-0000-0000-0000-${userId.slice(-12)}`,
      user_id: userId,
      storage_path: `${userId}/resume.pdf`,
      file_name: "resume.pdf",
      file_size: 1000,
      mime_type: "application/pdf",
      status: "active",
      is_current: true,
    },
    { onConflict: "id" }
  );
  if (resumeErr) throw new Error(`resume upsert failed: ${resumeErr.message}`);
}

async function ensureVisible(
  admin: Admin,
  userId: string,
  slug: string,
  shareEvents: boolean
) {
  const { error } = await admin.from("profile_visibility_settings").upsert(
    {
      user_id: userId,
      discoverable: true,
      share_attended_events: shareEvents,
      profile_slug: slug,
      last_discoverability_change_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(`visibility upsert failed for ${slug}: ${error.message}`);
}

async function ensureEvent(
  admin: Admin,
  adminUserId: string,
  slug: string,
  title: string,
  startsAt: Date,
  endsAt: Date
): Promise<string> {
  const { data: existing } = await admin
    .from("events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return existing.id;

  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  const { error } = await admin.from("events").insert({
    id,
    slug,
    title,
    status: "published",
    visibility: "members",
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    location_text: "Progsu Discord huddle",
    capacity: 50,
    waitlist_enabled: true,
    send_rsvp_email: false,
    send_reminder_email: false,
    created_by: adminUserId,
    updated_by: adminUserId,
    published_at: new Date().toISOString(),
  });
  if (error) throw new Error(`event insert (${slug}) failed: ${error.message}`);
  return id;
}

async function rsvp(admin: Admin, eventId: string, userId: string, status: string) {
  const { error } = await admin
    .from("event_rsvps")
    .upsert({ event_id: eventId, user_id: userId, status }, { onConflict: "event_id,user_id" });
  if (error) throw new Error(`rsvp failed: ${error.message}`);
}

async function markAttended(admin: Admin, eventId: string, userId: string, adminUserId: string) {
  const { error } = await admin.from("event_attendances").upsert(
    {
      event_id: eventId,
      user_id: userId,
      method: "admin_click",
      checked_in_by: adminUserId,
      checked_in_at: new Date().toISOString(),
    },
    { onConflict: "event_id,user_id" }
  );
  if (error) throw new Error(`attendance failed: ${error.message}`);
}

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");
  const admin: Admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Seeding dev-member and dev-admin...");
  const memberId = await ensureUser(
    admin,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.NEXT_PUBLIC_SUPABASE_URL,
    "dev-member@example.com",
    "Dev-Member",
    "Account"
  );
  await fullyOnboard(admin, memberId, {
    firstName: "Dev-Member",
    lastName: "Account",
    school: "Georgia State University",
    major: "CS",
    classStanding: "junior",
    gradYear: new Date().getFullYear() + 1,
    gradTerm: `Fall ${new Date().getFullYear() + 1}`,
    roles: ["software_engineering"],
    linkedinUrl: "https://www.linkedin.com/in/johnsang-/",
    githubUrl: "https://github.com/JohnSang16",
    portfolioUrl: "https://johnsang.site/",
    openToRecruiters: true,
    discordUsername: "johnsang",
  });
  await ensureVisible(admin, memberId, "dev-member", true);

  const adminId = await ensureUser(
    admin,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.NEXT_PUBLIC_SUPABASE_URL,
    "dev-admin@example.com",
    "Dev-Admin",
    "Account"
  );
  await fullyOnboard(admin, adminId, {
    firstName: "Dev-Admin",
    lastName: "Account",
    school: "Georgia State University",
    major: "CS",
    classStanding: "senior",
    gradYear: new Date().getFullYear(),
    gradTerm: `Spring ${new Date().getFullYear()}`,
    roles: ["software_engineering", "product_management"],
    isAdmin: true,
  });
  await ensureVisible(admin, adminId, "dev-admin", true);

  console.log("Seeding mock directory members...");
  const mockDefs = [
    { first: "Ava", last: "Nguyen", school: "Georgia Tech", major: "CS", cs: "sophomore", roles: ["software_engineering"] },
    { first: "Marcus", last: "Lee", school: "Emory University", major: "Math", cs: "senior", roles: ["data_science"] },
    { first: "Priya", last: "Patel", school: "Kennesaw State University", major: "IT", cs: "junior", roles: ["devops_sre"] },
    { first: "Chidi", last: "Okafor", school: "Georgia State University", major: "CS", cs: "freshman", roles: ["software_engineering"] },
    { first: "Sofia", last: "Ramirez", school: "Georgia State University", major: "CS", cs: "junior", roles: ["machine_learning"] },
    { first: "Tom", last: "Baker", school: "Georgia Tech", major: "CS", cs: "senior", roles: ["product_management"] },
  ];
  const mockIds: string[] = [];
  for (const m of mockDefs) {
    const email = `dev-mock-${m.first.toLowerCase()}@example.com`;
    const id = await ensureUser(
      admin,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      env.NEXT_PUBLIC_SUPABASE_URL,
      email,
      m.first,
      m.last
    );
    await fullyOnboard(admin, id, {
      firstName: m.first,
      lastName: m.last,
      school: m.school,
      major: m.major,
      classStanding: m.cs,
      gradYear: new Date().getFullYear() + 1,
      gradTerm: `Fall ${new Date().getFullYear() + 1}`,
      roles: m.roles,
    });
    await ensureVisible(admin, id, m.first.toLowerCase(), true);
    mockIds.push(id);
  }

  console.log("Seeding mock events...");
  const now = Date.now();
  const soonId = await ensureEvent(
    admin,
    adminId,
    "dev-soon-huddle",
    "Dev Test: Starting Soon Huddle",
    new Date(now + 30 * 60 * 1000),
    new Date(now + 2 * 60 * 60 * 1000)
  );
  const upcomingId = await ensureEvent(
    admin,
    adminId,
    "dev-upcoming-fireside",
    "Dev Test: Upcoming Fireside Chat",
    new Date(now + 3 * 24 * 60 * 60 * 1000),
    new Date(now + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
  );
  const pastId = await ensureEvent(
    admin,
    adminId,
    "dev-past-kickoff",
    "Dev Test: Past Kickoff",
    new Date(now - 14 * 24 * 60 * 60 * 1000),
    new Date(now - 14 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
  );

  console.log("Seeding RSVPs + attendance...");
  await rsvp(admin, soonId, memberId, "going");
  await rsvp(admin, soonId, mockIds[0], "going");
  await rsvp(admin, soonId, mockIds[1], "waitlisted");

  await rsvp(admin, upcomingId, memberId, "going");
  await rsvp(admin, upcomingId, mockIds[2], "going");

  await rsvp(admin, pastId, memberId, "going");
  await rsvp(admin, pastId, mockIds[0], "going");
  await rsvp(admin, pastId, mockIds[3], "going");
  await markAttended(admin, pastId, memberId, adminId);
  await markAttended(admin, pastId, mockIds[0], adminId);
  await markAttended(admin, pastId, mockIds[3], adminId);

  console.log(`
✓ Seed complete.

Accounts:
  dev-member@example.com  (member, fully onboarded, directory-visible)
  dev-admin@example.com   (admin, fully onboarded, directory-visible)
  Log in via: /api/dev-login?role=member  or  /api/dev-login?role=admin

Mock directory members: ${mockDefs.map((m) => m.first).join(", ")}

Events:
  ${env.NEXT_PUBLIC_SITE_URL}/events/dev-soon-huddle     (starts in 30 min, dev-member RSVP'd going → has QR)
  ${env.NEXT_PUBLIC_SITE_URL}/events/dev-upcoming-fireside (starts in 3 days, dev-member RSVP'd going → has QR)
  ${env.NEXT_PUBLIC_SITE_URL}/events/dev-past-kickoff     (past, dev-member + 2 mocks checked in)

Admin check-in screen for the soon event:
  ${env.NEXT_PUBLIC_SITE_URL}/admin/events/${soonId}/check-in
`);
}

main().catch((err) => {
  console.error("dev-seed failed:", err);
  process.exit(1);
});
