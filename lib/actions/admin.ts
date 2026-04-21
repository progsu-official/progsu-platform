"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { type ActionResult, err, ok } from "./result";

const verifySchema = z.object({
  userId: z.string().uuid(),
  verified: z.boolean(),
  reason: z.string().trim().min(1).max(2000),
});

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false as const };
  const { data } = await supabase.rpc("is_admin", { p_user_id: user.id });
  return { supabase, user, isAdmin: data === true };
}

export async function adminSetManualVerification(
  input: z.infer<typeof verifySchema>
): Promise<ActionResult<{ userId: string; verified: boolean }>> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) {
    return err("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const admin = createAdminClient();
  const updates: Record<string, unknown> = {
    student_email_verified: parsed.data.verified,
    verification_method: "admin_manual",
  };
  if (parsed.data.verified) {
    updates.student_email_verified_at = new Date().toISOString();
  } else {
    updates.student_email_verified_at = null;
  }
  const { error } = await admin
    .from("profiles")
    .update(updates)
    .eq("id", parsed.data.userId);
  if (error) return err("INTERNAL", error.message);

  await supabase.rpc("write_audit", {
    p_action: parsed.data.verified
      ? "admin_manual_verify_on"
      : "admin_manual_verify_off",
    p_actor: user.id,
    p_target: parsed.data.userId,
    p_metadata: { reason: parsed.data.reason },
  });

  revalidatePath(`/admin/members/${parsed.data.userId}`);
  revalidatePath("/admin/members");
  log.info("admin manual-verify toggled", {
    action: "adminSetManualVerification",
    user_id: user.id,
    target_user_id: parsed.data.userId,
    verified: parsed.data.verified,
    ok: true,
  });
  return ok({
    userId: parsed.data.userId,
    verified: parsed.data.verified,
  });
}

export async function adminGetSignedResumeUrl(input: {
  resumeId: string;
}): Promise<ActionResult<{ url: string }>> {
  const schema = z.object({ resumeId: z.string().uuid() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return err("INVALID_INPUT", "Invalid resumeId");

  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const admin = createAdminClient();
  const { data: row, error: rowErr } = await admin
    .from("resumes")
    .select("storage_path, user_id")
    .eq("id", parsed.data.resumeId)
    .single();
  if (rowErr || !row) return err("NOT_FOUND", "Resume not found.");

  // Admin preview TTL is 15 minutes (docs/02 §6.3).
  const { data, error } = await admin.storage
    .from("resumes")
    .createSignedUrl(row.storage_path as string, 15 * 60);
  if (error || !data) return err("INTERNAL", error?.message ?? "Signing failed");

  await supabase.rpc("write_audit", {
    p_action: "admin_view_resume",
    p_actor: user.id,
    p_target: row.user_id,
    p_metadata: { resume_id: parsed.data.resumeId },
  });

  return ok({ url: data.signedUrl });
}
