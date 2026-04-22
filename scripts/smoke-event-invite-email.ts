#!/usr/bin/env tsx
// Smoke: admin invites members by email. Covers:
//  - lookup on google_email matches
//  - lookup on student_email matches
//  - unknown email returns a clear NOT_FOUND
//  - invited user can RSVP to a private-invite event

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const suffix = Date.now();
  const createdUserIds: string[] = [];
  const seedUser = async (
    email: string,
    extras: Record<string, unknown> = {}
  ) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `invite-smoke-${suffix}`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    createdUserIds.push(data.user.id);

    // google_email is populated by the handle_new_user trigger from auth.users.email.
    // student_email must be set explicitly. Use latest consent versions for fullyOnboarded.
    const { error: profileUpdErr } = await admin
      .from("profiles")
      .update({
        first_name: "Invite",
        last_name: "Smoke",
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: 2027,
        grad_term: "Spring 2027",
        interested_roles: ["software_engineering"],
        phone_number: "555-555-5555",
        ...extras,
      })
      .eq("id", data.user.id);
    if (profileUpdErr) {
      throw new Error(
        `profile update for ${email}: ${profileUpdErr.message}`
      );
    }

    // Give them current consents so fullyOnboarded is true → rsvp_to_event passes.
    const { data: versions } = await admin
      .from("consent_versions")
      .select("consent_type, version");
    for (const v of versions ?? []) {
      await admin.from("consents").insert({
        user_id: data.user.id,
        consent_type: v.consent_type,
        accepted: true,
        version: v.version,
      });
    }
    // Dummy current resume.
    await admin.from("resumes").insert({
      user_id: data.user.id,
      storage_path: `${data.user.id}/resume-${suffix}.pdf`,
      file_name: "resume.pdf",
      file_size: 1024,
      mime_type: "application/pdf",
      status: "active",
      is_current: true,
    });

    return data.user.id;
  };

  const adminId = await seedUser(`admin-invite-${suffix}@example.com`);
  await admin.from("profiles").update({ is_admin: true }).eq("id", adminId);

  const googleEmail = `google-target-${suffix}@gmail.com`;
  const googleMemberId = await seedUser(googleEmail);

  const studentEmail = `student-target-${suffix}@gsu.edu`;
  const googleOfStudent = `student-google-${suffix}@gmail.com`;
  const studentMemberId = await seedUser(googleOfStudent, {
    student_email: studentEmail,
    student_email_verified: true,
  });
  // Verify the extras landed — a previous run showed student_email came back
  // NULL, which would silently mask the lookup bug.
  const { data: seedCheck } = await admin
    .from("profiles")
    .select("id, student_email, google_email")
    .eq("id", studentMemberId)
    .single();
  if (seedCheck?.student_email !== studentEmail.toLowerCase()) {
    throw new Error(
      `seed student_email mismatch: expected ${studentEmail.toLowerCase()}, got ${JSON.stringify(seedCheck)}`
    );
  }

  const adminClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
  await adminClient.auth.signInWithPassword({
    email: `admin-invite-${suffix}@example.com`,
    password: `invite-smoke-${suffix}`,
  });

  // Seed a private_invite event.
  const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();
  const { data: eventId, error: createErr } = await adminClient.rpc("create_event", {
    p_payload: {
      slug: `invite-smoke-${suffix}`,
      title: "Invite smoke event",
      visibility: "private_invite",
      starts_at: futureStart,
      ends_at: futureEnd,
      hosts: [],
    },
  });
  if (createErr || !eventId) throw new Error(`create_event: ${createErr?.message}`);
  await adminClient.rpc("publish_event", { p_event_id: eventId });

  // 1. Invite by google_email.
  const { data: googleMatch, error: googleLookupErr } = await adminClient
    .from("profiles")
    .select("id")
    .or(`google_email.eq.${googleEmail},student_email.eq.${googleEmail}`)
    .limit(1)
    .maybeSingle();
  if (googleLookupErr || !googleMatch || googleMatch.id !== googleMemberId) {
    throw new Error(
      `google_email lookup mismatch: expected ${googleMemberId}, got ${JSON.stringify(googleMatch)}`
    );
  }
  const { error: inviteG } = await adminClient.rpc("invite_member_to_event", {
    p_event_id: eventId,
    p_user_id: googleMatch.id,
  });
  if (inviteG) throw new Error(`invite google: ${inviteG.message}`);
  console.log(`[smoke-event-invite-email] OK: invited member via google_email`);

  // 2. Invite by student_email (same user has different google/student).
  const { data: studentMatch } = await adminClient
    .from("profiles")
    .select("id")
    .or(`google_email.eq.${studentEmail},student_email.eq.${studentEmail}`)
    .limit(1)
    .maybeSingle();
  if (studentMatch?.id !== studentMemberId) {
    throw new Error(
      `student_email lookup mismatch: expected ${studentMemberId}, got ${JSON.stringify(studentMatch)}`
    );
  }
  const { error: inviteS } = await adminClient.rpc("invite_member_to_event", {
    p_event_id: eventId,
    p_user_id: studentMatch!.id,
  });
  if (inviteS) throw new Error(`invite student: ${inviteS.message}`);
  console.log(`[smoke-event-invite-email] OK: invited member via student_email`);

  // 3. Unknown email → no match.
  const { data: noMatch } = await adminClient
    .from("profiles")
    .select("id")
    .or(`google_email.eq.nope@nope.example,student_email.eq.nope@nope.example`)
    .limit(1)
    .maybeSingle();
  if (noMatch !== null) {
    throw new Error(
      `expected null for unknown email, got ${JSON.stringify(noMatch)}`
    );
  }
  console.log(`[smoke-event-invite-email] OK: unknown email returns null`);

  // 4. Invited user can RSVP going to the private-invite event.
  const inviteeClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
  await inviteeClient.auth.signInWithPassword({
    email: googleEmail,
    password: `invite-smoke-${suffix}`,
  });
  const { data: rsvpStatus, error: rsvpErr } = await inviteeClient.rpc(
    "rsvp_to_event",
    { p_event_id: eventId, p_desired: "going" }
  );
  if (rsvpErr) throw new Error(`invited rsvp: ${rsvpErr.message}`);
  if (rsvpStatus !== "going") {
    throw new Error(`expected 'going' for invitee, got ${rsvpStatus}`);
  }
  console.log(`[smoke-event-invite-email] OK: invited user RSVP'd 'going'`);

  // Cleanup.
  await admin.from("events").delete().eq("id", eventId);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log("[smoke-event-invite-email] ALL OK");
}

main().catch((err) => {
  console.error("[smoke-event-invite-email] FAILED:", err);
  process.exit(1);
});
