# 14.06 — Smoke + E2E Test Plan

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning.

---

## 1. `scripts/smoke-onboarding-parity.ts` scenario updates

This smoke is a hard merge gate (CLAUDE.md rule #5). Every scenario compares `public.is_fully_onboarded(uid)` (DB) against `loadOnboardingState(supabase, uid).fullyOnboarded` (TS) and fails if they diverge.

Existing scenarios currently tied to the old `REQUIRED_PROFILE_FIELDS` list must be rewritten. New scenario catalog (expected boolean in parentheses):

| # | Profile shape | Consents | Resume | Expected `fullyOnboarded` |
|---|---|---|---|---|
| 1 | All new-gate fields set (first/last/phone/school/major) | 3 required at current versions, accepted=true | no resume | **true** |
| 2 | Same as 1, `major = 'other'`, `major_other_text = 'Cognitive Science'` | same | no resume | **true** |
| 3 | Same as 1, `major = 'other'`, `major_other_text` null | same | no resume | **false** — verifies the Other-requires-text branch |
| 4 | Missing `phone_number` | same | no resume | **false** |
| 5 | Missing `major` | same | no resume | **false** |
| 6 | Missing `school` | same | no resume | **false** (school is required; auto-populated by verify-email normally, but this scenario tests the gate) |
| 7 | All new-gate fields set, but missing `age_confirmation` consent | 2/3 | no resume | **false** |
| 8 | All new-gate fields set, privacy_policy accepted at OLD version (not current) | version mismatch | no resume | **false** |
| 9 | All new-gate fields set, but ALSO has grad_year/class_standing/grad_term/interested_roles set | all consents current | resume active | **true** — verifies old-complete profiles still pass |
| 10 | Admin user, nothing filled | zero consents | no resume | **false** — admin bypass is caller-level, not in `is_fully_onboarded` (preserves current behavior, see comment in `20260423000100_events_core.sql` line 158) |

Remove all scenarios that assert `class_standing`/`grad_year`/`grad_term`/`interested_roles` as hard-gate requirements. Replace with the list above.

Read `consent_versions` dynamically at startup, as the existing smoke already does (never hardcode `"v1"`).

### Mirror change in `lib/auth/onboarding.ts`

When the smoke is rewritten, `REQUIRED_PROFILE_FIELDS` shrinks to `["first_name", "last_name", "school", "major", "phone_number"]` and the `interested_roles` length check is removed. Add the "other requires major_other_text" conditional to match the SQL `is_fully_onboarded()`. See `01-schema-changes.md` §4.

---

## 2. New E2E scenario: low-friction signup happy path

File: `tests/e2e/low-friction-signup.spec.ts` (new Playwright test).

Scenario: **OAuth → minimal profile → verify .edu → consent → dashboard shows ring at 4/10.**

Steps:
1. Seed a user via `admin.auth.admin.createUser` (skip the real Google OAuth; stub the session cookie the same way existing E2Es do).
2. Navigate to `/onboarding/profile`.
3. Assert only first_name, last_name, phone_number, major visible. Major is a `<select>` with >10 options; "Other" option expands a text input when selected.
4. Fill first/last/phone, pick a real major (not "Other"), submit.
5. Expect redirect to `/onboarding/verify-email`. Enter a GSU email (from the seeded `school_domains`), get the OTP from the test email harness, submit.
6. Expect redirect to `/onboarding/consent`. Check all three consents, submit.
7. Expect redirect to `/profile`.
8. Assert the `ProfileCompletionRing` component renders.
9. Assert the ring reads "4/10" — items #1 and #2 from the ring list are done (resume nope, but verified email yes), and items #7/#8/#9/#10 are no, #3-#6 are no. Count: verified email yes + 0 others from ring slots not covered by signup = 1/10. (Adjust the expected count to match reality after `03-profile-completion-ring.md` §1 is finalized; the scenario doc lists the ring as 10-slot with the first two as resume + verify-email.)
   - Recount on reflection: after the happy path, the user has verified email (slot 2) and no resume, no grad_year, no class_standing, no grad_term, no interested_roles, no recruiter opt-in, no linkedin, no github, no portfolio = **1/10**. Use "1/10" as the assertion.
10. Assert the top CTA reads "Upload your resume".
11. Assert `admin_recruiter_eligible_count()` did NOT increment from baseline — this user has no resume and hasn't opted into recruiter visibility.

Tear down the seeded user in `finally`.

---

## 3. Existing E2E impacts

Search `tests/e2e/*.spec.ts` for any scenario that currently fills `class_standing`, `grad_year`, `grad_term`, or `interested_roles` on the `/onboarding/profile` page. Those calls will fail because the onboarding profile form no longer shows those fields.

Migration per scenario:
- If the scenario needs a fully-onboarded user for downstream steps (events RSVP, member directory, etc.), fill the minimum bar during onboarding, then `PATCH` the extra fields via a helper that calls `updateProfile` directly against the server action. Do NOT try to drive the old form.
- If the scenario explicitly asserts the old form shape, delete the scenario (it's testing deprecated UI).

Likely-affected specs (list based on filename heuristics; verify during implementation):
- `event-rsvp.spec.ts` — probably fills profile to pass onboarding gate.
- `member-card.spec.ts` — same.
- `shared-events.spec.ts` — same.
- `recruiter-export.spec.ts` — fills profile + opts in + uploads resume; this one needs the fullest profile and will need the extra `updateProfile` call to satisfy threshold C.

New helper: `tests/e2e/_helpers/complete-old-profile.ts` — a one-function wrapper that given a user ID calls the server action with all the extra fields, used by any spec that needs a threshold-C profile.

---

## 4. Regression risks

### High

- **Parity smoke drift.** If `REQUIRED_PROFILE_FIELDS` in TS and the SQL function body diverge, recruiter export and event gate both break. Mitigation: hard-merge-gated smoke.
- **Existing users drop out of recruiter export silently.** Mitigation: pre/post-deploy count comparison in `05-migration-plan.md` §6.
- **"Other" major plus no `major_other_text` creates a zombie state.** User picks Other, refreshes, loses the text. Mitigation: server action rejects the combination; zod schema also rejects; form clears the text field when the dropdown goes back to a non-other value.

### Medium

- **Settings deep-links with anchors break if the settings page is restructured.** Mitigation: anchor IDs are stable strings defined once in `03-profile-completion-ring.md` §3, reused in both ring and settings page.
- **Admin broadcast / seed scripts still write the old field set.** Mitigation: grep for `class_standing:` / `interested_roles:` in `scripts/` — update any seed helpers.

### Low

- **Major dropdown queries `majors` on every profile-page render.** Cache in `app/onboarding/profile/page.tsx` via `cache()` from React 19. Revalidate when admin edits a major (rare). Fine to skip for v1; the table is tiny.
- **Ring calculation on `/profile` adds round trips.** Mitigation: single batched query or Promise.all the two extra reads (resume + profile). See `03-profile-completion-ring.md` §5.

---

## 5. Test coverage summary

| Layer | What it covers | File |
|---|---|---|
| SQL-TS parity | `is_fully_onboarded` and `loadOnboardingState` agree on the new minimum bar | `scripts/smoke-onboarding-parity.ts` |
| Recruiter threshold C | Members missing grad_year/class_standing/grad_term/interested_roles drop out of `recruiter_eligible_members` | `scripts/smoke-export.ts` additions |
| E2E happy path | OAuth → min-profile → verify → consent → dashboard ring | `tests/e2e/low-friction-signup.spec.ts` (new) |
| Existing E2E | Other specs that need a full profile use the new helper to patch extras post-signup | `tests/e2e/_helpers/complete-old-profile.ts` (new) + spec updates |
| Manual | Pre/post count comparison, bucket-A/B seed acceptance | `05-migration-plan.md` §6 |

Everything merges as one PR. Anything short of the parity smoke green is a merge blocker.
