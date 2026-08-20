"use server";

import "server-only";

import bcrypt from "bcryptjs";
import postgres from "postgres";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import OtpEmail, { otpPlainText } from "@/emails/OtpEmail";
import { sendEmail } from "@/lib/email/resend";
import { log } from "@/lib/log";
import { type ActionResult, err, ok } from "./result";
import {
  type RequestStudentEmailCodeInput,
  type ReserveStudentEmailInput,
  type VerifyStudentEmailCodeInput,
  OTP_TTL_MINUTES_DEFAULT,
  OTP_MAX_ATTEMPTS_DEFAULT,
  OTP_BCRYPT_COST_DEFAULT,
  SEND_BUCKET,
  SEND_WINDOW_SEC,
  SEND_MAX,
  SEND_COOLDOWN_SEC,
  VERIFY_BUCKET,
  VERIFY_WINDOW_SEC,
  VERIFY_MAX,
  requestStudentEmailCodeSchema,
  reserveStudentEmailSchema,
  verifyStudentEmailCodeSchema,
} from "./verification-schemas";

const OTP_TTL_MINUTES = Number(
  process.env.OTP_CODE_TTL_MINUTES ?? OTP_TTL_MINUTES_DEFAULT
);
const OTP_MAX_ATTEMPTS = Number(
  process.env.OTP_MAX_ATTEMPTS ?? OTP_MAX_ATTEMPTS_DEFAULT
);
const OTP_BCRYPT_COST = Number(
  process.env.OTP_BCRYPT_COST ?? OTP_BCRYPT_COST_DEFAULT
);

// --------------------------------------------------------------------------
// Internal: direct Postgres client (service role) for the transactional verify flow.
// Lazy singleton so action cold-start is cheap.
// --------------------------------------------------------------------------
let _sql: postgres.Sql | null = null;
function getSql(): postgres.Sql {
  if (_sql) return _sql;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL required for verification actions");
  _sql = postgres(url, { prepare: false, max: 5 });
  return _sql;
}

// Fixed code stored (still bcrypt-hashed) when ONBOARDING_TEST_MODE is on, so
// the verify path runs unchanged without anyone reading a real inbox.
const TEST_MODE_OTP = "000000";

function generateCode(): string {
  // Cryptographically secure 6-digit code, left-padded.
  const n = Math.floor(Number(`0x${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`) / 2) % 1_000_000;
  return n.toString(10).padStart(6, "0");
}

// --------------------------------------------------------------------------
// requestStudentEmailCode
// --------------------------------------------------------------------------
export async function requestStudentEmailCode(
  rawInput: RequestStudentEmailCodeInput
): Promise<ActionResult<{ expiresAt: string }>> {
  const parsed = requestStudentEmailCodeSchema.safeParse(rawInput);
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

  // 1. Domain allowlist.
  const domain = studentEmail.split("@")[1];
  const { data: domainRow } = await admin
    .from("school_domains")
    .select("domain, school_name, is_active")
    .eq("domain", domain)
    .maybeSingle();
  if (!domainRow || !domainRow.is_active) {
    return err(
      "DOMAIN_NOT_ALLOWED",
      "That school domain isn't supported yet.",
      { field: "studentEmail" }
    );
  }

  // 2. Duplicate-student-email guard (another verified account holds it).
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

  // 3+4. Rate limits. Skipped in test mode so repeated walkthroughs aren't
  // locked out by the 60s cooldown / 3-per-15-min ceiling.
  if (!env.ONBOARDING_TEST_MODE) {
    // 3. Per-(user,email) cooldown — 60s between sends.
    const { data: cooldownRow } = await admin
      .rpc("consume_rate_limit", {
        p_bucket: `${SEND_BUCKET}_cooldown`,
        p_key: `${user.id}:${studentEmail}`,
        p_max_hits: 1,
        p_window_seconds: SEND_COOLDOWN_SEC,
      })
      .single();
    const cooldown = cooldownRow as
      | { allowed: boolean; retry_after_ms: number }
      | null;
    if (cooldown && !cooldown.allowed) {
      return err(
        "RATE_LIMITED",
        "Please wait before requesting another code.",
        { retryAfterMs: cooldown.retry_after_ms }
      );
    }

    // 4. Per-user send ceiling — 3 per 15 min.
    const { data: sendRow } = await admin
      .rpc("consume_rate_limit", {
        p_bucket: SEND_BUCKET,
        p_key: user.id,
        p_max_hits: SEND_MAX,
        p_window_seconds: SEND_WINDOW_SEC,
      })
      .single();
    const send = sendRow as
      | { allowed: boolean; retry_after_ms: number }
      | null;
    if (send && !send.allowed) {
      return err(
        "RATE_LIMITED",
        "Too many codes requested. Please try again later.",
        { retryAfterMs: send.retry_after_ms }
      );
    }
  }

  // 5. Generate + hash + insert + send. Resend invalidates prior active codes.
  const rawCode = env.ONBOARDING_TEST_MODE ? TEST_MODE_OTP : generateCode();
  const codeHash = await bcrypt.hash(rawCode, OTP_BCRYPT_COST);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const sql = getSql();
  try {
    await sql.begin(async (tx) => {
      // Invalidate prior un-consumed codes for this (user, email) pair.
      await tx`
        update public.email_verification_codes
           set consumed_at = now()
         where user_id = ${user.id}
           and email   = ${studentEmail}
           and consumed_at is null
      `;
      await tx`
        insert into public.email_verification_codes
          (user_id, email, code_hash, expires_at, max_attempts)
        values
          (${user.id}, ${studentEmail}, ${codeHash}, ${expiresAt}, ${OTP_MAX_ATTEMPTS})
      `;
    });
  } catch (e) {
    console.error("[requestStudentEmailCode] DB tx failed:", e);
    return err(
      "INTERNAL",
      e instanceof Error ? e.message : "Could not create verification code."
    );
  }

  // 6. Send. Idempotency key scoped to the minute so genuine retries dedupe
  //    but a legit resend after cooldown is a new send.
  if (env.ONBOARDING_TEST_MODE) {
    console.log(
      "[onboarding-test-mode] skipped OTP email to %s — code is %s",
      studentEmail,
      TEST_MODE_OTP
    );
    log.info("otp send skipped (test mode)", {
      action: "requestStudentEmailCode",
      user_id: user.id,
      ok: true,
    });
    return ok({ expiresAt: expiresAt.toISOString() });
  }

  const firstName = user.user_metadata?.given_name ?? user.user_metadata?.full_name?.split(" ")[0] ?? null;
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const sendResult = await sendEmail({
    to: studentEmail,
    subject: "Your Progsu verification code",
    react: OtpEmail({
      firstName,
      code: rawCode,
      expiresInMinutes: OTP_TTL_MINUTES,
    }),
    text: otpPlainText({
      firstName,
      code: rawCode,
      expiresInMinutes: OTP_TTL_MINUTES,
    }),
    idempotencyKey: `student-otp/${user.id}/${studentEmail}/${minuteBucket}`,
    tags: { purpose: "student_otp" },
  });

  if (!sendResult.ok) {
    console.error(
      "[requestStudentEmailCode] Resend send failed:",
      sendResult.code,
      sendResult.message
    );
    log.error("otp send failed", {
      action: "requestStudentEmailCode",
      user_id: user.id,
      ok: false,
      error_code: sendResult.code,
    });
    return err("INTERNAL", "Could not send the verification email.");
  }

  log.info("otp sent", {
    action: "requestStudentEmailCode",
    user_id: user.id,
    transport: sendResult.transport,
    ok: true,
  });
  return ok({ expiresAt: expiresAt.toISOString() });
}

// --------------------------------------------------------------------------
// verifyStudentEmailCode — transactional (reconciliation #19)
// --------------------------------------------------------------------------
export async function verifyStudentEmailCode(
  rawInput: VerifyStudentEmailCodeInput
): Promise<
  ActionResult<{ studentEmail: string; verifiedAt: string }>
> {
  const parsed = verifyStudentEmailCodeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const { studentEmail, code } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const admin = createAdminClient();

  // Verify bucket: 5 attempts per 15 min per user. Skipped in test mode.
  if (!env.ONBOARDING_TEST_MODE) {
    const { data: vRow } = await admin
      .rpc("consume_rate_limit", {
        p_bucket: VERIFY_BUCKET,
        p_key: user.id,
        p_max_hits: VERIFY_MAX,
        p_window_seconds: VERIFY_WINDOW_SEC,
      })
      .single();
    const v = vRow as
      | { allowed: boolean; retry_after_ms: number }
      | null;
    if (v && !v.allowed) {
      return err(
        "OTP_LOCKED",
        "Too many attempts. Request a new code later.",
        { retryAfterMs: v.retry_after_ms }
      );
    }
  }

  const sql = getSql();
  type Row = {
    id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
    max_attempts: number;
    consumed_at: string | null;
  };

  let outcome:
    | { kind: "ok"; verifiedAt: string }
    | { kind: "err"; code: "OTP_EXPIRED" | "OTP_INVALID" | "OTP_LOCKED" | "NOT_FOUND"; attemptsRemaining?: number };

  try {
    outcome = await sql.begin(async (tx) => {
      const rows = await tx<Row[]>`
        select id, code_hash, expires_at, attempts, max_attempts, consumed_at
          from public.email_verification_codes
         where user_id = ${user.id}
           and email   = ${studentEmail}
           and consumed_at is null
         order by created_at desc
         limit 1
         for update
      `;
      const row = rows[0];
      if (!row) {
        return { kind: "err", code: "NOT_FOUND" } as const;
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await tx`
          update public.email_verification_codes
             set consumed_at = now()
           where id = ${row.id}
        `;
        return { kind: "err", code: "OTP_EXPIRED" } as const;
      }
      if (row.attempts >= row.max_attempts) {
        return { kind: "err", code: "OTP_LOCKED" } as const;
      }

      const match = await bcrypt.compare(code, row.code_hash);
      if (!match) {
        const nextAttempts = row.attempts + 1;
        await tx`
          update public.email_verification_codes
             set attempts = ${nextAttempts}
           where id = ${row.id}
        `;
        const remaining = Math.max(0, row.max_attempts - nextAttempts);
        return {
          kind: "err",
          code: "OTP_INVALID",
          attemptsRemaining: remaining,
        } as const;
      }

      // Correct code. Consume, flip profile, audit.
      const now = new Date();
      const domain = studentEmail.split("@")[1];

      // Re-check duplicate-student-email inside the tx (race against parallel request).
      const dupeRows = await tx<{ id: string }[]>`
        select id from public.profiles
         where student_email = ${studentEmail}
           and student_email_verified = true
           and id <> ${user.id}
         limit 1
      `;
      if (dupeRows.length > 0) {
        return { kind: "err", code: "NOT_FOUND" } as const; // surface as generic; caller translates
      }

      await tx`
        update public.email_verification_codes
           set consumed_at = ${now}
         where id = ${row.id}
      `;
      // Free up the email address from any competing unverified claims. The
      // partial unique index only enforces uniqueness among verified rows, but
      // leaving someone else's stale unverified claim hanging around is noise.
      await tx`
        update public.profiles
           set student_email = null,
               pending_domain_name = null
         where student_email = ${studentEmail}
           and student_email_verified = false
           and id <> ${user.id}
      `;
      // Auto-populate school from the school_domains lookup so the minimal
      // signup form doesn't need a school picker (docs/14-low-friction-signup).
      // coalesce(..., school) keeps any manually-set school if the domain
      // isn't in the allowlist (race with admin removing a row, etc). Last
      // verified domain wins — documented behavior.
      await tx`
        update public.profiles
           set student_email              = ${studentEmail},
               student_email_verified     = true,
               student_email_verified_at  = ${now},
               verification_method        = 'email_otp'::public.verification_method_t,
               pending_domain_name        = null,
               school                     = coalesce(
                 (select sd.school_name
                    from public.school_domains sd
                   where sd.domain = ${domain}
                     and sd.is_active = true
                  limit 1),
                 school
               ),
               updated_at                 = ${now}
         where id = ${user.id}
      `;
      await tx`
        insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
        values (
          ${user.id},
          ${user.id},
          'student_email_verified',
          ${sql.json({ email: studentEmail, domain }) as unknown as string}
        )
      `;
      return { kind: "ok", verifiedAt: now.toISOString() } as const;
    });
  } catch (e) {
    return err(
      "INTERNAL",
      e instanceof Error ? e.message : "Verification failed."
    );
  }

  if (outcome.kind === "err") {
    log.warn("otp verify failed", {
      action: "verifyStudentEmailCode",
      user_id: user.id,
      ok: false,
      error_code: outcome.code,
    });
    switch (outcome.code) {
      case "NOT_FOUND":
        return err("OTP_INVALID", "No active code for that email. Request a new one.");
      case "OTP_EXPIRED":
        return err("OTP_EXPIRED", "That code has expired. Request a new one.");
      case "OTP_LOCKED":
        return err("OTP_LOCKED", "Too many incorrect attempts. Request a new code.");
      case "OTP_INVALID":
        return err("OTP_INVALID", "Incorrect code.", {
          attemptsRemaining: outcome.attemptsRemaining,
        });
    }
  }

  log.info("otp verified", {
    action: "verifyStudentEmailCode",
    user_id: user.id,
    ok: true,
  });
  return ok({ studentEmail, verifiedAt: outcome.verifiedAt });
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
