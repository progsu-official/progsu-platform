#!/usr/bin/env tsx
// Smoke: admin uploads a cover via signed URL, then removes it.
// Exercises the storage.policies on event-covers plus the signed-URL round trip
// that the browser uploader component performs.

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";

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
  const adminEmail = `admin-cover-${suffix}@example.com`;
  const password = "covertest-password-1234";

  const { data: adminCreated, error: adminErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: true,
  });
  if (adminErr || !adminCreated.user) throw new Error(`admin create: ${adminErr?.message}`);
  await admin
    .from("profiles")
    .update({ is_admin: true, first_name: "Cover", last_name: "Admin" })
    .eq("id", adminCreated.user.id);

  const adminClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
  await adminClient.auth.signInWithPassword({ email: adminEmail, password });

  // Seed an event via create_event RPC.
  const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();

  const { data: eventId, error: createErr } = await adminClient.rpc("create_event", {
    p_payload: {
      slug: `cover-smoke-${suffix}`,
      title: "Cover smoke test",
      visibility: "members",
      starts_at: futureStart,
      ends_at: futureEnd,
      hosts: [],
    },
  });
  if (createErr || !eventId) throw new Error(`create_event: ${createErr?.message}`);

  const targetPath = `${eventId}/${randomUUID()}.png`;

  // 1. Admin mints a signed upload URL via the admin-context client.
  const { data: signed, error: signErr } = await adminClient.storage
    .from("event-covers")
    .createSignedUploadUrl(targetPath);
  if (signErr || !signed) throw new Error(`sign upload: ${signErr?.message}`);
  console.log(`[smoke-event-cover-upload] OK: admin minted signed upload URL`);

  // 2. Upload a tiny PNG via the signed URL — what the browser does.
  // Minimal valid PNG: 1x1 transparent pixel.
  const tinyPng = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000005000101a5f645400000000049454e44ae426082",
    "hex"
  );
  const { error: uploadErr } = await adminClient.storage
    .from("event-covers")
    .uploadToSignedUrl(targetPath, signed.token, tinyPng, {
      contentType: "image/png",
    });
  if (uploadErr) throw new Error(`upload via signed URL: ${uploadErr.message}`);
  console.log(`[smoke-event-cover-upload] OK: uploaded via signed URL`);

  // 3. Admin persists the path to the event row via update_event.
  const { error: updateErr } = await adminClient.rpc("update_event", {
    p_event_id: eventId,
    p_patch: { cover_image_path: targetPath },
  });
  if (updateErr) throw new Error(`update_event: ${updateErr.message}`);
  console.log(`[smoke-event-cover-upload] OK: update_event persisted cover_image_path`);

  // 4. Admin can read the object back (admin SELECT policy).
  const { data: blob, error: dlErr } = await adminClient.storage
    .from("event-covers")
    .download(targetPath);
  if (dlErr || !blob) throw new Error(`download: ${dlErr?.message}`);
  if (blob.size !== tinyPng.byteLength) {
    throw new Error(`downloaded size ${blob.size} != uploaded ${tinyPng.byteLength}`);
  }
  console.log(`[smoke-event-cover-upload] OK: downloaded and verified size matches`);

  // 5. Admin deletes the object and clears the path. We mirror the
  //    deleteEventCover server action's shape: storage.remove + update_event(null).
  const { data: removed, error: removeErr } = await adminClient.storage
    .from("event-covers")
    .remove([targetPath]);
  if (removeErr) throw new Error(`remove: ${removeErr.message}`);
  if (!removed || removed.length === 0) {
    throw new Error(`remove returned no rows — did policy deny?`);
  }
  const { error: clearErr } = await adminClient.rpc("update_event", {
    p_event_id: eventId,
    p_patch: { cover_image_path: null },
  });
  if (clearErr) throw new Error(`update_event clear: ${clearErr.message}`);
  console.log(`[smoke-event-cover-upload] OK: cover removed + path cleared`);

  // 6. Verify the row is clean.
  const { data: finalEvent } = await admin
    .from("events")
    .select("cover_image_path")
    .eq("id", eventId)
    .single();
  if (finalEvent?.cover_image_path !== null) {
    throw new Error(
      `expected cover_image_path null after delete, got ${JSON.stringify(finalEvent?.cover_image_path)}`
    );
  }
  console.log(`[smoke-event-cover-upload] OK: event.cover_image_path is null post-delete`);

  // Cleanup.
  await admin.from("events").delete().eq("id", eventId);
  await admin.auth.admin.deleteUser(adminCreated.user.id);
  console.log("[smoke-event-cover-upload] ALL OK");
}

main().catch((err) => {
  console.error("[smoke-event-cover-upload] FAILED:", err);
  process.exit(1);
});
