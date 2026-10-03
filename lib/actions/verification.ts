"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import {
  requestStudentEmailCodeFor,
  verifyStudentEmailCodeFor,
} from "@/lib/domain/student-email";
import { type ActionResult, err, ok } from "./result";
import {
  type RequestStudentEmailCodeInput,
  type ReserveStudentEmailInput,
  type VerifyStudentEmailCodeInput,
  reserveStudentEmailSchema,
} from "./verification-schemas";

export async function requestStudentEmailCode(
  rawInput: RequestStudentEmailCodeInput
): Promise<ActionResult<{ expiresAt: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");
  return requestStudentEmailCodeFor(user, rawInput);
}

export async function verifyStudentEmailCode(
  rawInput: VerifyStudentEmailCodeInput
): Promise<ActionResult<{ studentEmail: string; verifiedAt: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");
  return verifyStudentEmailCodeFor(user, rawInput);
}

// --------------------------------------------------------------------------
// reserveStudentEmail — records the email the user plans to verify (without
// sending an OTP) so we don't lose what they typed when they hit "Verify later".
//
// Two paths:
//   - Domain is in school_domains → reserve the email; user can return to verify.
//   - Domain is NOT in school_domains → still store the email + pending_domain_name
//     so the UI can show "your school is coming soon"; append to domain_requests
//     so admins can see which schools to add.
// --------------------------------------------------------------------------
export async function reserveStudentEmail(
  rawInput: ReserveStudentEmailInput
): Promise<ActionResult<{ studentEmail: string; domainSupported: boolean }>> {
  const parsed = reserveStudentEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const { studentEmail } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const admin = createAdminClient();

  const domain = studentEmail.split("@")[1];
  const { data: domainRow } = await admin
    .from("school_domains")
    .select("domain, is_active")
    .eq("domain", domain)
    .maybeSingle();
  const domainSupported = Boolean(domainRow?.is_active);

  // If the domain IS supported, guard against stealing a verified holder's email.
  if (domainSupported) {
    const { data: dupe } = await admin
      .from("profiles")
      .select("id")
      .eq("student_email", studentEmail)
      .eq("student_email_verified", true)
      .neq("id", user.id)
      .maybeSingle();
    if (dupe) {
      return err(
        "EMAIL_TAKEN",
        "That email is already in use on another Progsu account. Contact an admin if this is a mistake.",
        { field: "studentEmail" }
      );
    }
  }

  // Refuse to overwrite a verified email via the reserve path. If the caller is
  // already verified and wants to change their address, they must go through
  // the real OTP verify flow.
  const { data: me } = await admin
    .from("profiles")
    .select("student_email_verified")
    .eq("id", user.id)
    .single();
  if (me?.student_email_verified) {
    return err(
      "CONFLICT",
      "You're already verified. Use the verify flow to change your email."
    );
  }

  // Store the email (verified=false is enforced by RLS). Also set/clear
  // pending_domain_name depending on whether the domain is supported.
  const { error: updateErr } = await supabase
    .from("profiles")
    .update({
      student_email: studentEmail,
      pending_domain_name: domainSupported ? null : domain,
    })
    .eq("id", user.id);
  if (updateErr) {
    return err("INTERNAL", updateErr.message);
  }

  // If the domain isn't in our allowlist, log the request so admins can see
  // demand for that school. Append-only; the unique index ensures one row per
  // (domain, user). Errors here are non-fatal for the reserve flow.
  if (!domainSupported) {
    const { error: reqErr } = await supabase
      .from("domain_requests")
      .upsert(
        {
          domain,
          user_id: user.id,
          example_email: studentEmail,
        },
        { onConflict: "domain,user_id" }
      );
    if (reqErr) {
      log.warn("domain_requests insert failed", {
        action: "reserveStudentEmail",
        user_id: user.id,
        error_message: reqErr.message,
      });
    }
  }

  log.info("student email reserved (verify later)", {
    action: "reserveStudentEmail",
    user_id: user.id,
    domain_supported: domainSupported,
    ok: true,
  });
  return ok({ studentEmail, domainSupported });
}
