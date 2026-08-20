# 00 — Plan Review & Canonical Decisions

Reviewed: 2026-04-21
Scope: `docs/01`–`docs/07`
Method: local synthesis + parallel agent review across product, data/security, auth, frontend, backend, and privacy

This review found that the planning set is strong in coverage but not yet safe to implement from directly. The main problem is not missing detail; it is conflicting detail. `docs/07-implementation-plan.md` is now the canonical build doc, and this review note records the highest-risk blockers and the decisions that were locked to resolve them.

## Critical blockers found

1. **Core schema drift.** `02`, `04`, `05`, and `07` describe incompatible `profiles` and `resumes` shapes. The most dangerous mismatch is `full_name` / `graduation_year` in `02` versus `first_name` / `last_name` / `school` / `grad_year` plus resume `status`/`deleted_at` flows in `05`/`07`.
2. **Consent withdrawal was not buildable.** `06` requires append-only, latest-row-wins consent history, but `02` still made `(user_id, consent_type, version)` unique. That blocks withdrawal and same-version re-enable flows.
3. **Route/funnel drift.** The docs disagreed on `/privacy` vs `/legal/privacy`, `/profile/*` vs `/profile/*`, and whether `/onboarding/consent` exists. `07` also routed stale-consent users to a page it did not actually build.
4. **OTP verification lost atomicity.** The bcrypt reconciliation in `07` split compare, consume, profile update, and audit across multiple steps, which opens race conditions and makes the “precomputed hash” RPC design incorrect.
5. **Export behavior had no single source of truth.** Preview, download, and SQL eligibility were all defined separately. The docs also disagreed on whether recruiter exports include `student_email`.
6. **Privacy/deletion gates were too soft.** The docs referenced deletion request handling, retention rules, legal pages, and export prerequisites, but the implementation plan did not turn them into concrete schema or release gates.

## Locked decisions

- `docs/07-implementation-plan.md` plus this review note are the canonical source of truth until upstream docs are aligned.
- Canonical public routes are `/`, `/login`, `/privacy`, and `/terms`.
- Canonical onboarding routes are `/onboarding/verify-email`, `/onboarding/profile`, `/onboarding/resume`, `/onboarding/consent`, and `/onboarding/done`.
- Canonical member routes are `/profile`, `/profile/profile`, `/profile/resume`, and `/profile/settings`.
- Canonical admin routes are `/admin`, `/admin/members`, `/admin/members/[id]`, `/admin/export`, `/admin/audit`, and `/admin/settings` (read-only in V0).
- V0 profile collection is limited to: `first_name`, `last_name`, `preferred_name`, `school`, `major`, `minor`, `class_standing`, `grad_year`, `grad_term`, `interested_roles`, `linkedin_url`, `github_url`, `portfolio_url`, `phone_number`, and `open_to_recruiters`, plus system/admin fields.
- V0 does **not** collect pronouns, GPA, city/location, work authorization, internship/full-time toggles, or similar sensitive/extra fields.
- `resumes` must support the actual upload lifecycle with `status`, `deleted_at`, `file_name`, `file_size`, `mime_type`, `is_current`, and `storage_path`.
- The consent ledger is append-only and latest-row-wins. Multiple rows per `(user_id, consent_type, version)` are allowed. “Latest” means `accepted_at desc, id desc`.
- V0 keeps the original five consent types only. `age_confirmation` is not locked into the consent ledger until leadership/legal explicitly approve it.
- Onboarding/auth/export gates must use derived state helpers such as `profile_fields_complete`, `has_current_resume`, `required_consents_current`, and `fully_onboarded`. Do not rely on a single overloaded `profile_completed` boolean.
- OTP issue/verify must run through one authoritative transactional path. Required invariants: one active code per `(user_id,email)`, 60-second resend cooldown, 3/15-minute send bucket, 5/15-minute verify bucket, resend invalidates prior active codes, and the UI receives precise `retryAfterMs` / `attemptsRemaining`.
- Export preview and download must use the same eligibility helper. V0 recruiter CSV excludes `google_email`, `student_email`, `phone_number`, and admin rows.
- The actual CSV download should come from a route handler, not a server action. Preview/count/filter state can still use server actions.
- Account deletion remains manual in fulfillment, but requests should be tracked in-app with an `account_deletion_requests` table and action.

## Required upstream cleanup after `07`

- `02-data-security.md`: align schema, consent uniqueness/view rules, OTP model, and export columns with the canonical contract.
- `03-auth-verification.md`: align OTP request/verify details, redirect sanitization, and the absence of a separate `school_email_verifications` table.
- `04-frontend-ux.md`: remove stale magic-link/login content, delete non-approved profile fields, and align routes with `/privacy`, `/terms`, `/profile/*`, and `/onboarding/consent`.
- `05-backend-api.md`: align action contracts, export transport, error shape, and schema assumptions with the refined plan.
- `06-privacy-compliance.md`: align export field language, retention notes, and route references with the canonical contract where needed.

## What changed in practice

The implementation plan now needs to do three things before any code is written:

1. Freeze the canonical schema and route map.
2. Make OTP and consent behavior transactional and testable.
3. Turn privacy/export requirements into concrete build steps instead of advisory notes.
