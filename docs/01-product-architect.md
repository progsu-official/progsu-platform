# Progsu Member Platform — Product Architecture (V0)

Owner: Product Architect agent
Last updated: 2026-04-21
Status: V0 design, pre-build

---

## 1. V0 Product Summary

Progsu Member Platform is an internal CRM for a student programming/builders organization at Georgia State University. It captures verified student members (Google login + 6-digit OTP to a school email), stores a structured member profile with resume, and gates a recruiter-ready CSV export behind explicit consent. The primary users are **student members** who join once and maintain a single canonical profile, and **Progsu admins/officers** who need to see who their members are, filter them, and hand a recruiter a clean list of opted-in candidates. Success in V0 = (a) 150+ GSU student members complete a verified profile, (b) admins can export a recruiter CSV in under 60 seconds, (c) zero accidental disclosure of members who did not consent to recruiter sharing.

---

## 2. V0 Scope

**IN V0:**
- Google OAuth login (identity only).
- School email OTP verification via Resend (separate flow from login).
- Configurable allowlist of school domains (seeded: student.gsu.edu, gsu.edu, gatech.edu, emory.edu, uga.edu, kennesaw.edu).
- Single-page profile editor with all locked-in fields.
- Resume upload to Supabase Storage (one current resume per member; prior versions retained but not surfaced).
- Versioned consent ledger (privacy_policy, terms_of_service, recruiter_resume_sharing, email_marketing, sms_marketing).
- Phone collection + SMS consent capture (no SMS sending in V0).
- Member dashboard showing profile completion state and current consents.
- Admin console: list, search, filter, view detail, mark manual verification, export recruiter CSV.
- `is_admin` flag seeded via SQL; admin-only routes guarded server-side.
- Transactional emails via Resend: OTP code, welcome, resume-updated confirmation.
- Audit log for admin-sensitive actions (CSV export, manual verification, impersonation-like views).

**OUT of V0 (explicit scope-creep guard):**
- Any public member directory.
- Recruiter-facing portal or login.
- Event attendance / check-ins.
- Email blasts / SMS blasts / segmented marketing.
- Referral or invite tracking.
- LinkedIn/GitHub scraping or enrichment.
- Automatic verification based on Google domain (Google email and school email are intentionally decoupled).
- Multi-chapter / multi-org tenancy.
- Mobile native app.
- Rich resume parsing (we store the file; we do not extract skills).
- In-app messaging or DMs.
- Payment / dues collection.

Push-back calls flagged below in Section 10 (Open Questions) and inline where relevant.

---

## 3. User Personas

### Persona A — Student Member ("Maya", junior CS at GSU)
- Logs in with her personal Gmail (which she uses for GitHub too).
- Has a `student.gsu.edu` school email she checks weekly.
- Wants to "get on the list" in under 5 minutes, upload her resume, and not think about Progsu admin again until a recruiter reaches out.
- Cares that her resume is only shared when she says so.
- Updates her resume ~2–4 times per year.

### Persona B — Progsu Admin/Officer ("Devon", org president)
- Signs in with his Progsu-issued or personal Google account that has been flagged `is_admin` in the DB.
- Runs weekly officer meetings; needs a source-of-truth of "who is actually a member right now."
- Must produce a recruiter CSV on 24 hours notice for partner companies, filtered by role interest and grad year.
- Occasionally verifies a member manually when OTP delivery fails (e.g., a school email that bounces).
- Does NOT want to manage consents by hand; trusts the system to enforce gating.

### Persona C — Recruiter (future, NOT in V0) ("Priya", university recruiter at a mid-size tech co)
- Never logs into the platform in V0.
- Receives a CSV from a Progsu officer with only consented, verified students who are open to recruiters.
- In later versions: logs into a recruiter portal, filters candidates live, downloads resumes.
- V0's job is to NOT paint us into a corner for her.

---

## 4. User Journeys

### 4.1 New student sign-up
1. Student lands on `/` (marketing one-pager) and clicks "Join Progsu".
2. Redirected to `/login`, clicks "Continue with Google". Supabase Auth completes OAuth.
3. On first login, a `profiles` row is created with `profile_completed = false`, `student_email_verified = false`.
4. Student redirected to `/onboarding/verify-school-email`. Enters a school email; client-side and server-side check domain against allowlist.
5. Server generates a 6-digit numeric OTP, stores a hashed copy + expiry (10 min), sends via Resend to the school email. Rate-limited to 3 sends per 15 min per user.
6. Student enters code. On success, row written to `school_email_verifications` with verified timestamp; profile flipped to `student_email_verified = true`.
7. Student redirected to `/onboarding/profile`. Fills: first_name, last_name, school (pre-filled from domain where possible, editable), grad_year, major, class_standing, interested_roles (multi), linkedin_url, github_url, portfolio_url, phone_number.
8. Student redirected to `/onboarding/resume`. Uploads PDF (max 5 MB, PDF only). Stored in Supabase Storage under `resumes/{user_id}/{timestamp}.pdf`; `profiles.resume_url` updated.
9. Student redirected to `/onboarding/consent`. Four checkboxes:
   - [required] Privacy Policy v1
   - [required] Terms of Service v1
   - [optional] Share resume with Progsu recruiter partners (recruiter_resume_sharing v1)
   - [optional] Email updates from Progsu (email_marketing v1)
   - [optional] SMS updates from Progsu (sms_marketing v1) — grayed if no phone entered
   Also a toggle: "Open to recruiters right now" (`open_to_recruiters`), which is separate from the consent and can be flipped any time.
10. On submit, each accepted consent becomes a `consents` row with version string. `profile_completed` flips true. Redirect to `/profile`.

### 4.2 Returning student (login + resume update)
1. Student goes to `/login`, clicks Google.
2. Supabase session established. Middleware loads `profile`. If `profile_completed = false` or `student_email_verified = false`, redirect into the missing onboarding step.
3. Otherwise redirect to `/profile` which shows: verified status, current consents with dates, current resume filename + uploaded date, recruiter-export eligibility banner (green/amber with reason).
4. To update resume: click "Replace resume" on `/profile` or go to `/profile/resume`. Upload flow replaces `resume_url` and writes a `resume_history` row pointing to the old object. Email confirmation sent via Resend.
5. To change consents: `/profile/consents` shows current state; any new checkbox click writes a fresh `consents` row (versioned). Revoking recruiter_resume_sharing immediately removes the student from future CSV exports (never retroactively deletes prior exports, which are logged).

### 4.3 Admin daily workflow
1. Admin signs in via Google at `/login`. Middleware detects `is_admin = true`, allows `/admin/*` routes.
2. `/admin` landing page shows tiles: Total members, Verified members, Recruiter-eligible, Pending manual verification.
3. Admin clicks "Members" → `/admin/members`. Default table columns: name, school, grad_year, major, verified, open_to_recruiters, resume?, updated_at. Paginated at 50/page.
4. Search bar (client-side debounced, server-side ILIKE on first_name, last_name, school email). Filters (sidebar or top bar):
   - grad_year: dropdown of 2024–2030.
   - school: multi-select from allowlist.
   - interested_roles: multi-select chips.
   - verified: all / verified / unverified.
   - open_to_recruiters: all / yes / no.
   - has_resume: all / yes / no.
5. Admin clicks a row → `/admin/members/{id}`. Sees full profile, consent history (latest version per type + timestamp), resume preview (signed URL, 5-min TTL), manual-verification button.
6. Manual verification: admin types a reason, clicks confirm. Writes `profile.student_email_verified = true`, writes `manual_verifications` audit row with admin id, reason, timestamp.
7. Export recruiter CSV: `/admin/export`. Admin picks filters (defaulted to recruiter-export gating). Clicks "Preview" (shows count + first 5 rows with PII partially masked). Clicks "Download CSV". Server re-checks gating per row, writes `exports` audit row with filters, row count, exporter id. CSV includes: first_name, last_name, school, grad_year, major, class_standing, interested_roles, linkedin_url, github_url, portfolio_url, resume_signed_url (24-hour expiry). No phone or email unless `email_marketing` consent is explicitly checked (V0 default: no email/phone in CSV — see Section 10 Q2).

---

## 5. Page List for V0

### Public
- `/` — Marketing one-pager: who we are, "Join" CTA. One sentence: landing + login entry.
- `/login` — Google OAuth entry point with a single "Continue with Google" button.
- `/privacy` — Static privacy policy (versioned, v1 linked from consent).
- `/terms` — Static terms of service (versioned, v1 linked from consent).
- `/auth/callback` — Supabase OAuth callback handler; creates profile row if absent; routes forward.

### Member (requires Supabase session)
- `/onboarding/verify-school-email` — School email entry + OTP challenge.
- `/onboarding/profile` — First-time profile fields form.
- `/onboarding/resume` — First-time resume upload.
- `/onboarding/consent` — First-time consent acceptance + recruiter toggle.
- `/profile` — Member home: verification status, consents summary, resume status, recruiter-export eligibility, edit links.
- `/profile` — Edit profile fields (same form as onboarding, populated).
- `/profile/resume` — Replace current resume; show upload date of current.
- `/profile/consents` — Granular consent management + `open_to_recruiters` toggle.
- `/profile/account` — Connected Google email, verified school email, sign-out, "request data deletion" mailto (manual in V0).

### Admin (requires session AND `is_admin = true`)
- `/admin` — Overview tiles and quick links.
- `/admin/members` — Paginated member table with search + filters.
- `/admin/members/[id]` — Member detail + consent history + resume preview + manual-verify action.
- `/admin/export` — Recruiter CSV export wizard with preview and audit.
- `/admin/audit` — Read-only audit log: exports, manual verifications, admin views.
- `/admin/settings` — Read-only view of allowlist domains and current consent versions (edited via migration in V0).

### API routes (Next.js route handlers, not "pages" but part of the surface)
- `POST /api/otp/send` — Issue OTP to a school email.
- `POST /api/otp/verify` — Verify OTP.
- `POST /api/profile` — Upsert profile.
- `POST /api/resume/upload` — Signed-URL issuance for Supabase Storage.
- `POST /api/consents` — Append consent row.
- `POST /api/admin/manual-verify` — Admin-only.
- `POST /api/admin/export` — Admin-only CSV.

---

## 6. Feature Priority Table

Priority levels: **Must** (ships V0, non-negotiable), **Should** (ships V0 if time), **Could** (nice-to-have, bump if slipping), **Defer** (explicitly post-V0).

| # | Feature | V0 Priority | Why |
|---|---------|-------------|-----|
| 1 | Google OAuth login | Must | Identity foundation; lowest-friction for students. |
| 2 | 6-digit OTP to school email via Resend | Must | Decoupling student status from personal Gmail is the core integrity claim. |
| 3 | School-domain allowlist (configurable in code, not UI V0) | Must | Prevents noise from non-student sign-ups. |
| 4 | Profile fields per spec | Must | CSV export is worthless without structured data. |
| 5 | Interested roles multi-select (12 options) | Must | Primary recruiter filter axis. |
| 6 | Resume upload (PDF, ≤5 MB) | Must | The artifact recruiters actually want. |
| 7 | Resume history (old files retained, not surfaced) | Should | Cheap now; rescues us if a student overwrites and regrets. Recommend Must — storage is near-free. |
| 8 | Versioned consents (5 types) | Must | Legal posture; changing policy later must not invalidate old acceptances. |
| 9 | Recruiter-export gating (4 conditions AND'd) | Must | The single highest-risk correctness bug if wrong. |
| 10 | `open_to_recruiters` toggle distinct from consent | Must | Consent is durable intent; toggle is "am I available right now." Collapsing them would be wrong. |
| 11 | Admin member list with search + filters | Must | Core admin utility; without it the CRM isn't a CRM. |
| 12 | Admin member detail page | Must | Needed for manual verification and consent inspection. |
| 13 | Manual verification action with reason + audit | Must | OTP WILL fail for some students; we need a release valve. |
| 14 | Recruiter CSV export with preview + audit | Must | This is the output of V0. |
| 15 | Audit log page | Should | Can live as a table admins read via Supabase SQL in worst case, but UI is small and de-risks trust. |
| 16 | Email: OTP, welcome, resume-updated | Must (OTP), Should (others) | OTP is blocking; the other two build habit. |
| 17 | Rate limiting on OTP send/verify | Must | Abuse prevention + Resend bill protection. |
| 18 | Signed resume URLs (short TTL) in admin + CSV | Must | Prevents permanent link leakage. |
| 19 | Profile completion gating (middleware) | Must | Keeps dashboard clean; forces onboarding finish. |
| 20 | `is_admin` SQL-seeded flag | Must | Simplest possible admin model for V0. |
| 21 | Data deletion on request (manual via admin) | Should | GDPR-ish hygiene even at small scale; a deletion button is a day of work. Recommend Must. |
| 22 | Public member directory | Defer | Out; explicit non-goal. |
| 23 | Event attendance / check-ins | Defer | Post-V0; see roadmap. |
| 24 | SMS blasts | Defer | Consent collected in V0, nothing sent. |
| 25 | Email marketing blasts | Defer | Consent collected, nothing sent. |
| 26 | Recruiter portal (login, live filter) | Defer | CSV is sufficient for V0 partner flow. |
| 27 | LinkedIn/GitHub scraping enrichment | Defer | Requires explicit consent type we haven't drafted. |
| 28 | Multi-chapter tenancy | Defer | Premature; single org. |
| 29 | Dark mode / theming | Could | Tailwind makes it cheap; skip unless free. |
| 30 | Internationalization | Defer | GSU-only in V0. |

---

## 7. Deferred Roadmap

For each deferred feature: when it becomes relevant, and what V0 must NOT preclude.

### Event attendance
- **When:** V1, once we've had 3+ meetings on the platform and officers ask for a check-in sheet.
- **V0 must not preclude:** Schema should have a `members` (profile) table that can be joined to a future `events` / `event_attendance` table without churning the profile table. Use stable UUID PKs.

### Recruiter portal
- **When:** V2, after 2–3 partner recruiters have used CSV and asked for self-serve.
- **V0 must not preclude:** Consent type `recruiter_resume_sharing` is already separate from anything portal-specific. `profiles.open_to_recruiters` is already a first-class field. Resume signed-URL issuance should be a reusable server function, not inlined into the CSV endpoint.

### Resume book generation (PDF compilation of consented resumes)
- **When:** V1.5, before a careers fair.
- **V0 must not preclude:** Resume storage path is per-user and stable; adding a batch-fetch job is straightforward.

### Segments (saved admin filters)
- **When:** V1, when admins repeatedly construct the same filter.
- **V0 must not preclude:** Keep the admin filter state URL-query-driven (GET params) so "save this view" is just persisting the URL.

### Email blasts / SMS blasts
- **When:** V2, after we actually have something to send.
- **V0 must not preclude:** Consents are already separate per channel (email_marketing vs sms_marketing) and versioned. No change needed.

### Referral tracking
- **When:** V1, if growth stalls.
- **V0 must not preclude:** Add a nullable `referred_by_user_id` UUID on profiles day 1 — cost is trivial and retrofitting is painful after accounts exist. **Recommend adding to V0 schema even if unused in UI.**

### Major enrichment (taxonomy / fuzzy match)
- **When:** V1, once admins notice 30 variants of "Computer Science".
- **V0 must not preclude:** Store `major` as free text plus a future `major_canonical_id` FK (nullable). Do not enforce canonical majors at write time in V0.

### GitHub/LinkedIn scraping (consent-gated)
- **When:** V2.
- **V0 must not preclude:** A separate consent type will be added; schema allows arbitrary new consent type strings. Do not hardcode the existing 5 types as an enum in the DB — use a text column with a CHECK constraint only if needed, or a reference table.

### SSO/SAML, InCommon
- **When:** V3+, only if a partner school requires it.
- **V0 must not preclude:** Use Supabase Auth abstraction; don't write app logic that assumes "user_id came from Google." The rest of the app should care only about `auth.users.id`.

### Multi-chapter
- **When:** V3+.
- **V0 must not preclude:** Add a nullable `org_id` column on `profiles` and other core tables? **Recommend NOT** — premature, and adds RLS complexity. Accept the cost of a one-time migration if multi-chapter happens.

---

## 8. Non-Goals (Explicit V0 Exclusions)

- No public member directory of any kind. Profile visibility is to self + admin only.
- No auto-verification based on Google's `hd` (hosted domain) claim or email domain. Even a `@student.gsu.edu` Google login must still complete the 6-digit OTP flow to a school email — deliberately redundant by design, because (a) personal Gmail with a `.edu` alias is real, and (b) OTP-to-mailbox is the actual proof.
- No resume parsing, skill extraction, or ranking.
- No in-app messaging between members, between admins, or to recruiters.
- No automated email/SMS sending beyond transactional (OTP, resume-updated, welcome).
- No payments, dues, or merch.
- No member self-deletion button in V0 — handled via admin action on request (documented in `/profile/account` as an email link).
- No API for external systems to read member data.
- No "forgot my school email" recovery flow beyond "ask an admin" — Progsu is small enough for V0.
- No bulk admin actions in V0 (no mass-delete, mass-email, mass-verify).

---

## 9. Flags on the Spec (Risks / Recommendations)

These are places the locked-in spec feels risky or ambiguous. Brief, with a recommendation:

1. **"Configurable" school domains:** The locked-in list mentions "configurable" but we have no admin UI for it in V0. Recommend: ship domains as a code constant / env var in V0; `/admin/settings` is read-only. Defer UI editing to V1. Flagged but not re-opening.
2. **Phone without SMS:** We collect `phone_number` and `sms_marketing` consent but send no SMS. Risk: we're collecting PII we can't use. Recommend: make phone optional at profile creation; only required if `sms_marketing` is checked.
3. **`is_admin` via SQL seeding only:** Fine for V0 but unrecoverable if the sole seeded admin loses their Google account. Recommend: document in a runbook that at least two admins are seeded day 1.
4. **Email/phone in recruiter CSV:** Spec doesn't state whether emails/phones go in the CSV. Recommend V0 default: exclude contact info, include only the resume signed URL — recruiters contact through whatever channel the student's resume lists. Surface as Open Question.
5. **Resume history retention forever:** Storage is cheap, but we should document a policy. Recommend: keep 3 versions, soft-delete older. Minor.
6. **Consent versioning strategy:** Spec says "versioned" but doesn't define what a version bump means. Recommend: a version bump (e.g., privacy_policy v1 → v2) requires all members to re-accept on next login before any gated action. Flag to legal-minded stakeholder before launch.

---

## 10. Open Product Questions

These should be answered before implementation, or during, but not silently.

1. **Q1 — Is admin impersonation / "view as member" needed in V0?**
   Recommendation: No. Admin detail page is sufficient; impersonation is a security surface we don't need.

2. **Q2 — Does the recruiter CSV include email and phone, or only name + links + resume URL?**
   Recommendation: Only resume URL + profile links in V0. Treat direct contact info as a separate V1 feature gated on an additional consent ("share contact info with recruiters").

3. **Q3 — What exactly happens when a member revokes `recruiter_resume_sharing`?**
   Recommendation: Immediate removal from future exports; prior CSV exports are not recalled (logged in audit); student sees a confirmation page explaining this. Need legal sign-off on copy.

4. **Q4 — Grad year range for the dropdown: hardcode 2024–2030, or compute current year + 6?**
   Recommendation: Compute dynamically (current year − 1 through current year + 6) so the app doesn't rot. Small decision but easy to get wrong.

5. **Q5 — School-email OTP: lock a verified school email to the account forever, or allow re-verification later (e.g., student transfers schools)?**
   Recommendation: Allow re-verification but require OTP to new domain; log the change in an audit trail; recruiter-export eligibility uses the most recently verified school email. Pushback if product wants one-shot lock — students transfer.

6. **Q6 — Should `class_standing` be a free text or enum?**
   Recommendation: Enum (Freshman, Sophomore, Junior, Senior, Grad, Alumni, Other). Free text will produce 40 variants of "Senior" and break filters.
