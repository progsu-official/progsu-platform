# 14.05 — Existing-User Migration Plan

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning.

---

## 1. Population

Roughly 40 existing members as of 2026-04-24. Bucket them by what they'll see on next login post-deploy.

| Bucket | Rough count | What changes for them on next login | Recruiter impact |
|---|---|---|---|
| A. Fully completed old gate + has active resume + recruiter opt-in + all threshold-C fields set | 10–15 | Nothing visible. Ring shows 10/10 and collapses to the "Profile complete" badge. Still in `recruiter_eligible_members`. | None. |
| B. Fully completed old gate + has active resume + recruiter opt-in BUT missing one of {grad_year, class_standing, grad_term, interested_roles} | 2–5 | Ring shows 9/10 or 8/10 with a CTA to fill the missing field. **Drops out of `recruiter_eligible_members` until they complete.** | Temporary loss of recruiter visibility. |
| C. Fully completed old gate, no resume | 5–10 | Ring shows 9/10 (missing resume only). Not in the recruiter view (same as today). | None — they weren't eligible today either. |
| D. Fully completed old gate, resume, no recruiter opt-in | 5–10 | Ring shows 9/10 (missing "Turn on recruiter visibility"). Not in the recruiter view (same as today). | None. |
| E. Admin | 1–2 | Admin bypass unchanged. No funnel, no ring on `/dashboard` because admins land on `/admin` first. | None. |
| F. Partially onboarded (mid-funnel when deploy happens) | 0–3 | Old nextStep evaluation finds them already complete under the new (looser) gate, bounces them to `/dashboard`. They'll see a ring reflecting whatever they actually have. | None. |

**Cost in recruiter-eligible members** is bucket B — the only bucket where a member who was in the recruiter view yesterday isn't today. See `04-recruiter-visibility.md` §4 for the numeric guideline.

---

## 2. Decision: no grandfathering

Owner confirmed: the expected behavior is that existing members see the ring at whatever their current profile satisfies. No backfill job runs to pre-fill missing fields. No banner hides the ring for pre-existing users. **They just see it.**

Tradeoff against grandfathering: we could snapshot `completed_at` at first-sight and show a 30-day grace message like "your profile is the same as it was — here's how to make it recruiter-ready". This is 40–60 lines of UI code + a `profiles.grandfathered_at` column + a cron to clear the flag. Not worth it for 2–5 members who will see a CTA that takes 10 seconds to dismiss by filling a field. Recommendation: don't grandfather.

---

## 3. Data writes triggered by the refactor

Zero bulk writes. Every change is either:
- Schema (function body, view, column addition) — see `01-schema-changes.md`.
- App code (form shape, server action branching) — see `02-auth-flow.md`.
- Copy (privacy page is NOT bumped; settings page adds anchors) — see `03-profile-completion-ring.md`.

No script walks the `profiles` table to set defaults or migrate legacy strings. If we later need a script to map legacy free-text `major` strings to `majors.slug`, that is a separate ticket; it is not required to ship this refactor.

---

## 4. Comms

**Recommendation: no proactive email.** Rationale:
- We are not bumping `privacy_policy`, so there is no consent-driven email we must send.
- The ring is self-explanatory ("N/10" + labeled nudges). Email noise creates more support volume than it saves.
- The members most affected (bucket B) get the clearest CTA in-app.

If the owner wants to send anyway, a 1-paragraph "We simplified sign-up. You can fill the rest of your profile when you want; we added a checklist on your dashboard." note is fine and can be sent from the existing admin broadcast tooling (no new template). Do not frame it as "action required". It isn't.

---

## 5. Pre-deploy checks

Run these immediately before merging the refactor to main:

1. `supabase db reset` locally → all migrations up to the new ones apply clean.
2. `pnpm db:pull` refreshes `drizzle/schema.ts`.
3. `pnpm typecheck && pnpm build` green.
4. `pnpm tsx scripts/smoke-onboarding-parity.ts` green (updated scenarios per `06-smoke-and-e2e.md`).
5. `pnpm tsx scripts/smoke-export.ts` green with the new scenarios.
6. Existing E2E suite green.
7. **Record** the current `admin_recruiter_eligible_count()` from prod (requires a read query under service_role; the admin broadcast tool has this access). Post in the PR description.
8. Existing-member acceptance test: create one seeded user matching bucket A's shape, confirm they see a 10/10 ring and stay in the export. Create one matching bucket B's shape (missing grad_year), confirm they drop out of the export and see a 9/10 ring.

---

## 6. Deploy sequence

Atomic in one PR + deploy:
1. Migrations A–E land.
2. App changes (profile form, verify-email auto-write, onboarding.ts parity, ring component, settings anchors) land in the same commit.
3. Vercel deploy.
4. Within 5 minutes post-deploy: run `admin_recruiter_eligible_count()` and confirm it's within ±30% of the pre-deploy number. If it's dropped more than 30%, **pause**: either the migration is stricter than expected or a bucket assumption was wrong. Don't roll back unless users are actively being blocked; instead, patch by weakening threshold C to option B in a follow-up migration.

There is no feature flag for this change because it touches `is_fully_onboarded()` — a flag would create a states-differ problem between old and new code paths reading the same function. If we need a kill switch, it's the rollback migrations in `01-schema-changes.md` §6.

---

## 7. Monitoring

- Watch the dashboard-load endpoint for latency regressions — the ring adds a few queries to `/dashboard`. Acceptable budget: +50ms P50.
- Watch the profile-form submission error rate on `/onboarding/profile` — the new major-dropdown + other-text validation is the most likely source of new error_codes. Expected: near zero after the first hour.
- Watch `admin_recruiter_eligible_count()` daily for the first week. The number should climb back toward the pre-migration baseline as members fill their rings.
