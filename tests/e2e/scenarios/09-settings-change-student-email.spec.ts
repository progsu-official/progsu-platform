import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Settings: change student email (docs/15-settings-account-email §4).
// Seeded fully-onboarded user navigates to /dashboard/settings, sees the
// Account email section, clicks "Change student email", enters a new
// allowlisted address, reads the OTP from the email_verification_codes
// table (same trick smoke-otp-flow uses — mailpit isn't deterministic),
// submits, sees the verified badge update.

test("settings: user can change + re-verify student email", async ({
  memberPage,
  memberUserId,
}) => {
  // Compiles /dashboard/settings + the inline verify form. Same cold-start
  // budget as the other settings-touching tests.
  test.slow();

  const admin = adminClient();

  // Seed a verified student email + verified flag so the section opens with
  // "✓ Verified" rather than "Awaiting verification".
  const seededEmail = `member-${Date.now()}@student.gsu.edu`;
  await admin
    .from("profiles")
    .update({
      student_email: seededEmail,
      student_email_verified: true,
      student_email_verified_at: new Date().toISOString(),
      verification_method: "admin_manual",
      pending_domain_name: null,
    })
    .eq("id", memberUserId);

  await memberPage.goto("/dashboard/settings");

  // Section + Google sign-in row.
  await expect(
    memberPage.getByRole("heading", { name: /account email/i })
  ).toBeVisible();
  const googleField = memberPage.locator("#account-email-google");
  await expect(googleField).toBeDisabled();
  await expect(googleField).toHaveValue(/@example\.com$/);

  // Verified badge is visible for the seeded email.
  await expect(memberPage.getByText(/✓ Verified/i).first()).toBeVisible();

  // Open the change flow.
  await memberPage
    .getByRole("button", { name: /change student email/i })
    .click();

  // Fill a new allowlisted address. The seeded school_domains include
  // student.gsu.edu (and aliases) — pick a different local-part on the
  // same domain to avoid the EMAIL_TAKEN guard.
  const newEmail = `member-${Date.now()}-new@student.gsu.edu`;
  await memberPage.locator("#student-email").fill(newEmail);
  await memberPage
    .getByRole("button", { name: /send verification code/i })
    .click();

  // The form moves to the code phase as soon as requestStudentEmailCode
  // resolves; wait for the code input.
  await expect(memberPage.locator("#otp-code")).toBeVisible({ timeout: 15_000 });

  // Codes are bcrypt-hashed in email_verification_codes (smoke-otp-flow uses
  // the same trick): consume the just-issued row and insert a known-hash one
  // so we can submit a deterministic 6-digit code. Filter by user_id +
  // unconsumed only — the most recent row is the one we just triggered.
  const { data: existingCode, error: codeErr } = await admin
    .from("email_verification_codes")
    .select("id, expires_at, email")
    .eq("user_id", memberUserId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (codeErr) throw new Error(`OTP query: ${codeErr.message}`);
  if (!existingCode) throw new Error("OTP row not found");

  const KNOWN_CODE = "424242";
  const { default: bcrypt } = await import("bcryptjs");
  const knownHash = await bcrypt.hash(KNOWN_CODE, 4);
  await admin
    .from("email_verification_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", (existingCode as { id: string }).id);
  await admin.from("email_verification_codes").insert({
    user_id: memberUserId,
    email: newEmail.toLowerCase(),
    code_hash: knownHash,
    expires_at: (existingCode as { expires_at: string }).expires_at,
    attempts: 0,
  });

  await memberPage.locator("#otp-code").fill(KNOWN_CODE);
  await memberPage.getByRole("button", { name: /^verify$/i }).click();

  // Section collapses + badge re-renders. We can't easily diff the date string
  // (it's "today"), so just assert the badge text re-includes "Verified" and
  // the new email is now displayed in the default state.
  await expect(memberPage.getByText(/✓ Verified/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(memberPage.getByText(newEmail)).toBeVisible();
});
