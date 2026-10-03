import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { revokeStoredAppleToken } from "./apple";

// In-app account deletion (App Store guideline 5.1.1(v)). Service role,
// server-only. Every step is idempotent, so a failed run is retried by
// calling this again; account_deletion_jobs has no FK to profiles and so
// survives the deletion as the record that it finished.

const USER_BUCKETS = ["resumes", "avatars", "banners"] as const;

export type DeletionResult = { status: "completed"; deletedAt: string };

async function removePrefix(bucket: string, prefix: string): Promise<number> {
  const admin = createAdminClient();
  let removed = 0;
  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
    if (error) throw new Error(`list ${bucket}: ${error.message}`);
    const files = (data ?? []).filter((o) => o.id !== null);
    if (files.length === 0) return removed;
    const { error: rmErr } = await admin.storage
      .from(bucket)
      .remove(files.map((o) => `${prefix}/${o.name}`));
    if (rmErr) throw new Error(`remove ${bucket}: ${rmErr.message}`);
    removed += files.length;
  }
  return removed;
}

export async function deleteAccount(userId: string, source: "mobile" | "web" | "admin"): Promise<DeletionResult> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("account_deletion_jobs")
    .select("status, completed_at, steps, attempts")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.status === "completed" && existing.completed_at) {
    return { status: "completed", deletedAt: new Date(existing.completed_at as string).toISOString() };
  }

  const steps: Record<string, unknown> = { ...((existing?.steps as Record<string, unknown>) ?? {}) };
  const { error: upErr } = await admin.from("account_deletion_jobs").upsert(
    {
      user_id: userId,
      status: "pending",
      source,
      steps,
      attempts: Number(existing?.attempts ?? 0) + 1,
      last_error: null,
    },
    { onConflict: "user_id" }
  );
  if (upErr) throw new Error(`deletion job: ${upErr.message}`);

  const save = (patch: Record<string, unknown>) =>
    admin.from("account_deletion_jobs").update(patch).eq("user_id", userId);

  try {
    if (!existing) {
      await admin.rpc("write_audit", {
        p_action: "account.delete_requested",
        p_actor: userId,
        p_target: userId,
        p_metadata: { source },
      });
    }

    steps.apple = await revokeStoredAppleToken(userId);
    await save({ steps });

    const storage: Record<string, number> = {};
    for (const bucket of USER_BUCKETS) storage[bucket] = await removePrefix(bucket, userId);
    steps.storage = storage;
    await save({ steps });

    const { error: dtErr } = await admin.from("device_tokens").delete().eq("user_id", userId);
    if (dtErr) throw new Error(`device tokens: ${dtErr.message}`);
    steps.deviceTokens = "deleted";

    // Cascades profiles and everything keyed to it (consents, RSVPs,
    // attendance, ledger, bookmarks, links, staff assignments).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr && !/not.?found/i.test(delErr.message)) throw new Error(`auth delete: ${delErr.message}`);
    steps.auth = "deleted";

    const deletedAt = new Date().toISOString();
    await save({ steps, status: "completed", completed_at: deletedAt });
    await admin.rpc("write_audit", {
      p_action: "account.deleted",
      p_actor: null,
      p_target: null,
      p_metadata: { user_id: userId, source, steps },
    });
    return { status: "completed", deletedAt };
  } catch (e) {
    await save({ steps, status: "failed", last_error: e instanceof Error ? e.message.slice(0, 500) : "error" });
    throw e;
  }
}
