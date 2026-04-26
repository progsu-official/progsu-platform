# 15 — Settings: Account email

Owner: Settings UX
Last revised: 2026-04-24
Status: Planning. No code yet. Scope: a single new section on `/dashboard/settings`. No schema changes, no new server actions, no privacy bump.

---

## 0. Why

The platform is now the default events host. Members hit settings mid-semester to update contact channels — graduating from a `.student.gsu.edu` to `.gsu.edu` alumni address, fixing a typo from onboarding, or re-verifying after a school joins the allowlist. Today there is no in-app surface for any of this: the only path to OTP verification is the onboarding funnel, and once `student_email_verified=true` we never return.

Spec line: **no new gate, no privacy bump, just expose existing capability.** Reuse `requestStudentEmailCode` + `verifyStudentEmailCode` as-is. Reuse the onboarding form by extracting it. Read-only display of `google_email` clears the recurring "which Google did I sign in with?" support thread.

---

## 1. UI shape

A new `<section id="account-email">` placed above `#profile` on `/dashboard/settings`. Two fields stacked.

**Google sign-in** — read-only `<dl>` row showing `profiles.google_email`. Subtitle: *"This is your sign-in email and can't be changed here."* Visually a greyed/disabled `Input` for symmetry with the field below.

**Student email** — display row showing current `profiles.student_email` (or "Not set"), a verification badge to its right, and a single "Change student email" button below. Clicking expands the section inline (not a modal): the row becomes the existing onboarding `VerifyEmailForm`, scoped to this section. After a successful verify the section collapses and the badge re-renders. Errors (wrong code, expired, locked, domain not allowlisted) reuse the form's existing copy.

Default state:
```
Account email
  Google sign-in   [you@gmail.com           ] (disabled)
                   This is your sign-in email and can't be changed here.

  Student email    you@student.gsu.edu      [✓ Verified · Apr 12, 2026]
                   [ Change student email ]
```

Expanded state (after clicking Change):
```
  Student email    [ new@student.gsu.edu    ]
                   [ Send verification code ]   [ Cancel ]
  → after send:
                   We emailed a code to new@student.gsu.edu. Expires in 9:42.
                   [ 6-digit code ] [ Verify ]   [ Resend in 47s ] [ Use different email ]
```

State table — drives badge text, primary button label, and any inline hint:

| `student_email` | `verified` | `pending_domain_name` | Badge | Below-field hint |
|---|---|---|---|---|
| null | false | null | "Not verified" | "Add your school email to share recruiter visibility." |
| set | false | null | "Awaiting verification" | "We have your email but haven't confirmed it yet." |
| set | false | set | "Pending: {pending_domain_name}" | "Your school isn't on the allowlist yet. We'll email you when it is." |
| set | true | null | "✓ Verified · {YYYY-MM-DD}" | (none) |

The "Change student email" button is **always** visible (even verified). Clicking always opens the same expanded flow. No locked-by-default state.

---

## 2. Reuse (no new server actions)

`requestStudentEmailCode` and `verifyStudentEmailCode` are already idempotent and re-verify-safe: the verify path issues `update profiles set student_email=…, student_email_verified=true` unconditionally and writes a fresh audit row each time. No server-side change needed.

Extract `app/onboarding/verify-email/verify-email-form.tsx` into `components/verify-student-email/verify-email-form.tsx` (or keep at `app/(shared)/verify-email-form.tsx` if the team prefers app-relative). Both `/onboarding/verify-email/page.tsx` and `/dashboard/settings/page.tsx` import it.

Props after extraction:
- `initialEmail: string` — prefills the input.
- `mode: "onboarding" | "settings"` — drives post-success behavior. Onboarding routes to `skipDestination`; settings calls an `onSuccess` callback (pop the expanded UI, refresh the section).
- `onSuccess?: (result: { studentEmail: string; verifiedAt: string }) => void` — settings only.
- `onCancel?: () => void` — settings only ("Cancel" button hides the form, restores default state).
- `allowSkip: boolean` — settings = `false` (no "Verify later"; the user is already past onboarding).

`reserveStudentEmail` is **not** used in settings — it explicitly errs `CONFLICT` for verified users (verification.ts:497–506) and the settings flow is "verify or do nothing." If the user types a non-allowlisted domain, `requestStudentEmailCode` returns `DOMAIN_NOT_ALLOWED` and the form's existing copy already prompts the user to wait for the school to be added. We do not invoke the "Verify later" reserve path from settings.

No edits required to `verification.ts`.

---

## 3. RLS + data exposure

The settings page selects `google_email, student_email, student_email_verified, student_email_verified_at, pending_domain_name` from `profiles`. All five are covered by the existing `profiles_select_own` policy (init migration line 304: `using (auth.uid() = id)`), so no new policy and no migration.

The `profiles_update_own` `with check` clause forbids client writes to `student_email_verified` and `student_email_verified_at` (init lines 317–322). That is correct: those columns flip only inside the `verifyStudentEmailCode` Postgres transaction running as service role. No change.

---

## 4. Smoke + E2E

- No new unit-style smoke. `scripts/smoke-otp-flow.ts` already exercises `requestStudentEmailCode` + `verifyStudentEmailCode` end-to-end including re-verify; adding a settings-page wrapper smoke would be redundant.
- New Playwright scenario: `tests/e2e/scenarios/09-settings-change-student-email.spec.ts`. Steps:
  1. Seed a fully-onboarded user with a verified `@student.gsu.edu` student email (mirror seeding from `08-low-friction-signup.spec.ts`).
  2. Sign in, `goto("/dashboard/settings")`, scroll to `#account-email`.
  3. Assert the Google email row renders the seed email and is disabled.
  4. Assert the verified badge shows `✓ Verified` with the seeded date.
  5. Click "Change student email", fill a new `@student.gsu.edu` address, click "Send verification code".
  6. Read the OTP from inbucket (helper already exists), submit it.
  7. Assert the badge re-renders to the new email + today's date and the form collapses.
  8. Tear down the user in `finally`.
- Acceptance: new scenario passes; `08-low-friction-signup`, `07-onboarding-consent-cascade`, `smoke-otp-flow`, `smoke-onboarding-parity` stay green.

---

## 5. What we are NOT doing

- No way to change Google email (would require re-OAuth + a destructive identity merge — out of scope).
- No batch re-verify across all members.
- No new audit-log entries beyond the `student_email_verified` row `verifyStudentEmailCode` already writes.
- No privacy-policy bump. The data already lives on `profiles`; no new peer-visible surface.
- No copy update on `/privacy/page.tsx`.
- No "Verify later" / reserve flow from this surface — settings is past onboarding.
- No locked-by-default UX (one extra click before edit). Always editable.

---

## 6. Open questions the user might push back on

1. **Position: above Profile, or just below it?** Recommendation: **above**. Sign-in identity > profile fields; this also matches the natural mental model ("who am I" → "what do I tell recruiters").
2. **Should `google_email` also stay as the existing read-only `dt/dd` row on `/dashboard`, or move exclusively into settings?** Recommendation: **leave the dashboard row alone**, just stop being the only place to see it. Two read-only displays of the same value is cheap; removing the dashboard row is a separate cleanup.
3. **Locked-by-default vs always-editable input for the verified state.** Recommendation: **always editable** (one click less; the verify step is itself the destructive confirmation). Revisit only if we see accidental re-verifies in logs.
