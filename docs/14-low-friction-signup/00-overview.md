# 14 — Low-Friction Signup Overview

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning. No code yet. This doc is canonical when it conflicts with anything in `docs/07-implementation-plan.md` §1.1 re: onboarding. Other canon (auth model, consent ledger, recruiter export) is unchanged.

---

## 0. Why

The platform is becoming the default host for event sign-ups. Every friction point in the current member funnel (7 required profile fields + roles picker + resume + 3 consents) creates RSVP-time drop-off. We are cutting the signup bar to the minimum viable identity + safety set, and moving the rest into a **profile-completion ring** on the dashboard.

Recruiter export eligibility is **tightened**, not loosened — full recruiter visibility now requires a 100% complete profile. This is intentional.

---

## 1. New hard signup gate (unchanged = kept as gate; new = change vs today)

| Field | Status | Source | Notes |
|---|---|---|---|
| Google OAuth | unchanged | `auth.callback` → `handle_new_user()` | |
| Verified .edu student email | unchanged as surface | `/onboarding/verify-email` | Still soft for the platform; remains a hard prereq for recruiter export. Minor new side-effect: verification auto-populates `profiles.school`. |
| `first_name`, `last_name` | unchanged (kept in gate) | profile form | Google prefills, user can edit. |
| `phone_number` | unchanged (kept in gate) | profile form | Kept per 2026-04-22 owner call. |
| `major` | **CHANGED** | profile form | Free-text → dropdown of ~20 canonical majors + "Other" → free text. |
| `privacy_policy`, `terms_of_service`, `age_confirmation` consents | unchanged | `/onboarding/consent` | Owner confirmed these stay as a hard gate. |

### Dropped from hard gate (moved to ring)

- `class_standing`
- `grad_year`
- `grad_term`
- `interested_roles` (was required non-empty array)
- `school` is still required, but auto-populated by verify-email (no user action)
- Resume (already soft since `20260426000200`)

### Stays optional (no change)

- `preferred_name`, `minor`, `linkedin_url`, `github_url`, `portfolio_url`, `open_to_recruiters`.

Result: the forced signup journey drops from "OAuth → verify (skippable) → 12-field profile form → resume → 3 consents" to "OAuth → minimal 4-field profile (name/phone/major) → verify email (writes school) → 3 consents". Count of required human keystrokes: ~4 fields + verification code + 3 checkboxes.

---

## 2. Profile-completion ring

- A circular progress control on `/profile` showing `N/M` completed optional-recommended fields.
- Each missing field = one nudge line with a CTA that deep-links to the relevant settings section.
- Visual only — the actual recruiter gate is enforced server-side in `public.recruiter_eligible_members`.
- **Threshold for recruiter visibility = 100% (option C).** Strict on purpose. A recruiter-visible card must have: resume active, `grad_year`, `class_standing`, `grad_term`, `interested_roles` (≥1), and the existing `open_to_recruiters` + `recruiter_resume_sharing` consent. LinkedIn / GitHub / portfolio stay optional even for recruiter eligibility (signal, not gate).
- Full field weighting + ordering in `03-profile-completion-ring.md`.

---

## 3. What we are NOT changing

- Events platform (R1/R2/R3): **superseded 2026-08-21** — see note below. The new minimal profile still satisfies `fullyOnboarded` required by event RSVP gates for signed-in members — the member-side events layer reads the same contract.
- Consent ledger: still append-only, still 5 types, still versioned. Do not add a new `consent_type_t` value (CLAUDE.md rule #8).
- Auth model for members: Google OAuth only; Supabase SSR session refresh; no magic links. **Unchanged for members** — see superseding note below for the separate guest path.
- Admin onboarding bypass: admins still skip the member funnel.
- `recruiter_eligible_members` view: same RLS posture, still the single source of recruiter visibility, just with three new required columns in the join condition.

> **Superseded 2026-08-21:** event RSVP no longer requires any account or Google sign-in. A visitor can now RSVP with just name/email/phone via a new account-free guest path (`public.event_guest_rsvps` table, `guest_rsvp_to_event()` RPC), running in parallel with the member path described in this doc. This overrides "Events platform: untouched" and the auth-model bullet above insofar as it applies to guests, not members — the Google-OAuth-only member funnel this doc describes is otherwise unchanged. See `supabase/migrations/20260821010000_guest_event_rsvp.sql` for the implementation and its own header comment for the full rationale.

---

## 4. Privacy-policy impact

The change that *could* trip reconsent: we are going to persist `school` on verify-email as an automatic side-effect. This is data we already collect on the profile form — it's just being set earlier via a system-triggered write. This is not a new data surface exposed to peers, so **no privacy bump is required** on this ground alone.

The dropdown-ified `major` and the new `majors` lookup table do not change what is shown peer-visibly either (major is already in R2 member-card projection per `docs/10`).

Decision: **no privacy bump in this refactor.** If during implementation we discover we must expose a new peer-visible field (e.g. surfacing "completing your profile?" status to others), that triggers the bump path in `CLAUDE.md` rule #8 and should stop the refactor until the new version is cut.

---

## 5. Existing-member migration

No grandfathering. Every existing member will see the ring at whatever completion they currently have. Typical existing profile = fully filled today = 10/10 ring (or near it) because everything we are removing from the hard gate was already required to reach `fullyOnboarded`. Only edge case: members who completed the old gate but have not uploaded a resume will see "9/10" and won't be recruiter-eligible. They already aren't recruiter-eligible today, so no regression.

Detailed migration table in `05-migration-plan.md`.

---

## 6. Open questions the user should push back on

Pick-a-fight list:

1. **Is the 100% recruiter threshold too strict?** It means a member who wants to be seen must upload a resume, have `grad_year`, `class_standing`, `grad_term`, and at least one `interested_role`. If we lose recruiter-eligible members over "I haven't picked grad term yet" we should consider option B (partial threshold: resume + grad_year + class_standing, drop interested_roles from the eligibility gate and only use it for recruiter filtering). Recommendation: ship option C, revisit after 30 days with numbers.
2. **Does verify-email auto-writing `school` create a footgun?** If the user verifies one email, later gets added to a second-school allowlist, and re-verifies with a new address, should `school` auto-overwrite? Recommendation: yes, last verified email wins; document in the copy.
3. **Should "Other" majors be free-text or admin-reviewed?** Free-text is faster but creates a long tail. Recommendation: free-text, snapshot `major_other_text` alongside a `major` slug of `other`. Cheap to add admin curation later.
4. **Are `class_standing`, `grad_year`, `grad_term` three separate nudges or one grouped "Tell us when you're graduating" CTA?** Grouping is better UX (~1 screen fills 3 fields) but increases the nudge line copy complexity. Recommendation: three distinct ring slots but one settings section that collects all three at once.
5. **Do we need to announce this change to existing members via email?** Recommendation: no. The ring is self-explanatory and low-stakes; email creates noise. Only send if we bump `privacy_policy` (we are not).
6. **Should the phone number step live in verify-email or in the minimal profile form?** Currently in profile. Moving to verify-email couples phone to the student-email step (both are "prove identity"). Recommendation: leave in profile — phone is a contact channel, not an identity claim.
