# 14.04 — Recruiter Visibility Changes

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning.

---

## 1. Current gate (as of `20260421070500_recruiter_export.sql`)

A profile appears in `public.recruiter_eligible_members` iff ALL of:

- `profiles.student_email_verified = true`
- `profiles.open_to_recruiters = true`
- `profiles.is_archived = false`
- `profiles.is_admin = false`
- Exactly one row in `resumes` with `is_current = true AND status = 'active'`
- Latest row of `consents` of type `recruiter_resume_sharing` has `accepted = true` and `version = current consent_versions.version`

No gate on grad_year, class_standing, grad_term, interested_roles, or any profile-completeness proxy. Members with `open_to_recruiters = true` and a resume appear, period.

---

## 2. New gate (threshold C)

Add to the `WHERE` of the view (see `01-schema-changes.md` §5 for the SQL):

- `grad_year IS NOT NULL`
- `class_standing IS NOT NULL`
- `grad_term IS NOT NULL`
- `cardinality(interested_roles) > 0`

Column list of the view is unchanged. Grants are unchanged (only `service_role` can `SELECT`, admins read via `admin_recruiter_eligible_count()` RPC and the export route).

`major` is NOT in the new gate because the hard signup gate already requires it, so every row that passes the existing `student_email_verified` conjunct already has `major` non-null (unless it was set before verify-email auto-populate; see §5).

---

## 3. Why threshold C

Option A (no change) = recruiters get profiles missing key filterable attributes. Hurts recruiter UX.
Option B (resume + grad_year + class_standing only) = lets a profile without roles or grad term slip through. Recruiters already filter by graduation window and role interest — the CSV export we give them is just "a list they could copy into a sheet". Giving them rows with blank columns creates friction.
Option C (all four new conjuncts) = strict, matches what a recruiter actually pulls the export to filter by.

Tradeoff: strictness means some currently-eligible members will drop out of the next export until they complete the ring. Estimated impact: see §4.

---

## 4. Expected member count delta

Without running live queries, estimated counts:

- Current members: ~40.
- Current `recruiter_eligible_members` count (estimate): likely 10–20, since `open_to_recruiters` is opt-in and many members skip it.
- Post-migration count: likely to drop by 2–5 rows (members who opted in and have a resume but missed one of the four new required fields).

The refactor should capture a **before-migration snapshot** (`select count(*) from recruiter_eligible_members` via `admin_recruiter_eligible_count()`) and a **post-migration snapshot** on the same day. Delta > 30% is a signal we should weaken threshold C to option B in a follow-up migration. Record the two numbers in the PR description.

---

## 5. Edge case: members with legacy free-text `major`

Members who completed their profile before `school` was auto-populated by verify-email may have `school` set and `major` as a free-text value. None of these exit the view — the added conjuncts don't touch `major` or `school`. No action needed.

Members who never verified their student email still aren't in the view (the `student_email_verified` conjunct already blocks them). No change.

---

## 6. Admin UI impact

### `/admin/export` (recruiter CSV preview/download)

- Preview page reads `admin_recruiter_eligible_count()` — no API change needed, just displays a smaller number.
- CSV download reads the view directly — also no API change.
- Consider adding a small info row on the preview page: "Requires resume, verified email, grad year, class standing, grad term, at least one role, and recruiter opt-in." This is documentation only, not a feature flag.

### `/admin/members/[id]` detail

The existing member detail panel already shows profile fields and eligibility status. Add a one-line indicator: if a member has `open_to_recruiters = true` but fails threshold C, show `Missing for export: {field list}`. Uses the same `loadProfileCompletion()` helper from `03-profile-completion-ring.md` §5 — we already compute the same booleans.

---

## 7. Smoke tests

### `scripts/smoke-export.ts` (existing — needs update)

Scenarios to add:

1. Member with everything except `grad_year` null → assert NOT in `admin_recruiter_eligible_count()` and NOT in the CSV rows.
2. Member with everything except `class_standing` null → same assertion.
3. Member with empty `interested_roles` array → same assertion.
4. Member with `grad_term` null → same assertion.
5. Member with all four threshold-C fields AND resume AND consent → IS in the view (regression check for the happy path).
6. Existing scenario (no resume) → unchanged: NOT in the view.

Each scenario builds a fresh user via `admin.auth.admin.createUser` per the pattern in the existing smoke. Tear down in `finally`.

### New smoke: `scripts/smoke-recruiter-threshold.ts`

Not strictly required — the scenarios above can live in `smoke-export.ts`. Add a standalone smoke only if the scenarios there start to conflict or become hard to reason about (> ~10 scenarios).

---

## 8. Rollback posture

Reverting is one migration (see `01-schema-changes.md` §6 Step E). The view signature doesn't change, so `admin_recruiter_eligible_count()` and the CSV export route need no app-side changes on rollback. A 30-second op.
