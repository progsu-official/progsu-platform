# Progsu Member Platform — Privacy & Compliance Review (V0)

Owner: Privacy & Compliance Reviewer agent
Last updated: 2026-04-21
Status: V0 pre-build review; binds to product spec `01-product-architect.md`

> **Disclaimer.** This document is an engineering/product review, not legal advice. Before the first recruiter CSV leaves Progsu's hands, a licensed attorney familiar with U.S. student-data and marketing law should review the privacy policy, ToS, consent copy, and the recruiter data-sharing arrangement. The author is not your lawyer.

---

## 1. Legal framing

Progsu is a registered student organization at Georgia State University, not a division of the university and not a contracted service provider to it. The records we collect (profile, resume, consents) are created by students directly in our app and stored on our infrastructure. **FERPA likely does not apply** to these records, because FERPA governs "education records" maintained by an educational institution or a party acting on its behalf; a voluntary student-org CRM is neither. That said, GSU has its own student-org and data-handling policies, and anything we do that looks like we are acting on GSU's behalf (e.g., using a `@gsu.edu` domain, co-branded recruiting events) can blur that line. We should align with GSU's student-org handbook and avoid claims that imply university endorsement.

Laws that do plausibly apply: **CAN-SPAM** (any marketing email we send later must have an unsubscribe, physical address, and truthful From/Subject headers), **TCPA** (any SMS marketing — even one message — requires prior express written consent for marketing content, which is why `sms_marketing` is its own consent type and phone is not "always collected and used"), and state UDAP-style laws reading on false or misleading consent UX. **COPPA** almost certainly does not apply (we do not target under-13s and GSU enrollment rules make under-13 accounts effectively impossible). **GDPR/CCPA/CPA** are unlikely to bite us (our population is U.S. college students in Georgia), but their defaults — purpose limitation, access/deletion rights, honest consent, no dark patterns — are good defaults and we should adopt them as engineering hygiene. **Before the first recruiter export leaves Progsu's hands to an external company, a lawyer should review the privacy policy, ToS, consent copy, and the recruiter data-sharing agreement.**

---

## 2. Data inventory

| Field | Purpose | Sensitivity | Shared with recruiters? | Retention | Notes |
|---|---|---|---|---|---|
| `auth.users.id` (UUID) | Stable identity | Low | No | Lifetime of account | Supabase-managed |
| `google_email` | Login identity, identity reconciliation | Medium (PII) | **No** | Lifetime of account | Admin UI shows it; recruiter CSV does not |
| `student_email` | Prove current student status | Medium (PII) | Yes (recruiter contact channel) | Lifetime of account | Only once verified via OTP |
| `first_name`, `last_name` | Identity, personalization, recruiter match | Medium (PII) | Yes | Lifetime | Rename permitted |
| `phone_number` | SMS marketing only (V0 collects, doesn't send) | Medium (PII) | **No** | Lifetime (but see §3) | Not in recruiter CSV. Consider not collecting unless SMS consent is on |
| `school` | Recruiter filter | Low | Yes | Lifetime | Allowlist-bounded |
| `grad_year` | Recruiter filter; retention trigger | Low | Yes | Lifetime (V0); see §9 | Future auto-archive hook |
| `major` | Recruiter filter | Low | Yes | Lifetime | Free text V0 |
| `class_standing` | Recruiter filter | Low | Yes | Lifetime | Enum |
| `interested_roles` | Recruiter filter | Low | Yes | Lifetime | Multi-select |
| `linkedin_url`, `github_url`, `portfolio_url` | Recruiter match | Low (public-ish) | Yes | Lifetime | User provides |
| Resume PDF (Storage object) | Recruiter artifact | **High** (free-form; may contain address, DOB, SSN if user included) | Yes, via 15-min signed URL | Current kept; prior versions retained (§9) | Private bucket; never public |
| `open_to_recruiters` (bool) | Eligibility toggle | Low | Indirectly (gating) | Lifetime | Not itself exported |
| `is_admin` (bool) | Access control | Low | No | Lifetime | SQL-seeded |
| `student_email_verified` (bool + ts) | Gating | Low | No | Lifetime | |
| `consents` rows (type, version, ts, ip, ua) | Legal audit | Medium | No | Retained indefinitely (audit value) | See §9 for deletion redaction |
| `school_email_verifications` (OTP hash, ts) | Anti-abuse | Medium | No | 90 days rolling | Purge old |
| `audit_log` (admin action, actor, target, ts) | Security audit | Medium | No | 2 years | See §9 |
| `resume_history` (old storage keys) | Rescue accidental overwrites | High | No | 3 versions max (§9) | |

**Fields explicitly NOT collected in V0 (and never should be added silently):** date of birth, home address, gender, race/ethnicity, citizenship status, SSN, GPA as a field, parent/guardian info. The spec does not include these; this doc locks that in.

---

## 3. Data minimization recommendations

1. **Phone number is optional at profile creation** and should only be required when the user enables `sms_marketing` consent. If collected earlier, treat it as "captured but not usable" — no process may read `phone_number` unless a current `sms_marketing` consent row exists for that user. Enforce in code (helper function `canUsePhoneForSms(user_id)`), not in trust.
2. **Never collect** DOB, home address, SSN, GPA, gender, race/ethnicity, citizenship, parent/guardian info. Confirm the DB schema review (agent 03) does not sneak these in.
3. **`google_email` stays out of the recruiter CSV.** It exists in admin UI for identity reconciliation (two students claiming the same name, resetting OTP delivery), which is a legitimate admin-only purpose. Recruiters have no reason to see a student's personal Gmail.
4. **Free-text `major`** is acceptable minimization — less structured data than an enum, trivially editable by the user. Do not enrich it from a third party in V0.
5. **Resume contents** are free-form and therefore high-sensitivity by default — we do not parse them, but we should warn at upload time (§10 risk R3) that the student should not include SSN, DOB, or home address.
6. **Graduated-user policy (deferred, not V0).** Once a user's `grad_year < current_year - 1`, auto-archive the profile: set `open_to_recruiters = false`, hide from admin list by default (filter toggle to surface), send an email asking whether to keep or delete. Document as V1; do not silently ship in V0.
7. **IP address** is captured on consent rows only (see §6), not on every request. Do not add request-level IP logging beyond what Supabase/Vercel give us by default; and do not display IP in the admin UI.

---

## 4. Consent design review

### Why consents are separate, versioned, append-only rows

- **Separate rows per consent type** (privacy_policy, terms_of_service, recruiter_resume_sharing, email_marketing, sms_marketing) because each type answers a different legal question. Bundling them ("I agree to everything") is the kind of dark pattern that CCPA/CPA regulators and plaintiff's lawyers single out.
- **Versioned** so a v1 → v2 policy change does not retroactively claim the user agreed to the new version. The old acceptance stays true of the old version; the new version requires a fresh acceptance.
- **Append-only** (insert new row, never UPDATE/DELETE the old) so the audit trail is defensible. "Did this user accept recruiter sharing at the time we included them in the export?" must be answerable by a single SQL query against immutable history.

### Required-at-signup vs optional

- **Required** (user cannot finish onboarding without them): `privacy_policy`, `terms_of_service`. These are the legal basis for the user being in the app at all.
- **Optional** (separately toggleable): `recruiter_resume_sharing`, `email_marketing`, `sms_marketing`. A user must be able to finish onboarding with all three unchecked.
- **All three optional consents must be togglable later** at `/profile/settings` (or the spec's `/profile/consents`). Toggling "off" inserts a new row with a withdrawal marker, or equivalently a new `accepted = false` row for the current version. Revoking must take effect on the next read — no caching longer than a request.

### Version bumping

- **Version format:** `v1`, `v1.1`, `v2` (semver-ish). Stored as text.
- **Current version** is defined per consent type in a small `consent_versions` lookup (seeded via migration). "Current version" means "the row in `consent_versions` where `type = X and current = true`".
- **Bump a MAJOR version** (`v1` → `v2`) when the substance of the policy changes in a way a reasonable user would want to re-read: new data sharing, new retention, new third-party. **Effect:** all existing users are forced to re-accept on next login before they may use any gated action. Until re-acceptance, the user lands on `/onboarding/consent` (re-prompt mode, prefilled with whatever previous optional choices they made).
- **Bump a MINOR version** (`v1` → `v1.1`) when we fix a typo, rephrase without changing meaning, add a contact address. **Effect:** only shown to new users (new signups record `v1.1`); existing users are not re-prompted.
- **Recruiter gating** checks `accepted && version == current_version_of(recruiter_resume_sharing)`. So a major bump of the recruiter consent removes everyone from the eligible pool until they re-accept — this is the correct and safe default.

### Withdrawal

- Revoking `recruiter_resume_sharing` is an immediate gate change: the user drops out of any future export the moment the row is written. The `/profile/consents` page must **explicitly warn** before submit that CSVs already generated and handed to recruiters cannot be recalled. (See consent copy §5.)
- Revoking `email_marketing` means no further marketing sends to that address; transactional email (OTP, resume-updated) is unaffected and this distinction must be stated in the consent copy.
- Revoking `sms_marketing` means no SMS may be sent; also, if we implemented the §3 rule, `phone_number` becomes "captured but unusable" again.
- Revoking `privacy_policy` or `terms_of_service` is **functionally a request to delete the account** — you cannot continue to use the app without them. Offer the user a "delete my account" path (see §9) when they try.

---

## 5. Exact consent copy (drafts)

> **These are DRAFT labels pending legal review.** Do not ship as-is without sign-off. They are written for a U.S. college-student audience at roughly a 9th-grade reading level.

### Onboarding `/onboarding/consent` — required checkboxes

```
[ ] I have read and agree to Progsu's [Privacy Policy] and [Terms of Service].
```

(Single checkbox, both links open a new tab. We prefer one checkbox to two because the two are conceptually inseparable — the privacy policy is incorporated into the terms — but we still record two consent rows on submit, one per type, both at the current version.)

### Onboarding `/onboarding/consent` — optional checkboxes

```
[ ] Share my profile and current resume with sponsors and recruiters Progsu
    works with. Progsu will not sell my data, and I can turn this off at any
    time from my dashboard. Resumes already sent out can't be recalled.
```

```
[ ] Send me occasional email updates from Progsu (events, opportunities,
    newsletter). I can unsubscribe from any email.
```

```
[ ] Send me occasional text messages from Progsu (event reminders, urgent
    updates). Message and data rates may apply. Reply STOP to opt out.
```

(The SMS checkbox is grayed out / disabled with helper text "Add a phone number to enable SMS updates" if no phone is on the profile. Checking this enables a second micro-confirmation: *"By checking this, I agree Progsu can send marketing SMS to the number on my profile."*)

### `open_to_recruiters` toggle (separate from consent)

```
Open to recruiters right now  [toggle]
Even with recruiter sharing on, Progsu only shares your info when this is on.
Flip it off any time you're not actively job-hunting.
```

(This is a UI preference, not a consent row. Living next to the consent checkbox but clearly labeled differently. The gating check is `consent.accepted AND open_to_recruiters = true AND …`.)

### Withdrawal warning (modal on `/profile/consents` when un-checking recruiter sharing)

```
Heads up — turning this off means:
  - You won't be included in any future recruiter exports.
  - Exports we've already sent to recruiters can't be pulled back.
  - Your resume stays in your account. Nothing is deleted.

[Cancel]   [Turn off recruiter sharing]
```

### Version-bump re-prompt banner (top of app when a required consent is stale)

```
We've updated our Privacy Policy. Please take a look and confirm you still
agree — you'll need to do this before continuing.
[Review and accept]
```

---

## 6. Consent versioning scheme

### Version string

- Format: `v<major>[.<minor>]`, e.g. `v1`, `v1.1`, `v2`.
- Stored in `consents.version` (text, not enum — new versions add a row to `consent_versions`, not a schema change).
- Each consent type has an independent version counter. `privacy_policy` can be at `v2` while `recruiter_resume_sharing` is at `v1`.

### Per-row fields

Every `consents` row MUST store:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid | FK to `auth.users.id` |
| `type` | text | one of the 5 consent types (CHECK constraint) |
| `version` | text | e.g. `v1.1` |
| `accepted` | boolean | `true` on grant, `false` on withdrawal |
| `accepted_at` | timestamptz | server-set, not client-provided |
| `ip_address` | inet NULL | captured server-side; legal advises yes, we mark nullable for future proxy edge-cases |
| `user_agent` | text NULL | captured server-side |
| `source` | text | e.g. `onboarding`, `profile_settings`, `reprompt` |

### Bump semantics (recap from §4)

- **Major bump:** re-prompt all existing users on next login; gated actions blocked until they re-accept. For `recruiter_resume_sharing` specifically, a major bump removes everyone from the eligible pool until re-acceptance — this is intentional.
- **Minor bump:** only applied to new signups. Existing users remain on the old version without re-prompt.
- **Current version** is selected via a `consent_versions` lookup table, not hardcoded in app code, so a version bump is a one-row INSERT plus an UPDATE flipping `current` — no deploy required.

### Gating check (pseudocode)

```
eligible_for_recruiter_export(u) =
    u.profile_completed
  AND u.student_email_verified
  AND u.open_to_recruiters = true
  AND EXISTS (
        SELECT 1 FROM consents
        WHERE user_id = u.id
          AND type = 'recruiter_resume_sharing'
          AND accepted = true
          AND version = (current version of recruiter_resume_sharing)
          AND id = (latest row of that type for that user)
      )
  AND u.resume_url IS NOT NULL
```

The "latest row" requirement is what makes a later withdrawal (`accepted = false` row) correctly exclude the user — we look at the most recent row, not "any accepted row ever."

---

## 7. Recruiter export privacy checklist

**Export must contain ONLY these fields:**

- `first_name`, `last_name`
- `student_email` (the verified one)
- `school`
- `grad_year`
- `major`
- `class_standing`
- `interested_roles` (comma-joined in CSV)
- `linkedin_url`, `github_url`, `portfolio_url`
- `resume_signed_url` — **15-minute expiry**, not 24 hours (tighter than spec; justified below)

**Export must NOT contain:**

- `google_email` (personal Gmail — admin-only)
- `phone_number` (not a recruiter field in V0; matches spec §10 Q2)
- `ip_address` or any audit fields
- `user_id`, `profile_id`, or any internal UUID
- any row for users who are un-verified, who have `open_to_recruiters = false`, who lack a current recruiter-sharing consent at the current version, or who have no resume
- any row for admins (filter `is_admin = false`)

### Tightening the signed URL TTL

Spec `01` §4.3 says 24-hour TTL. Privacy recommends **15 minutes**. Rationale: the CSV is opened, the recruiter clicks each link once per candidate, and the URL is no longer needed. A 24-hour window means a leaked CSV is a 24-hour leak; a 15-minute window is a 15-minute leak. The cost to legitimate recruiters is "click the link while reviewing, don't save it for later" — this is an acceptable friction and is pro-privacy signaling. If recruiters demand longer, offer a small admin UI to re-issue a URL for a specific candidate; do not default to 24h.

### Audit on export

- Every export call writes exactly one `audit_log` row with: `admin_id`, `action = 'recruiter_export'`, `filters` (JSON of selected filters), `row_count`, `timestamp`, `export_id` (UUID echoed to the CSV filename).
- The `/admin/audit` page surfaces these rows to all admins (not just the exporter), so misuse is visible to the officer team.

### Cover page / README in the CSV download

Include a `README.txt` alongside the CSV in the downloaded zip (or as the first rows of the CSV, commented with `#`), stating:

```
# Progsu Member Platform — Recruiter Export
# Generated: <UTC timestamp>   Export ID: <uuid>
#
# Terms of use:
#   - This file contains personal data of students who consented to recruiter
#     sharing at the time of export. Use it only for legitimate recruiting
#     outreach on behalf of the sponsor named in your Progsu agreement.
#   - Do not redistribute, resell, or combine with other datasets.
#   - Resume URLs in this file expire 15 minutes after export. Do not cache.
#   - Students may withdraw consent at any time. If you receive a withdrawal
#     request, stop contact and notify Progsu within 5 business days.
#   - Questions: privacy@progsu.com
```

---

## 8. Security baseline

These are non-negotiable for V0 ship. Agents 03 (DB) and 04 (security) are the primary owners; this section is the privacy-side assertion of what must be true.

- **RLS on every table, default deny.** Every Supabase table has `ENABLE ROW LEVEL SECURITY`; no table ships without an explicit policy for each role (anon / authenticated / service_role). A table with RLS enabled and zero policies is the desired "locked" state for tables only the service role should touch.
- **Service-role key never in the browser.** Never imported into any file under `app/` or `components/` that can hit the client bundle. Server-only files (`app/api/**`, server actions, route handlers). Automated check: grep for `SERVICE_ROLE` in any file not matching the server-only path convention and fail CI.
- **Private Storage bucket only.** The `resumes` bucket is private; no public URL policy. All reads go through server-issued signed URLs with short TTL (5 min in admin preview, 15 min in CSV).
- **OTP throttling.** 3 sends per 15 min per user, 5 verifies per 15 min per user. Email send rate-limited at the Resend layer too. Failures fail closed with a generic "try again shortly" message (never leak "email does not exist").
- **PII-in-logs avoidance.** `console.log` of a user object must never include `phone_number`, `student_email`, `google_email`, or raw OTP codes. A small logger helper `redactPII(obj)` wraps logging of user-shaped objects. CI check: grep for `console.log.*user` and manually review results during review.
- **Resume MIME/size validation.** PDF only, ≤5 MB, validated server-side (not trusting client content-type).
- **HTTPS only.** Enforced at Vercel edge; HSTS header set.
- **Cookie flags.** Session cookies `HttpOnly; Secure; SameSite=Lax`.
- **Email From address.** All transactional email sent from a single domain we control; SPF, DKIM, DMARC set up before first OTP goes out.

---

## 9. Retention & deletion

### User-initiated deletion (V0 process)

- User clicks "Request account deletion" on `/profile/account`. V0 implementation: this opens a prefilled email to `privacy@progsu.com` (matches spec §5 non-goal on self-service delete).
- Admin receives the request, opens a ticket, and within **30 calendar days** executes the deletion runbook:
  1. Delete the resume object from Storage and all `resume_history` objects for that user.
  2. Delete `profiles` row.
  3. Redact `consents` rows for that user: set `user_id = NULL` or keep `user_id` but null out any direct-identifier columns that ever get added. Keep `type`, `version`, `accepted`, `accepted_at`, `ip`, `ua` for audit value. Rationale: the audit trail of consent history matters even after the person is gone, especially if the question is "did we have consent at the moment we exported them?"
  3b. Redact any display fields (first_name, last_name, email) to `deleted-user-{uuid8}` where they can't be dropped outright.
  4. Retain `audit_log` rows that reference this user's id, as they document admin actions; do not delete.
  5. Delete the `auth.users` row (this is what removes Google-login linkage and should be done last).
  6. Respond to the user confirming deletion is complete.
- Document runbook in `docs/runbooks/delete-user.md` (not in this doc; out of scope).

### Automatic retention (future, not V0)

- When `grad_year < current_year - 1`: auto-archive (email user, flip `open_to_recruiters` off, hide from default admin view). Document in V1 roadmap. Do not silently hard-delete graduated users.

### `audit_log` retention

- 2 years from event timestamp. A nightly or weekly job (future) deletes rows older than 2 years. In V0, manual purge via SQL script is acceptable; add a reminder in the admin runbook.

### OTP verification rows (`school_email_verifications`)

- 90 days rolling. The hashed OTP and attempt record is useful for abuse investigation but has no reason to live forever.

### Resume history

- Keep the **3 most recent** resumes per user (current + 2 prior). Older ones get soft-deleted (Storage object removed, `resume_history` row flagged). Storage is cheap but "every resume forever" is a privacy liability.

---

## 10. Risks register

Format: **R#** — Description · **Likelihood** · **Impact** · **Mitigation** · **Owner**

**R1.** Recruiter redistributes a signed resume URL before expiry to a third party. · M · M · 15-min TTL (§7); cover-page terms forbid it; audit shows which recruiter received which URL; long-term fix = recruiter portal with per-recruiter accounts. · *Admin team*

**R2.** Admin misuses export access (exports for a personal friend, exports everyone for fun). · L · H · All exports write to `audit_log` visible to all admins (§7); periodic officer review of export logs; two-admin minimum rule so no single officer is unchecked; future: require a "recruiter name" field on export that binds the export to a stated purpose. · *Progsu president*

**R3.** User uploads a resume containing PII not relevant to recruiting (SSN, home address, DOB). · M · M (to user; low to Progsu as custodian but still important) · Out of scope to prevent programmatically in V0 (no resume parsing). Add a short note under the file-picker on `/onboarding/resume` and `/profile/resume`: *"Tip: remove your SSN, date of birth, and home address before uploading — recruiters don't need them."* · *Frontend lead*

**R4.** School-email spoofing: attacker registers a Google account with a display name matching a GSU student and tries to "verify" a school email they don't control. · L · M · OTP is delivered to the school-email mailbox, so the attacker must control that mailbox to complete verification. No auto-verification from Google's `hd` claim (spec §8). Rate-limit prevents mass guessing. · *Auth lead*

**R5.** Shared-computer session persistence: student logs in on a library PC and forgets to sign out; next user sees their dashboard and resume. · M · M · Short session TTL on Supabase Auth cookies (e.g., 7 days idle, absolute max 30 days); obvious "Sign out" button in the header; educate users in the welcome email ("sign out on shared computers"). Do NOT attempt fancy browser-fingerprint lockout in V0. · *Auth lead*

**R6.** Minor student (under 18) signs up without parental consent. · L (GSU is overwhelmingly 18+) · M (COPPA does not apply >=13 but state law and ethics still matter) · V0 posture: add a checkbox at signup *"I am 18 or older, OR I have permission from a parent/guardian to join."* This is a blunt instrument but is the right default. Recommend to leadership: set a hard 18+ floor and handle dual-enrollment minors manually (see §13 open question). · *Product + leadership*

**R7.** RLS policy gap via a VIEW or JOIN that bypasses row-level filters (e.g., an `admin_members_view` that joins `profiles` to `auth.users` without a matching policy on the view). · M · H · All VIEWs must be `SECURITY INVOKER` (default), not `SECURITY DEFINER`. Every VIEW ships with explicit RLS policy tests. Agent 04 (security) owns a checklist; agent 05 (test) owns the policy test suite. · *Security + test leads*

**R8.** Marketing email sent to a user who hasn't consented to `email_marketing` (bug in the send pipeline that uses profile email directly). · L (no sends in V0) · H (CAN-SPAM + reputational) · V0 has zero marketing sends, so the risk is dormant but must be closed before V1. Design rule: the marketing send function takes a `consent_checked_user_id[]` that it resolves against the consents table, and refuses any raw email address. Transactional sends (OTP, resume-updated) bypass this, which is correct. · *Email infra lead (V1)*

**R9.** Manual-verification backdoor: admin manually verifies a non-student as a favor, that user ends up in a recruiter export as a "GSU student." · L · H · Manual verification requires a reason string that goes into `audit_log`; periodic officer review of manual verifications; recruiter export dashboard surfaces count of manually-verified users in its preview so the exporter notices if it's unexpectedly high. · *Admin team*

**R10.** Resume Storage object leaks via an incorrectly configured bucket. · L · H · Private bucket by default (§8); automated test that HEAD-ing a Storage path without a signed URL returns 401/403; test runs in CI and on a weekly Supabase config snapshot. · *Security lead*

**R11.** Consent versioning bug: gating check uses "any accepted row" rather than "latest row at current version," so a user who withdrew still appears eligible. · L · H · SQL pattern enforced in a single shared function (`is_eligible_for_recruiter(user_id)`); unit + integration tests for (a) never-consented, (b) consented-then-withdrew, (c) consented-at-v1-after-v2-bump. · *DB + test leads*

**R12.** User believes "delete my account" also recalls already-sent recruiter exports. · M · M · Delete-account flow (and withdrawal flow, §5) state clearly that already-sent exports cannot be recalled. Email confirmation of deletion repeats this. · *Product*

---

## 11. Must-have privacy policy and ToS sections (outline)

Full drafting is out of V0 engineering scope, but the app must link to real pages at `/privacy` and `/terms` before launch, and those pages should cover at minimum:

### Privacy Policy (`/privacy`)

- **Who we are.** Progsu is a student organization at GSU; contact email; not the university.
- **What we collect.** Mirror the §2 table at user-friendly detail.
- **How we use it.** Three buckets: (a) run the app, (b) share with recruiters if you opted in, (c) send transactional and (if opted in) marketing messages.
- **Who we share it with.** Supabase, Resend, Vercel (named vendors with links to their privacy policies), plus recruiters if you consented.
- **Cookies / analytics.** What we set, what we read.
- **How long we keep it.** Reference §9.
- **Your choices.** Toggle consents, request deletion, contact for corrections.
- **Children.** We require 18+ (or parental permission); see §6 of risks.
- **Security.** Non-technical summary of §8.
- **Changes to this policy.** Reference §6 of this doc: major vs minor bumps.
- **Contact.** `privacy@progsu.com`.

### Terms of Service (`/terms`)

- **Who can use the service.** GSU-affiliated students; age floor; no bots; no scraping.
- **Your account.** You're responsible for your login; no sharing.
- **Acceptable use.** No uploading unlawful content; resumes must be your own.
- **Content ownership.** You own your resume and profile. You grant Progsu a license to display and share per your consents.
- **Recruiter sharing.** Opt-in only; Progsu does not sell your data.
- **Disclaimers and limitations.** No warranty; Progsu is not responsible for what recruiters do post-export.
- **Termination.** We can remove accounts that violate the terms; you can delete your own anytime.
- **Governing law.** Georgia, USA.
- **Contact.** `privacy@progsu.com`.

---

## 12. V0 privacy deferrables (MUST close before first external recruiter export)

- **Data Processing Agreement (DPA) template for recruiters.** A short contract every sponsor/recruiter signs before receiving a CSV, covering permitted use, no-resale, incident notification, deletion on request, 12-month data retention cap. Legal review required.
- **Cookie banner.** Not needed in V0 if we do not load any marketing analytics. If Google Analytics, Segment, Posthog, or similar is added later, a CCPA-friendly banner + opt-out control ships with it.
- **"Download my data" button.** A user-facing export of their own profile + consent history as JSON. V0 can handle manually; ship the button before scaling.
- **Incident response runbook.** A one-pager for "what do we do if a resume URL leaks." Named on-call officer, notification plan (affected users + school IT liaison + any sponsor who received the leaked data), root-cause window (72 hours).
- **Vendor list + sub-processor page.** Mirrors the privacy policy's "who we share with" section; needs to track new vendors over time.
- **Retention automation.** The `audit_log > 2 years` purge and the OTP `> 90 days` purge should run on a schedule, not manual SQL.

---

## 13. Open questions for Progsu leadership

1. **Age floor.** Recommend **18+** for membership, with a dual-enrollment exception requiring explicit parental consent (collected out-of-band by officers, noted in the member's admin profile). Please confirm or propose an alternative.
2. **Data controller of record.** Who at Progsu is the named "owner" of this data — the person a user emails to get their data, the person who signs the DPA, the person who responds to an incident? Recommend: the current President or Director of Operations, with the role (not the individual) specified in the privacy policy.
3. **Post-graduation policy.** Default proposal: at `grad_year < current_year - 1`, email the user asking whether to keep the account active or delete; auto-archive (hide from admin default view, flip `open_to_recruiters = false`) after 90 days of no response; hard-delete after another 9 months of no response. Please confirm.
4. **Contact channel in recruiter CSV.** Spec §10 Q2 recommends resume URL + profile links only. Privacy agrees. Please confirm so we don't leak `student_email` unintentionally in V0. (Reversing this later is easy; reversing "we already shared 150 phones" is not.)
5. **Resume-upload PII warning copy.** Final wording for the R3 mitigation note — Progsu brand voice wins here, privacy just asks that it exist.
6. **Re-verification on school transfer** (spec §10 Q5). If Progsu officers want to support transfers: confirm the audit-row + latest-verified-email design is acceptable.

---

## Appendix A — Quick privacy checklist (ship gate for V0)

- [ ] Phone optional at signup; not used unless `sms_marketing` consent row exists.
- [ ] No DOB/SSN/address/gender/race fields in the DB schema.
- [ ] `google_email` in admin UI only, never in recruiter CSV.
- [ ] Resume bucket is private; all access via signed URL.
- [ ] Admin resume preview URL TTL = 5 min.
- [ ] Recruiter CSV resume URL TTL = 15 min.
- [ ] Recruiter CSV contains only the §7 fields, never the §7 excluded fields.
- [ ] Recruiter CSV cover page / README is included.
- [ ] Every export call writes an `audit_log` row with filters + row count.
- [ ] All 5 consent types are separate rows, versioned, append-only.
- [ ] `privacy_policy` + `terms_of_service` required at signup; other 3 optional.
- [ ] `/profile/consents` lets users toggle the 3 optional consents; withdrawal writes a new row.
- [ ] Withdrawal-of-recruiter-consent warning modal is shown and states prior exports cannot be recalled.
- [ ] Gating check uses "latest row at current version" semantics, tested.
- [ ] `consent_versions` lookup exists; version bumps are data changes, not code deploys.
- [ ] RLS enabled on every table; service-role key is server-only.
- [ ] OTP rate limits in place; PII-in-logs rule documented.
- [ ] `/privacy` and `/terms` pages are live with v1 content before any real user signs up.
- [ ] Age-floor checkbox on signup (pending §13 Q1 decision).
- [ ] Resume-upload PII warning copy is live on upload pages.
- [ ] `privacy@progsu.com` inbox exists and is monitored by a named officer.
- [ ] Deletion runbook exists in `docs/runbooks/`; deletion SLA documented as 30 days.
- [ ] Risks register (§10) reviewed by leadership and signed off.
- [ ] Lawyer review of privacy policy, ToS, consent copy, and recruiter DPA **before first external export**.
