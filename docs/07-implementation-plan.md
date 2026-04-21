# 07 — Implementation Plan (V0)

Owner: Implementation Lead
Last updated: 2026-04-21
Status: Build plan. Source of truth for coding agents.

This document reconciles the six design docs (`01`–`06`) into one buildable plan. When this doc conflicts with an earlier doc, **this doc wins**; the earlier doc is treated as the design rationale and should be updated in a follow-up PR. Do not copy content from `01`–`06`; cite the section instead (e.g., "see `docs/02-data-security.md` §5.2").

Reviewed update: after a multi-agent review on 2026-04-21, this doc also locks the canonical route map, schema contract, onboarding state model, OTP model, and export contract. See `docs/00-plan-review.md` for the review summary and the highest-risk blockers that drove these changes.

---

## 0. User Decisions (locked 2026-04-21)

The following answers from the project owner supersede the open questions and are propagated through the reconciliations and checklists below.

| # | Topic | Decision |
|---|---|---|
| D1 | Brand accent | **Purple.** Use `#7C3AED` (Tailwind `violet-600`) as the default until a final logo palette arrives. Applied in `app/globals.css` and §5 / Task 1. |
| D2 | CSV contact info | **Include `google_email`, `student_email`, and `phone_number`** in the recruiter CSV. Contact is an explicit product feature, not a foot-gun. Reconciliations #5 and #29 flipped accordingly. |
| D3 | Age floor | **18+.** Confirmation checkbox added to onboarding; users under 18 cannot complete signup. Reconciliation #14 upgraded from "deferred" to "V0 requirement". |
| D4 | Data controller | **None named for V0.** Privacy policy will reference "Progsu leadership" generically; a specific role is not required before launch. |
| D5 | Post-grad auto-archive | **Yes, auto-archive 12 months after `grad_year`.** Moved from V1 to V0 scope (see §4 Phase 9 and §9). |
| D6 | Second admin seeded day-1 | **Yes.** Leadership will supply the Google email addresses before launch; seed SQL includes a placeholder. |
| D7 | `class_standing` | **Keep enum for now** per `02` §3 (`freshman, sophomore, junior, senior, graduate, phd, alumni`). |
| D8 | Admin onboarding | **Admins bypass member onboarding.** Confirms reconciliation #4 and the admin layout gate. |

---

## 1. Reconciliations

All conflicts surfaced across the six docs, with the decision and one-line rationale. Items 1–8 were flagged by the user; items 9–18 were uncovered while reading.

| # | Conflict | Decision | Rationale |
|---|---|---|---|
| 1 | Resume max size: `01` §4.1 step 8 says 5 MB; `02` §2.3, `05` §4 say 10 MB; `04` §4.4 says 5 MB | **10 MB** (bucket, DB CHECK, zod, Storage policy, copy) | `02` is source of truth for DB; upstream already hardened for 10 MB; rewrite 5 MB → 10 MB everywhere else. |
| 2 | Signed URL TTL on recruiter CSV: `01` §4.3 says 24h; `06` §7 says 15m; `05` §5.3 says 15m | **15 min** | Privacy wins; 24h is an unnecessary bearer-token lifetime. |
| 3 | Onboarding step count: `01`/`02`/`06` imply 4 steps w/ consent distinct; `04` §2.4 collapses consent into step 3 + "Done" = step 4 | **4 visible steps: Verify Email → Profile → Resume → Consent.** `/onboarding/done` remains an unnumbered success screen. | Keeps the re-consent flow real, keeps privacy copy consistent, and avoids overloading the resume step. |
| 4 | Admin without completed member onboarding: `04` §11 Q6 unclear; product implies admins are members too | **Admins bypass member onboarding.** `is_admin=true` permits `/admin/*` regardless of member-funnel state. Enforce in `app/(admin)/layout.tsx`. | Admins must be able to operate before they finish their own profile. |
| 5 | CSV contact info: `05` §1.2 accepts `includeContactInfo: z.literal(false)`; `06` §7 originally said exclude | **[Updated per D2] Include `google_email`, `student_email`, and `phone_number` in the recruiter CSV.** Drop the `includeContactInfo` toggle; contact columns are always present. | Owner directive 2026-04-21 — contact is intentional product value, not a leak. |
| 6 | Rate limiting: `03` §6 uses DB query; `05` §7.1 recommends DB RPC with Upstash later | **DB RPC (`consume_rate_limit`) for V0.** Leave a clean seam so Upstash can drop in without touching actions. | One fewer infra dependency at launch. |
| 7 | Migrations authoring: `02` §9 says Supabase SQL + Drizzle introspect for types; `05` §11.1 broadly agrees | **Supabase SQL migrations as source of truth; `drizzle-kit introspect` generates types only.** | RLS, SECURITY DEFINER, generated columns, storage policies are awkward in Drizzle DSL. |
| 8 | Route handler vs server action for profile: `01` §5 lists `/api/profile`; `05` §1.1/§11.5 supersedes with server action | **Server action (`updateProfile`).** Route handlers are reserved for callback/webhook/file-download cases such as `/auth/callback`, `/api/admin/export`, and `/api/webhooks/resend`. | Keeps regular mutations on the action path while leaving room for true HTTP-response flows. |
| 9 | Resume history retention: `06` §9 keeps last 3; `01` §9.5 recommends same; `02` implicitly keeps all | **Keep all for V0 (DB rows + storage objects); ship purge job in V1.** Log design in retention doc. | Storage is cheap; a correct purge is a day of work we can defer without changing the schema. |
| 10 | Consent version format: `02` `current_consent_version()` uses `int`; `05` `recordConsentSchema` uses `z.regex(/^v\d+$/)`; `06` §6 uses `v<major>[.<minor>]` text | **Text `vN[.M]` in DB (`consents.version text`); seed v1 via `consent_versions` lookup table owned by `06` §6. Drop the `int` variant.** | `06` anticipates minor bumps; `int` forces code deploys. Update `02` §2.4 CHECK accordingly. |
| 11 | OTP hashing: `02` §2.2 uses sha256 w/ server salt; `03` §3.1 uses bcrypt(12) | **Use bcrypt(12) + a server-only pepper in Node, and keep verify/consume/profile-update/audit in one direct Postgres transaction.** | This preserves slow-hash semantics without the broken “precomputed hash RPC” hybrid. |
| 12 | Consent required-vs-optional: `04` §4.5 lists `consentResumeSharing` as required; `06` §4 says recruiter_resume_sharing is **optional** | **Privacy wins: recruiter_resume_sharing is OPTIONAL to finish onboarding.** Only `privacy_policy` + `terms_of_service` are required. | Bundling is a dark-pattern flag; `06` §4 is explicit. |
| 13 | Duplicate student email behavior: `03` §3.2 returns `EMAIL_TAKEN` revealing prior holder; `06` §8 implies generic error | **V0: ship `EMAIL_TAKEN` with generic copy** ("That email is already in use on another Progsu account. Contact an admin if this is a mistake."). Do not echo the other user. | Matches `03`; keeps admin-assist path. Flag for privacy re-review at V1. |
| 14 | Age-gate checkbox: `06` R6 / §13 Q1 requires; `01`/`04` silent | **[Updated per D3] Required in V0.** Age floor is 18+. Enforced via a dedicated `age_confirmation` consent row (not bundled into privacy/ToS) captured on the consent page; submission blocks if unchecked. | Owner directive 2026-04-21; keeps affirmative-consent semantics and makes age verifiable in audit log. |
| 15 | Phone + SMS consent interlock: `06` §3.1 requires "can't send SMS without consent AND phone"; `04`/`05` allow phone any time | **Server-side invariant: `sms_marketing=true` requires `phone_number` present and E.164.** Zod cross-field refinement on `recordConsent`. | Prevents collecting-but-can't-use case. |
| 16 | Resume "tip" copy about PII: `06` R3 requires tip under file picker | **Ship PII warning on `/onboarding/resume` and `/dashboard/resume`.** Copy: "Tip: remove your SSN, date of birth, and home address before uploading — recruiters don't need them." | Lightweight privacy guard; no engineering cost. |
| 17 | Role taxonomy mismatch: `02` uses 12 values; `05` uses 12 slightly different values; `04` §4.3a lists 15 human labels | **Adopt `02`'s enum as canonical.** Frontend labels map in a table in `lib/enums/roles.ts`. Update `05`'s list to match `02`. | Single enum, one source. |
| 18 | Class standing enum: `02` has `freshman, sophomore, junior, senior, graduate, phd, alumni`; `05` has `... grad, alumni, other` | **Adopt `02`'s enum (no `other`; include `phd`).** | Don't need "other"; keeps filters clean. |
| 19 | `profiles.student_email_verified` trigger-write vs RPC: `02` §5.2 policy forbids direct updates, routes through `verify_student_email` RPC; `03` §3.3 updates directly in the action | **Transaction wins.** Keep user-context callers unable to update verification fields, but do the full verify state transition in one server-only Postgres transaction instead of the current RPC/bcrypt split. | Fixes race conditions and keeps verification writes off the client path. |
| 20 | Signed URL — member vs admin TTL: `02` §6.3 says member 5 min / admin 15 min; confirmed | **Keep 5/15.** No change. | Logged for completeness. |
| 21 | Admin "view" audit dedup: `05` §1.2 dedups to once/admin/member/hour; `06` §10 R2 wants visibility | **Dedup stays at 1/hour per (admin, member).** | Balance noise vs signal; surface distinct admins in UI. |
| 22 | Core schema names drift across `02`, `04`, and `05` | **`07` owns the canonical schema contract below.** Build to that contract, not to any one upstream doc. | Prevents incompatible column names and impossible upload/export implementations. |
| 23 | `profile_completed` means “fully onboarded” in some docs and “profile fields present” in others | **Use derived onboarding state helpers; do not gate on one overloaded boolean.** | Avoids incorrect redirects and export eligibility bugs. |
| 24 | Consent route exists in `01`/`04`/`06`, but `07` removed it while still redirecting users there | **Restore `/onboarding/consent` as a real route.** | Needed for re-prompt, withdrawal copy, and a stable funnel. |
| 25 | Login UX in `04` still reads like magic-link/email entry | **Google OAuth only in V0.** | Matches product/auth and removes stale frontend work. |
| 26 | Export download is currently planned as a “streaming action” | **Preview via server action; file download via route handler.** | Cleaner App Router fit and easier browser download semantics. |
| 27 | `04`/`02` still include extra profile fields beyond the approved privacy inventory | **Drop pronouns, GPA, location, work authorization, internship/full-time toggles, and similar extras from V0.** | Data minimization and scope control. |
| 28 | Consent ledger uniqueness blocks withdrawal/re-enable flows | **Allow multiple rows per `(user_id, consent_type, version)` and define latest as `accepted_at desc, id desc`.** | Makes “latest row wins” actually implementable. |
| 29 | Export contact-channel policy is contradictory across docs | **[Updated per D2] Include `google_email`, `student_email`, and `phone_number` in the V0 CSV** along with the resume URL and public links. | Owner directive 2026-04-21; pairs with reconciliation #5. |
| 30 | Deletion request flow is referenced but not actually modeled | **Add `account_deletion_requests` to the schema and track manual deletion requests in-app.** | Preserves auditability without promising self-serve deletion. |
| 31 | Export preview and download use different queries today | **Both must use one shared eligibility helper.** | Prevents row-count drift, gating drift, and audit mismatches. |

---

### 1.1 Canonical V0 contract

The following is the build contract coding agents should implement even where `01`–`06` still disagree:

- **Public routes:** `/`, `/login`, `/privacy`, `/terms`
- **Onboarding routes:** `/onboarding/verify-email`, `/onboarding/profile`, `/onboarding/resume`, `/onboarding/consent`, `/onboarding/done`
- **Member routes:** `/dashboard`, `/dashboard/profile`, `/dashboard/resume`, `/dashboard/settings`
- **Admin routes:** `/admin`, `/admin/members`, `/admin/members/[id]`, `/admin/export`, `/admin/audit`, `/admin/settings`
- **Download route:** actual recruiter CSV download ships as a route handler under `app/api/admin/export/route.ts`
- **Profile field allow-list:** `first_name`, `last_name`, `preferred_name`, `school`, `major`, `minor`, `class_standing`, `grad_year`, `grad_term`, `interested_roles`, `linkedin_url`, `github_url`, `portfolio_url`, `phone_number`, `open_to_recruiters`, plus system fields (`google_email`, `student_email`, verification/admin flags, timestamps)
- **Fields explicitly out of V0:** pronouns, GPA, location/city, work authorization, internship/full-time toggles, and similar sensitive or non-essential extras
- **Resume contract:** `resumes` must support `status`, `deleted_at`, `file_name`, `file_size`, `mime_type`, `is_current`, `storage_path`, and `uploaded_at`
- **Consent contract:** V0 keeps the original 5 consent types only; the ledger is append-only, allows multiple rows per `(user_id, consent_type, version)`, and defines “latest” as `accepted_at desc, id desc`
- **Onboarding state contract:** compute `profile_fields_complete`, `has_current_resume`, `required_consents_current`, and `fully_onboarded` in code; do not rely on a single overloaded `profile_completed` boolean for auth or export gating
- **OTP contract:** one active code per `(user_id,email)`, 60-second resend cooldown, 3/15-minute send bucket, 5/15-minute verify bucket, resend invalidates prior active codes, verify/consume/profile-update/audit happen in one transaction, and the UI receives precise `retryAfterMs` / `attemptsRemaining`
- **Export contract:** preview and download must use the same eligibility helper; include `google_email`, `student_email`, and `phone_number` per decision **D2**; exclude admin rows; include `export_id` in the README/audit trail

## 2. Stack lockdown

### 2.1 Tailwind version decision

**Tailwind 3.4** (not 4). Rationale:
- shadcn/ui's component generator emits Tailwind 3 classes and config; Tailwind 4 migration is a known-footgun in late 2026 tooling.
- CSS-variables pattern in `04` §0 assumes `hsl(var(--accent))` which works identically in 3.
- One less surprise during onboarding of new coding agents.

Revisit when shadcn ships first-class Tailwind 4 support.

### 2.2 Dependencies (pnpm)

Single workspace, `pnpm@9`, Node 20.x. React 19 + Next 15 + TypeScript 5.5+.

```bash
# runtime
pnpm add next@15 react@19 react-dom@19

# styling + UI
pnpm add tailwindcss@3 postcss autoprefixer tailwind-merge class-variance-authority clsx tailwindcss-animate
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-slot @radix-ui/react-checkbox @radix-ui/react-avatar @radix-ui/react-toast @radix-ui/react-tooltip @radix-ui/react-separator @radix-ui/react-progress
pnpm add sonner
pnpm add lucide-react

# forms
pnpm add react-hook-form @hookform/resolvers zod

# URL state (admin filters)
pnpm add nuqs

# Supabase
pnpm add @supabase/supabase-js @supabase/ssr

# DB / Drizzle
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit

# Email
pnpm add resend @react-email/components @react-email/render

# Security / util
pnpm add bcryptjs
pnpm add zod date-fns nanoid

# Server helpers
pnpm add server-only

# Dev / tooling
pnpm add -D typescript@5 @types/react @types/react-dom @types/node @types/bcryptjs
pnpm add -D eslint eslint-config-next prettier prettier-plugin-tailwindcss
pnpm add -D vitest @vitest/coverage-v8 @vitest/ui jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
pnpm add -D playwright @playwright/test
pnpm add -D tsx dotenv

# Optional later (V0.5/V1 — do not install in V0 unless a step needs it)
# pnpm add @sentry/nextjs
# pnpm add @upstash/ratelimit @upstash/redis
```

Exact versions pinned in `package.json` at install time; do not use `latest` in CI.

### 2.3 shadcn/ui

```bash
pnpm dlx shadcn@latest init
# CLI prompts: style=default, base color=slate, CSS vars=yes, src dir=no, app dir=yes, import alias "@/*".
pnpm dlx shadcn@latest add button input label card dialog dropdown-menu form select badge table checkbox separator avatar breadcrumb progress skeleton tooltip sheet
```

---

## 3. Folder structure

```
progsu-platform/
├─ app/
│  ├─ (marketing)/              # public, unauth'd
│  │  ├─ layout.tsx
│  │  ├─ page.tsx               # /
│  │  ├─ privacy/page.tsx       # /privacy
│  │  ├─ terms/page.tsx         # /terms
│  │  └─ login/page.tsx         # /login
│  ├─ (onboarding)/             # session required, member-funnel
│  │  ├─ layout.tsx             # step shell + funnel guard
│  │  ├─ verify-email/page.tsx
│  │  ├─ profile/page.tsx
│  │  ├─ resume/page.tsx
│  │  ├─ consent/page.tsx
│  │  └─ done/page.tsx
│  ├─ (app)/                    # session + fully-onboarded
│  │  ├─ layout.tsx
│  │  ├─ dashboard/page.tsx
│  │  └─ dashboard/
│  │     ├─ profile/page.tsx
│  │     ├─ resume/page.tsx
│  │     └─ settings/page.tsx
│  ├─ (admin)/                  # session + is_admin=true; bypass onboarding
│  │  ├─ layout.tsx             # is_admin gate + distinct shell
│  │  ├─ admin/page.tsx
│  │  ├─ admin/members/page.tsx
│  │  ├─ admin/members/[id]/page.tsx
│  │  ├─ admin/export/page.tsx
│  │  ├─ admin/audit/page.tsx
│  │  └─ admin/settings/page.tsx
│  ├─ auth/
│  │  └─ callback/route.ts      # OAuth exchange (route handler)
│  ├─ api/
│  │  ├─ admin/
│  │  │  └─ export/route.ts     # CSV download (route handler)
│  │  └─ webhooks/
│  │     └─ resend/route.ts     # Resend bounce webhook
│  ├─ layout.tsx                # root layout; html, fonts, toaster
│  ├─ globals.css               # Tailwind + CSS vars
│  └─ not-found.tsx
│
├─ components/
│  ├─ ui/                       # shadcn-generated primitives
│  ├─ brand/                    # Logo, AdminBadge
│  ├─ forms/                    # LoginForm, StudentEmailForm, OtpInput, ProfileForm, RolesChipSelect, SchoolSelect, ResumeUploader, ResumePreview
│  ├─ onboarding/               # StepIndicator, StepShell
│  ├─ admin/                    # KpiCard, FilterSidebar, MemberTable, MemberDetailPanel, ConsentHistoryList, AuditLogList, ManualVerifyDialog, ExportWizard, DomainAllowlistTable
│  ├─ consent/                  # ConsentBlock, ConsentGroup, WithdrawalWarningDialog
│  ├─ shared/                   # PageHeader, EmptyState, UserMenu, SignOutButton
│  └─ emails/                   # OtpEmail, WelcomeEmail, ResumeUpdatedEmail (React Email)
│
├─ lib/
│  ├─ supabase/
│  │  ├─ browser.ts             # createBrowserClient()
│  │  ├─ server.ts              # createServerClient() (RLS-bound)
│  │  ├─ middleware.ts          # cookie-refresh helper
│  │  └─ admin.ts               # createServiceRoleClient() (server-only)
│  ├─ db/
│  │  ├─ client.ts              # drizzle + postgres.js client (server-only)
│  │  ├─ schema.ts              # drizzle introspect output (generated)
│  │  └─ types.ts               # re-exports InferSelectModel / InferInsertModel
│  ├─ actions/
│  │  ├─ auth.ts                # signOut, requestStudentEmailCode, verifyStudentEmailCode
│  │  ├─ profile.ts             # updateProfile, setOpenToRecruiters
│  │  ├─ resume.ts              # createResumeUploadUrl, finalizeResumeUpload, deleteResume
│  │  ├─ consent.ts             # recordConsent, requestAccountDeletion, withdrawConsent
│  │  ├─ verification.ts        # (admin) manual-verify
│  │  ├─ admin.ts               # adminListMembers, adminGetMember, adminPreviewRecruiterExport, adminGetSignedResumeUrl, adminSetManualVerification
│  │  └─ safeAction.ts          # wrapper (auth + RL + logging + error shape)
│  ├─ validators/
│  │  ├─ primitives.ts          # uuid, httpsUrl, e164Phone
│  │  ├─ enums.ts               # mirrored DB enums (role, class_standing, consent_type)
│  │  ├─ profile.ts             # updateProfileSchema
│  │  ├─ auth.ts                # OTP request + verify
│  │  ├─ resume.ts              # finalize/delete
│  │  ├─ consent.ts             # recordConsent + cross-field SMS rule
│  │  └─ admin.ts               # list + export + manual-verify
│  ├─ rate-limit/
│  │  ├─ client.ts              # consumeRateLimit() RPC wrapper
│  │  └─ buckets.ts             # Bucket enum + limits table (central config)
│  ├─ onboarding/
│  │  └─ funnel.ts              # nextOnboardingStep(member) -> path | null
│  ├─ csv/
│  │  └─ rfc4180.ts             # escape + streaming helpers
│  ├─ export/
│  │  └─ eligibility.ts         # single source of truth for preview + download gating
│  ├─ emails/
│  │  └─ send.ts                # sendOtpEmail(), sendWelcomeEmail(), sendResumeUpdatedEmail()
│  ├─ auth/
│  │  ├─ getUser.ts             # RSC-safe; uses getUser() not getSession()
│  │  └─ requireAdmin.ts        # throws if not admin
│  ├─ log.ts                    # structured JSON logger
│  ├─ errors.ts                 # ErrorCode union + ActionResult type + errOut()/ok()
│  └─ utils.ts                  # cn(), formatDate, formatRelativeTime
│
├─ supabase/
│  ├─ config.toml               # local Supabase CLI config
│  └─ migrations/               # SOURCE OF TRUTH for schema
│     ├─ 20260421_000001_init.sql
│     ├─ 20260421_000002_profiles.sql
│     ├─ 20260421_000003_verification.sql
│     ├─ 20260421_000004_resumes.sql
│     ├─ 20260421_000005_consents.sql
│     ├─ 20260421_000006_school_domains.sql
│     ├─ 20260421_000007_audit.sql
│     ├─ 20260421_000008_exports.sql
│     ├─ 20260421_000009_rate_limit.sql
│     └─ 20260421_000010_storage_bucket.sql
│
├─ drizzle/
│  ├─ drizzle.config.ts
│  └─ schema.ts                 # GENERATED by drizzle-kit introspect; do not hand-edit
│
├─ emails/                      # React Email preview dev server root (legacy `emails/` name for compat)
│  └─ preview.tsx               # optional pnpm dev-emails
│
├─ scripts/
│  ├─ seed.ts                   # seed school_domains + consent_versions
│  ├─ admin-seed.ts             # set is_admin=true on a given google_email
│  └─ db-reset.ts               # wraps supabase db reset + drizzle introspect + seed
│
├─ tests/
│  ├─ unit/                     # zod, CSV builder, rate limit helper, funnel
│  ├─ integration/              # Supabase-local: actions + RLS
│  └─ e2e/                      # Playwright
│
├─ middleware.ts                # session refresh, no redirects here (guards live in layouts)
├─ next.config.mjs
├─ tsconfig.json
├─ tailwind.config.ts
├─ postcss.config.js
├─ components.json              # shadcn config
├─ .env.example
├─ .env.local                   # gitignored
├─ .eslintrc.cjs
├─ .prettierrc
├─ vitest.config.ts
├─ playwright.config.ts
├─ package.json
├─ pnpm-lock.yaml
└─ README.md
```

Folder purpose in one line each:

| Folder | Purpose |
|---|---|
| `app/(marketing)/` | Public routes; no auth required. |
| `app/(onboarding)/` | Member funnel pages; session required, `is_admin` not required. |
| `app/(app)/` | Post-onboarding member surface (dashboard). |
| `app/(admin)/` | Admin-only surface, gated by `is_admin=true`. |
| `app/auth/callback/route.ts` | Supabase OAuth code exchange (route handler, not action). |
| `app/api/webhooks/resend/route.ts` | Inbound Resend bounce webhook. |
| `components/ui/` | shadcn/ui primitives (generated). |
| `components/forms/` | Domain-specific form components (OTP, Profile, Resume, Roles). |
| `components/onboarding/` | Onboarding-specific (StepIndicator, StepShell). |
| `components/admin/` | Admin table, filters, detail panels, wizard. |
| `components/consent/` | Consent checkbox blocks + withdrawal dialog. |
| `components/emails/` | React Email templates used by Resend. |
| `lib/supabase/` | Four Supabase clients: browser, server(RLS), middleware-helper, admin(service-role). |
| `lib/db/` | Drizzle client + generated schema types (server-only). |
| `lib/actions/` | Server actions organized by domain + safeAction wrapper. |
| `lib/validators/` | zod schemas shared between actions and forms. |
| `lib/rate-limit/` | `consume_rate_limit` RPC wrapper + central bucket config. |
| `lib/onboarding/funnel.ts` | Pure `nextOnboardingStep()` used by all guards. |
| `lib/csv/` | RFC-4180 escape + streaming helpers. |
| `lib/emails/` | Typed wrappers around `resend.emails.send`. |
| `lib/auth/` | `getUser`, `requireAdmin` helpers. |
| `lib/errors.ts` | `ActionResult<T>`, `ErrorCode`, `ok/err` constructors. |
| `supabase/migrations/` | SQL migrations, one per logical step; source of truth for schema. |
| `drizzle/schema.ts` | Types-only mirror regenerated by `drizzle-kit introspect`. |
| `scripts/` | Seed + admin-seed + db-reset helpers, invoked via `pnpm tsx`. |
| `tests/unit`, `integration`, `e2e` | Vitest unit + integration, Playwright e2e. |

---

## 4. Build order

Each step lists: **what to do** · **files touched** · **verification**. Steps are ordered so later steps build on earlier; do not reorder without cause.

### Phase 0 — Repo + infra (steps 1–6)

**1. Initialize repo.** Run `pnpm create next-app@15 .` with TS + App Router + Tailwind, no `src/` dir, import alias `@/*`. Files: `package.json`, `tsconfig.json`, `next.config.mjs`, `app/*`, `tailwind.config.ts`, `postcss.config.js`, `.gitignore`. Verify: `pnpm dev` serves boilerplate.

**2. Initialize shadcn/ui.** Run `pnpm dlx shadcn@latest init` with settings in §2.3. Configure `components.json`; set CSS vars in `app/globals.css` per `04` §0; set `--accent` to `#7C3AED` per decision **D1** (Tailwind `violet-600`, pending final logo). Add the batch of primitives listed in §2.3. Verify: `<Button>` renders with purple accent fill.

**3. Add core deps.** Run all `pnpm add` blocks in §2.2 except the optional/future ones. Verify: `pnpm build` completes on a trivial page.

**4. Env + config.** Create `.env.example` listing every var from §2.8 below. Wire `NEXT_PUBLIC_SUPABASE_URL`, anon key, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `OTP_PEPPER`, `NEXT_PUBLIC_APP_URL`, `PRIVACY_INBOX_EMAIL`, `NEXT_PUBLIC_FEATURE_DOMAIN_ADMIN=false`, `LOG_LEVEL=info`. Add `next.config.mjs` `experimental.serverActions` default origin check. Verify: `.env.local` populated; `pnpm dev` boots.

**5. Supabase local.** Install Supabase CLI. `supabase init && supabase start`. Configure `supabase/config.toml` so local uses ports 54321–54324. Verify: `supabase status` prints URLs and keys; Studio opens at 54323.

**6. Resend + domain.** Create Resend account. Verify domain `mail.progsu.org` (DKIM + SPF + DMARC records). Create API key, webhook secret. Set `RESEND_FROM_EMAIL="Progsu <no-reply@mail.progsu.org>"`. Defer webhook URL registration to step 40. Verify: API key accepted by `resend.emails.send()` in a scratch script.

### Phase 1 — Data layer (steps 7–13)

**7. Migration 000001 `init.sql`.** Extensions (`uuid-ossp`, `pgcrypto`, `citext`, `pg_trgm`); enums (`consent_type_t`, `class_standing_t`, `interested_role_t`, `verification_method_t`); `set_updated_at()` trigger fn. Source: `02` §3, §7.1. Verify: `supabase db reset` green.

**8. Migration 000002 `profiles.sql`.** `profiles` table per the canonical contract in §1.1, not the raw `02` shape. Keep `handle_new_user()` trigger (§7.2) and `is_admin()` helper (§5.1), but add write protection for verification/admin-controlled fields and do not treat `profile_completed` as a canonical gate. Verify: inserting into `auth.users` via Studio auto-creates a `profiles` row; a non-admin cannot set `is_admin=true` or mutate verification metadata directly.

**9. Migration 000003 `verification.sql`.** `email_verification_codes` table with one-active-code support, resend-cooldown indexes, and RLS deny-all for authenticated (§5.3). Do **not** ship the current bcrypt + RPC hybrid. Verification will execute in one server-only transaction in Phase 3. Verify: schema supports one active code per `(user_id,email)` and concurrent verification tests can lock the row with `FOR UPDATE`.

**10. Migration 000004 `resumes.sql` + storage.** `resumes` table per the canonical contract: keep unique-one-current semantics, but add lifecycle fields needed by the upload/delete flow (`status`, `deleted_at`, `file_name`, `file_size`, `mime_type`). Keep `set_current_resume()` RPC or equivalent transaction helper for the current-resume flip; create private bucket (§6.1) and storage policies (§6.2). Verify: owner can PUT; non-owner cannot; pending → active transitions are representable; `resumes_one_current_per_user` fires on double-current.

**11. Migration 000005 `consents.sql`.** `consents` table with `version text` per reconciliation #10; `consent_versions` lookup table (`06` §6) seeded with v1 rows for the original 5 consent types only; append-only RLS (§5.5); `v_latest_consents` view ordered by `accepted_at desc, id desc`. Remove uniqueness on `(user_id, consent_type, version)` so withdrawal/re-enable flows remain append-only and buildable. Verify: UPDATE/DELETE on consents fails, and two rows for the same `(user,type,version)` can coexist with latest-row-wins semantics.

**12. Migration 000006 `school_domains.sql`.** Table + RLS (§5.6); seed 6 domains per `02` §8. Verify: authenticated SELECT returns all 6; non-admin INSERT fails.

**13. Migration 000007 `audit.sql` + 000008 `exports.sql` + 000009 `rate_limit.sql` + 000010 `storage_bucket.sql`.** `audit_log` (§2.6) + RLS (§5.7); `account_deletion_requests`; export-eligibility helper (side-effect free) that reads `consent_versions` and excludes admin rows and structured contact channels; `rate_limit_events` table + `consume_rate_limit` RPC per `05` §7.3 with precise `retry_after_ms`; re-run storage bucket policies idempotently. Verify: `supabase db reset` applies all 10 in order with no errors and the eligibility helper returns the same row count used by preview/download.

### Phase 2 — Auth (steps 14–18)

**14. Drizzle introspect.** Configure `drizzle/drizzle.config.ts` against local Supabase (non-pooled URL). Run `pnpm drizzle-kit introspect`. Commit `drizzle/schema.ts`. Wire `lib/db/client.ts` using `postgres.js` + `drizzle-orm`. Add `server-only` import guard. Verify: `pnpm tsc --noEmit` green; `db.select().from(profiles)` typechecks.

**15. Supabase clients.** Implement four clients in `lib/supabase/`:
- `browser.ts` — `createBrowserClient()` (public anon).
- `server.ts` — `createServerClient()` wired to Next.js `cookies()` adapter from `@supabase/ssr`.
- `middleware.ts` — `updateSession(req,res)` helper that refreshes cookies on every request.
- `admin.ts` — `createServiceRoleClient()` with `server-only` import + process check.

Verify: unit test that `admin.ts` is not imported from a `"use client"` file path via an ESLint rule or grep CI check.

**16. `middleware.ts`.** Matcher `'/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)'`. Calls `updateSession()`. No redirects here — guards live in layouts. See `03` §2.2. Verify: cookie refresh observed on subsequent requests; `api/webhooks/*` excluded.

**17. `/auth/callback` route handler.** Exchange `code` for session; sanitize optional `next` to a relative in-app path; run `nextOnboardingStep()` on the resolved user to compute the effective redirect. Incomplete onboarding always wins over the requested destination. Source: `03` §2.2, `04` §7. Verify: manual OAuth round-trip lands on `/onboarding/verify-email` for a fresh user, and external `next` values are rejected.

**18. Login page + Google button.** Implement `/login` as server shell + client `<LoginForm>`; Google OAuth only, no magic-link/email-entry UI. The button carries an optional relative `next` path through the callback helper from step 17. Copy from `04` §5.2 after upstream cleanup. Verify: end-to-end Google flow lands a new row in `profiles`.

### Phase 3 — Student email OTP (steps 19–22)

**19. OTP email template.** Implement `components/emails/OtpEmail.tsx` per `03` §8. Export `otpPlainText()`. Verify: `react-email preview` renders the HTML.

**20. `requestStudentEmailCode` action.** File `lib/actions/auth.ts`:
- zod parse input; read allowlist via `db.select().from(schoolDomains).where(...)`.
- Check uniqueness against `profiles.student_email`.
- Enforce 60-second resend cooldown per `(user_id,email)` and invalidate prior active rows for that `(user_id,email)` before issuing a new code.
- Consume rate limit bucket `otp_send` (3 / 15 min / user) via `consume_rate_limit` RPC.
- Generate 6-digit via `crypto.randomInt`; bcrypt(12) with `OTP_PEPPER` concatenated; insert `email_verification_codes`.
- Fire Resend with `Idempotency-Key: "otp/${userId}/${email}/${Math.floor(Date.now()/60000)}"`.
- Roll back the active code row and refund any cooldown-only state if the send fails.
- Return `{ expiresInSeconds: 600, retryAfterMs?: number }` via `safeAction` discriminated union.

Source: `03` §3.2; reconciled rate limit per reconciliation #6; hash per #11. Verify: integration test that duplicate email rejects with `EMAIL_TAKEN`, a second call within 60s hits `RATE_LIMITED`, and resend invalidates the prior active code.

**21. `verifyStudentEmailCode` action.** Run the full verify flow inside one direct Postgres transaction on a single connection: `SELECT ... FOR UPDATE` the latest active row, `bcrypt.compare`, increment `attempts` or mark `consumed_at`, update the profile verification fields, and write audit in the same transaction. Also consume the `otp_verify` bucket (5 / 15 min / user) and return `attemptsRemaining` / `retryAfterMs` to the UI. Source: `03` §3.3; reconciliation #19. Verify: wrong code increments attempts exactly once, concurrent double-submit cannot double-succeed, and correct code flips `student_email_verified=true` with one audit row.

**22. `safeAction` wrapper.** Implement `lib/actions/safeAction.ts` per `05` §8.1. All subsequent actions go through it. Verify: a thrown error yields `{ok:false, error:{code:'INTERNAL', message: '... [reqId]'}}` and a log line with `request_id`.

### Phase 4 — Onboarding pages (steps 23–27)

**23. Onboarding layout + `StepIndicator`.** `app/(onboarding)/layout.tsx` runs funnel guard from the derived onboarding state helpers in §1.1. Render `<StepShell>` + `<StepIndicator currentStep={n}/>` across four visible steps: verify, profile, resume, consent. Source: `04` §2.4, §6, §7. Verify: hitting `/onboarding/resume` before verifying email bounces to verify-email, and stale-consent re-prompts land on `/onboarding/consent`.

**24. `/onboarding/verify-email` page.** Two-stage form (Stage A: email; Stage B: OTP). State-machined per `03` Appendix B. `OtpInput` component: 6 inputs, paste-aware, auto-advance, ARIA per `04` §9. Copy from `04` §5.4. Verify: happy path and expired-code path.

**25. `/onboarding/profile` page + `updateProfile` action.** Profile form with the canonical V0 fields only: `first_name`, `last_name`, `preferred_name`, `school`, `major`, `minor`, `class_standing`, `grad_year`, `grad_term`, `interested_roles`, `linkedin_url`, `github_url`, `portfolio_url`, and `phone_number`. No GPA, pronouns, location, work authorization, or internship/full-time toggles in V0. `RolesChipSelect` keeps max 6; `SchoolSelect` is populated from `school_domains`. Server computes derived `profile_fields_complete`; do not treat this as full onboarding completion. Verify: partial save remains incomplete; full required-field save advances to `/onboarding/resume`.

**26. `/onboarding/resume` page.** Implement `ResumeUploader` with the three-action flow: `createResumeUploadUrl → PUT → finalizeResumeUpload`. Include PII tip copy (reconciliation #16). This step handles upload only. Verify: upload fails with wrong MIME; valid uploads advance to `/onboarding/consent`.

**27. `/onboarding/consent` + `/onboarding/done` pages.** `/onboarding/consent` collects required Privacy/ToS plus the **required `age_confirmation`** checkbox (decision **D3** — "I confirm I am 18 or older"), plus optional recruiter/email/sms marketing choices. SMS stays disabled without a phone number. On submit, iterate `recordConsent(...)` once per consent type (including `age_confirmation`), then show `/onboarding/done` as the unnumbered success screen with a 2-second redirect to `/dashboard`. Verify: required consents (including age) are enforced, withdrawing later remains append-only, and landing on `/onboarding/done` when `nextOnboardingStep(me)!==null` bounces back to the correct step.

### Phase 5 — Member dashboard (steps 28–31)

**28. `(app)` layout.** Server-component gate: redirect to `/login` if no session; redirect to `nextOnboardingStep` if not fully onboarded. Render nav bar per `04` §2.2 with `<UserMenu>`. Verify: un-onboarded user can never reach `/dashboard`.

**29. `/dashboard` page.** Server component: verification badge, consent summary (via `v_latest_consents`), current resume file + uploaded date, eligibility banner powered by the same export-eligibility helper used by preview/download. Copy from `04` §5. Verify: banner flips green when all four conditions meet; amber with reason otherwise.

**30. `/dashboard/profile` + `/dashboard/resume`.** Reuse `<ProfileForm mode="edit">` and `<ResumeUploader>`. Replace-flow UI on resume: show current filename + uploaded date + "Replace" button opens the picker. Verify: profile update optimistic toast; resume replace flips `is_current` and retains history rows.

**31. `/dashboard/settings`.** Sections:
1. Connected account (Google email, verified school email, sign-out).
2. Consents (the 5 V0 consent types with version/date; withdrawal dialog for recruiter sharing per `06` §5).
3. `open_to_recruiters` toggle (separate from consent, per `06` §5).
4. Delete account (submits `requestAccountDeletion`, writes `account_deletion_requests`, audits it, and emails `PRIVACY_INBOX_EMAIL`; fulfillment remains manual).

Source: `01` §5; `06` §5, §9. Verify: withdrawing recruiter consent writes an `accepted=false` row and the banner on `/dashboard` flips amber within the same request.

### Phase 6 — Admin (steps 32–35)

**32. `(admin)` layout.** Admin gate per reconciliation #4: `notFound()` (404) for non-admins; admins bypass member onboarding even if their own profile fields are incomplete. Distinct visual shell per `04` §2.3 with `<AdminBadge>`. Verify: non-admin URL hit returns 404; admin bypasses onboarding funnel on `/admin/*`.

**33. `/admin/members` table + filters.** Server shell + `<FilterSidebar>` (client, nuqs-synced) + `<MemberTable>` rendering rows from `adminListMembers`. All filters in `04` §4.6 + `05` §2.4. Pagination offset-based, server-rendered. Verify: filters mutate URL; URL shared between admins yields identical results.

**34. `/admin/members/[id]` detail page + `/admin/audit` + `/admin/settings`.** Member detail keeps the parallel `<Suspense>` panels per `04` §10. `<ManualVerifyDialog>` with typed-"VERIFY" confirmation calls `adminSetManualVerification`. Admin preview signed URL TTL is 15 minutes. Also build `/admin/audit` as the read-only audit surface and `/admin/settings` as the read-only V0 settings surface (domains visible, not editable). Verify: manual verify writes audit with reason; dedup test for `admin_member_view` stays at 1/hr per pair; audit page renders export/manual-verification rows.

**35. Members search + `pg_trgm` ILIKE index.** Confirm index exists from migration 000002 on the canonical profile fields; query uses `ILIKE` on `first_name || ' ' || last_name` and `student_email`. Verify: searching "jan" finds "Jane"; EXPLAIN shows trigram index.

### Phase 7 — Recruiter CSV export (steps 36–37)

**36. `/admin/export` wizard.** 3-step UI per `04` §8.3: (1) reuse current filters, (2) preview with row count plus `manuallyVerifiedCount`, (3) click-to-download. Contact columns are always included (decision **D2**); no `includeContactInfo` toggle. Preview uses the shared export-eligibility helper, not a separate members-list query.

**37. Recruiter CSV download route handler.** Use a dedicated route handler under `app/api/admin/export/route.ts`. It reads the same eligibility helper as step 36, mints 15-minute signed URLs (reconciliation #2), inserts audit **before** streaming with a generated `export_id`, and **includes** `google_email`, `student_email`, and `phone_number` (decision **D2**) while excluding admin rows. Prepend README comment lines per `06` §7 and include the `export_id` in the filename/README/audit metadata. Verify: CSV contents match the D2 column set, preview row count matches the download, audit exists even on aborted downloads, and revoked users remain absent.

### Phase 8 — Privacy pages + consent versioning (steps 38–39)

**38. Legal pages.** `/privacy` and `/terms` as MDX or plain TSX pages with approved v1 copy per `06` §11. Inline link targets from consent checkboxes. Do not ship placeholder legal stubs to production before the first external export. Verify: linked from onboarding consent block; 200 OK unauth'd.

**39. Consent version re-prompt banner.** Layout-level check on `(app)` and `(onboarding)`: if a required consent's latest row version != `consent_versions.current`, redirect to `/onboarding/consent?mode=reprompt` with prefilled optional toggles. Banner copy per `06` §5. Verify: bumping `privacy_policy` or `terms_of_service` forces every logged-in user through re-prompt before any gated action.

### Phase 9 — Observability + hardening (steps 40–43b)

**40. Structured logger + request IDs.** Confirm `logEvent` in `lib/log.ts`; every action passes `action`, `user_id`, `request_id`, `duration_ms`, `ok`, `error_code`. Verify: Vercel log tail can answer the three questions in `05` §8.2.

**41. Error boundaries.** `app/error.tsx` (root) + `app/(admin)/admin/error.tsx` + `app/(app)/error.tsx`. Render `<PageError requestId={...}/>` with a "copy request id" button. Verify: a thrown error renders the boundary without leaking stack.

**42. Resend webhook endpoint.** `app/api/webhooks/resend/route.ts` per `05` §9.1. Verify signature; on `email.bounced` hard, un-verify the matching profile using columns that actually exist in the canonical schema and write audit. Register the webhook URL in the Resend dashboard once deployed (deferred to step 47). Verify: fake POST with valid HMAC un-verifies; bad HMAC 401s.

**43. CI gates.** GitHub Actions (or equivalent): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` (spins `supabase start`), `supabase db reset && drizzle-kit check` for drift. Verify: PR with drift fails CI.

**43b. Post-graduation auto-archive (decision D5).** Add an `is_archived boolean default false` + `archived_at timestamptz` to `profiles` (if not already present via canonical schema). Ship a scheduled job — Supabase cron or a Vercel cron hitting an authenticated route handler — that runs daily and sets `is_archived=true, archived_at=now()` for any profile where `grad_year IS NOT NULL AND (grad_year, grad_term) is >= 12 months in the past AND is_archived=false`. Archived profiles are excluded from the recruiter export eligibility helper and from default admin list views (admin can toggle "show archived"). Archiving does not delete data; the user can un-archive on next login. Verify: backfill test with a 2024 grad flips to archived; a 2026 grad does not; archived user does not appear in a CSV preview.

### Phase 10 — Deploy (steps 44–50)

**44. Supabase prod project.** Create new project; run migrations 000001–000010 in order via `supabase db push`; run `pnpm tsx scripts/seed.ts`. Verify: `supabase db diff` clean.

**45. Vercel project.** Link repo; set **every** env var from §2.8. Configure preview branch protection so preview envs don't share prod Supabase. Verify: preview deploy builds green.

**46. Google OAuth prod config.** Per `03` §2.1: Authorized origins include prod + preview wildcard; redirect URI points at Supabase's `/auth/v1/callback`. Site URL in Supabase set to `https://members.progsu.org`. Additional redirect URLs include prod, local, and preview wildcards. Verify: Google OAuth completes on prod domain.

**47. Resend prod config.** Verify domain, DKIM/SPF/DMARC green, register webhook URL `https://members.progsu.org/api/webhooks/resend` with the `RESEND_WEBHOOK_SECRET` from step 4. Verify: send test OTP to a real `.edu` address, confirm delivery.

**48. First admin seed.** Run `pnpm tsx scripts/admin-seed.ts --email devon@progsu.org` which executes `UPDATE public.profiles SET is_admin = true WHERE google_email = 'devon@progsu.org';` under service role. Per `01` §9.3, seed at least **two** admins. Verify: `/admin` loads for both seeded admins.

**49. Smoke test end-to-end.** Using a brand-new Google account, complete the full happy path: sign-in → verify email → profile → resume+consents → done → dashboard. Then as an admin: list members, view detail, manual-verify a different account, export CSV, confirm CSV has correct columns and signed URLs open. Verify: every assertion in the §7 Manual QA list passes.

**50. Rollback plan.** Vercel: one-click revert to previous deployment. DB: keep a `supabase/migrations/rollback/` folder with paired `DROP` SQL per migration — author as each forward migration is written in Phase 1. Document "how to revert a deployed revision" in `README.md`. Verify: dry-run the rollback on staging before going live.

---

## 5. Dependency graph

Can-be-parallelized lookup. Rows are phases; cells mark "can start once Phase X is done."

| Phase | Depends on | Parallel-with |
|---|---|---|
| 0 (infra) | — | — |
| 1 (data) | 0 | — |
| 2 (auth) | 1 | Phase 8 legal page stubs can start (pure static copy). |
| 3 (OTP) | 2 (clients + callback) | Phase 9 logger scaffold. |
| 4 (onboarding) | 3 | — |
| 5 (member dashboard) | 4 | Phase 6 admin layout can start (gated by `is_admin` only, no onboarding dep). |
| 6 (admin) | 1 + 2 (auth); does NOT need 4 or 5 | Phase 5 |
| 7 (CSV export) | 6 + 1 (gating SQL + audit) | — |
| 8 (privacy pages + versioning) | 4 (onboarding consent page lives there) for re-prompt banner; static pages need only 0 | Much of Phase 5/6 |
| 9 (observability) | safeAction from Phase 3; otherwise 0 | Any other phase |
| 10 (deploy) | All prior | — |

Step-level parallelization within phases:
- Steps 23 (layout) and 19 (email template) can run in parallel (different files).
- Step 33 (member table) and Step 36 (export wizard) can run in parallel (both depend on action layer from step 22 and data from Phase 1).
- Steps 38 (legal pages) and 27 (done page) can run in parallel (independent).

---

## 6. First 10 coding tasks

Each task is a self-contained prompt for a coding agent. Acceptance criteria are verifiable without a human in the loop.

### Task 1: Initialize Next.js 15 + Tailwind 3 + shadcn/ui + Inter + brand accent
- **Files to create**: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.js`, `components.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`.
- **Steps**:
  1. `pnpm create next-app@15 .` → TS=yes, App Router=yes, Tailwind=yes, src dir=no, import alias `@/*`.
  2. Pin Tailwind at v3.4; do not let the scaffold pull v4.
  3. `pnpm dlx shadcn@latest init` with base color slate, CSS vars=yes.
  4. In `app/globals.css` replace `--primary` / `--accent` with `#7C3AED` (Tailwind `violet-600`) in HSL form — `262 83% 58%` — per decision **D1**. See token table in `04` §0.
  5. Add Inter via `next/font` in `app/layout.tsx` and apply as root `className`.
  6. Run `pnpm dlx shadcn@latest add button input label card`.
  7. Replace `app/page.tsx` with a single `<main>` containing a `<Button>` "Continue with Google" placeholder.
- **Acceptance**:
  - `pnpm dev` serves `/` with Inter font active (DevTools computed font == Inter).
  - The button is filled with `#7C3AED` / `violet-600` (verify hex in DevTools).
  - `pnpm build` exits 0.
- **References**: `docs/04-frontend-ux.md` §0 brand tokens + §5.2.
- **Complexity**: S (30–60 min).

### Task 2: Initialize Supabase local + env wiring + four Supabase clients
- **Files**: `supabase/config.toml`, `.env.example`, `.env.local`, `lib/supabase/browser.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `lib/supabase/admin.ts`, `lib/auth/getUser.ts`.
- **Steps**:
  1. Install Supabase CLI (`brew install supabase/tap/supabase`).
  2. `supabase init && supabase start`. Record URL + anon + service-role.
  3. Write `.env.example` listing every var from §2.8; copy to `.env.local` with local values.
  4. `lib/supabase/browser.ts`: `createBrowserClient(URL, ANON)`.
  5. `lib/supabase/server.ts`: `createServerClient` wired to Next's `cookies()` adapter; export `getSupabaseServerClient()`.
  6. `lib/supabase/middleware.ts`: export `updateSession(req, res)`.
  7. `lib/supabase/admin.ts`: import `"server-only"`; read `SUPABASE_SERVICE_ROLE_KEY`; export `createServiceRoleClient()`. Fail if `NEXT_PUBLIC_SUPABASE_URL` unset.
  8. `lib/auth/getUser.ts`: export `getUser()` using `supabase.auth.getUser()` (not `getSession()`).
- **Acceptance**:
  - `getSupabaseServerClient()` returns a live client in a scratch RSC.
  - ESLint rule flags any `import` of `lib/supabase/admin` from a path matching `components/**`.
  - Unit test: `createServiceRoleClient()` throws when run from a "use client" compiled context (simulate with `vitest` and `process.browser`-mock).
- **References**: `docs/03-auth-verification.md` §2.2, `docs/05-backend-api.md` §0, §10.
- **Complexity**: M (60–90 min).

### Task 3: First SQL migration — extensions, enums, profiles, RLS helper `is_admin`
- **Files**: `supabase/migrations/20260421_000001_init.sql`, `supabase/migrations/20260421_000002_profiles.sql`, `scripts/db-reset.ts`.
- **Steps**:
  1. Migration 000001: `CREATE EXTENSION` for `uuid-ossp`, `pgcrypto`, `citext`, `pg_trgm`. Create 4 enums per `02` §3. Create `set_updated_at()` trigger fn per `02` §7.1.
  2. Migration 000002: `profiles` table per `02` §2.1 (with `updated_at` trigger); indexes per `02` §4; `is_admin(uuid)` helper fn per `02` §5.1; `handle_new_user()` trigger + `on_auth_user_created` hook per `02` §7.2; RLS policies per `02` §5.2.
  3. `scripts/db-reset.ts`: shells out to `supabase db reset` then `drizzle-kit introspect` then `pnpm tsx scripts/seed.ts`.
- **Acceptance**:
  - `pnpm tsx scripts/db-reset.ts` runs green.
  - Inserting a fake `auth.users` row via Supabase Studio SQL creates a matching `profiles` row.
  - Signed-in user A cannot SELECT user B's profile row (test by creating two users locally).
- **References**: `docs/02-data-security.md` §§3, 4, 5.1, 5.2, 7.1, 7.2.
- **Complexity**: M (60–120 min).

### Task 4: Second SQL migration — email_verification_codes, resumes, consents, audit_log, storage bucket + policies, seed domains
- **Files**: `supabase/migrations/20260421_000003_verification.sql`, `.._000004_resumes.sql`, `.._000005_consents.sql`, `.._000006_school_domains.sql`, `.._000007_audit.sql`, `.._000008_exports.sql`, `.._000009_rate_limit.sql`, `.._000010_storage_bucket.sql`, `scripts/seed.ts`.
- **Steps**:
  1. 000003: `email_verification_codes` per `02` §2.2 (hash is bcrypt string, not sha256 digest); indexes; deny-all RLS (§5.3); `verify_student_email(p_email, p_code_hash)` RPC that just compares strings (hash computed in app — reconciliation #11) and flips flags + audit.
  2. 000004: `resumes` + unique-current partial index; RLS (§5.4); `set_current_resume(p_resume_id, p_size_bytes)` RPC (§7.3 + size_bytes param from `05` §4.4).
  3. 000005: `consent_versions (type, version, current, ...)` lookup + seed v1 for all 6 types; `consents` table (version text); RLS (§5.5); `v_latest_consents` view (§7.6).
  4. 000006: `school_domains` + RLS + seed 6 rows (`02` §8).
  5. 000007: `audit_log` + RLS (§5.7); `admin_toggle_verification(...)` (§7.5).
  6. 000008: `admin_export_recruiter_safe(jsonb)` reading `consent_versions` (not hardcoded version).
  7. 000009: `rate_limit_events` + `consume_rate_limit(bucket,key,max,window_ms)` RPC (`05` §7.3).
  8. 000010: create `resumes` private bucket + storage policies (`02` §6.1, §6.2).
  9. `scripts/seed.ts`: idempotent insert for domains + consent_versions v1.
- **Acceptance**:
  - Storage bucket is private (GET `.../public/resumes/anyfile` returns 400).
  - `INSERT INTO consents (... UPDATE)` fails on UPDATE / DELETE.
  - `consume_rate_limit('otp_send','u1',3,900000)` allows first 3, rejects 4th with `retry_after_ms > 0`.
- **References**: `docs/02-data-security.md` §§2.2–2.6, §§5.3–5.7, §§6, 7, 8; `docs/05-backend-api.md` §7.3; `docs/06-privacy-compliance.md` §6.
- **Complexity**: M (2 h).

### Task 5: Drizzle introspect → typed schema + DB client
- **Files**: `drizzle/drizzle.config.ts`, `drizzle/schema.ts` (generated), `lib/db/client.ts`, `lib/db/types.ts`.
- **Steps**:
  1. `drizzle.config.ts`: driver `pg`; `dbCredentials: { url: process.env.DATABASE_URL_DIRECT }`; `schemaFilter: ['public']`; `introspect.casing: 'camel'`.
  2. Run `pnpm drizzle-kit introspect`. Commit `drizzle/schema.ts` (do not hand-edit).
  3. `lib/db/client.ts`: `postgres(process.env.DATABASE_URL, { prepare: false })` + `drizzle(...)`. Import `server-only`.
  4. `lib/db/types.ts`: re-export `InferSelectModel` + `InferInsertModel` for `profiles`, `resumes`, `consents`, `schoolDomains`, `auditLog`.
- **Acceptance**:
  - `pnpm tsc --noEmit` green.
  - A scratch `await db.select().from(profiles).limit(1)` compiles and runs.
  - CI step `supabase db reset && drizzle-kit check` reports no drift.
- **References**: `docs/02-data-security.md` §9; `docs/05-backend-api.md` §0, §11.1.
- **Complexity**: S (30–60 min).

### Task 6: `middleware.ts` for session refresh + `/auth/callback` route handler
- **Files**: `middleware.ts`, `app/auth/callback/route.ts`, `lib/onboarding/funnel.ts`.
- **Steps**:
  1. `middleware.ts`: matcher excluding `_next/*`, `favicon.ico`, `api/webhooks/*`; call `updateSession()`; return response.
  2. `lib/onboarding/funnel.ts`: pure `nextOnboardingStep(member)` per `04` §7 with 4 steps (reconciliation #3).
  3. `app/auth/callback/route.ts`: read `code` + `next`; `supabase.auth.exchangeCodeForSession`; load profile; compute `next = searchParams.next ?? nextOnboardingStep(profile) ?? '/dashboard'`; redirect.
- **Acceptance**:
  - Stale session refreshes automatically on page navigation (observe `sb-<...>` cookie `Set-Cookie` header).
  - Fresh Google login lands on `/onboarding/verify-email`.
  - Malformed `?code=` returns `/login?error=...` (not 500).
- **References**: `docs/03-auth-verification.md` §2.2; `docs/04-frontend-ux.md` §7.
- **Complexity**: M (1–2 h).

### Task 7: Login page + Google OAuth button + post-login onboarding redirect
- **Files**: `app/(marketing)/layout.tsx`, `app/(marketing)/login/page.tsx`, `components/forms/LoginForm.tsx`, `components/brand/Logo.tsx`, `components/shared/SignOutButton.tsx`, `lib/actions/auth.ts` (signOut only for now).
- **Steps**:
  1. Marketing layout per `04` §2.1.
  2. Login page: server shell with copy from `04` §5.2 + `<LoginForm/>` client island.
  3. `LoginForm`: single "Continue with Google" `<Button>` calling `supabase.auth.signInWithOAuth({ provider:'google', redirectTo: \`${origin}/auth/callback?next=/dashboard\` })`.
  4. `signOut` server action: `supabase.auth.signOut()`; `redirect('/')`.
- **Acceptance**:
  - `/login` renders with Google button.
  - Clicking redirects to Google consent, and on return the user lands somewhere in `/onboarding/*` (Task 23 will produce the actual pages; for now a 404 is acceptable — verify by watching Network).
  - Signing out clears the `sb-*` cookies.
- **References**: `docs/03-auth-verification.md` §2.2–2.4; `docs/04-frontend-ux.md` §5.2.
- **Complexity**: S (45–90 min).

### Task 8: OTP React Email template + `requestStudentEmailCode` + `verifyStudentEmailCode` actions with rate-limit RPC
- **Files**: `components/emails/OtpEmail.tsx`, `lib/emails/send.ts`, `lib/validators/auth.ts`, `lib/rate-limit/client.ts`, `lib/rate-limit/buckets.ts`, `lib/actions/safeAction.ts`, `lib/actions/auth.ts`, `lib/errors.ts`.
- **Steps**:
  1. `lib/errors.ts`: `ErrorCode` union + `ActionResult<T>` + `ok/err` constructors per `05` §3.
  2. `safeAction.ts` per `05` §8.1.
  3. `OtpEmail.tsx` + `otpPlainText()` per `03` §8.
  4. `lib/emails/send.ts`: `sendOtpEmail({ to, firstName, code })` wraps `resend.emails.send` with `Idempotency-Key`.
  5. `rate-limit/buckets.ts`: central config `{ otp_send: {max:3,windowMs:900_000}, otp_verify: {max:5,windowMs:900_000}, ... }`.
  6. `rate-limit/client.ts`: `consumeRateLimit(bucket, key)` → `rpc('consume_rate_limit',{...})`.
  7. `lib/validators/auth.ts`: `requestStudentEmailCodeSchema`, `verifyStudentEmailCodeSchema` per `05` §2.5.
  8. `lib/actions/auth.ts#requestStudentEmailCode`:
     - `safeAction` with `rateLimit: bucket 'otp_send'`.
     - SELECT `school_domains` WHERE domain = $lower(domainOf(email)) AND is_active. Fail `DOMAIN_NOT_ALLOWED`.
     - SELECT `profiles` WHERE `student_email=$email AND student_email_verified AND id <> $me`. Fail `EMAIL_TAKEN` (generic copy per reconciliation #13).
     - Generate `code = crypto.randomInt(0,1_000_000).toString().padStart(6,'0')`; `hash = bcrypt.hash(code + process.env.OTP_PEPPER, 12)`.
     - INSERT `email_verification_codes` with `code_hash=hash`, `expires_at=now()+10m`.
     - `sendOtpEmail(...)`.
  9. `verifyStudentEmailCode`:
     - SELECT latest non-consumed row FOR UPDATE via an RPC or a dedicated server-only query.
     - `bcrypt.compare(code + OTP_PEPPER, row.code_hash)`.
     - On match: call `verify_student_email(p_email, p_code_hash)` RPC to mark consumed + flip flags + audit.
     - On mismatch: `UPDATE attempts = attempts + 1` (service role).
- **Acceptance**:
  - Integration test: happy path flips `student_email_verified=true` and writes audit row.
  - Duplicate student email returns `EMAIL_TAKEN`.
  - 4th request within 15 min returns `RATE_LIMITED` with nonzero `retryAfterMs`.
  - Email is received in local inbox (Resend test env or `MAILPIT`); subject includes the code.
- **References**: `docs/03-auth-verification.md` §§3, 4, 6, 8; `docs/05-backend-api.md` §§1.1, 2.5, 7, 8.
- **Complexity**: M (2–3 h).

### Task 9: `/onboarding/verify-email` page — email form + OTP form + state machine
- **Files**: `app/(onboarding)/layout.tsx`, `components/onboarding/StepShell.tsx`, `components/onboarding/StepIndicator.tsx`, `app/(onboarding)/verify-email/page.tsx`, `components/forms/StudentEmailForm.tsx`, `components/forms/OtpInput.tsx`, `components/forms/OtpResendTimer.tsx`, `lib/auth/requireSession.ts`.
- **Steps**:
  1. `(onboarding)/layout.tsx`: server gate: if no session → `/login?next=<path>`; if `nextOnboardingStep==null` → `/dashboard`; if URL !== computed step → redirect. Render `<StepShell>` + `<StepIndicator currentStep={n} completedSteps={[...]} />`.
  2. `StepIndicator`: 4 steps, done/active/locked states per `04` §6.
  3. Page: server fetches `profile`; computes current step `n=1`; renders `<StudentEmailForm/>` → on success swaps to `<OtpInput/>` per `03` Appendix B.
  4. `OtpInput`: 6 individual inputs, paste-aware, auto-advance, per-digit aria-label per `04` §9.
  5. `OtpResendTimer`: 60s cooldown, aria-live polite.
  6. Forms use `react-hook-form` + zod resolvers from `lib/validators/auth.ts`.
- **Acceptance**:
  - E2E: type email → receive code (in local MAILPIT) → type code → land on `/onboarding/profile`.
  - Bad code shows `attemptsRemaining` inline.
  - Expired code shows "Code expired. Send a new one." with working CTA.
  - Keyboard-only user can paste a 6-digit code into the first box and it splits correctly across all 6 inputs.
- **References**: `docs/03-auth-verification.md` §§3.2–3.3, §8, Appendix B; `docs/04-frontend-ux.md` §§2.4, 4.2, 5.4, 6, 9.
- **Complexity**: M (2–3 h).

### Task 10: `/onboarding/profile` page with `updateProfile` action
- **Files**: `app/(onboarding)/profile/page.tsx`, `components/forms/ProfileForm.tsx`, `components/forms/SchoolSelect.tsx`, `components/forms/RolesChipSelect.tsx`, `lib/validators/profile.ts`, `lib/validators/enums.ts`, `lib/actions/profile.ts`, `lib/actions/admin.ts` (read-helper for school list only).
- **Steps**:
  1. `lib/validators/enums.ts`: export `ROLE_ENUM` and `CLASS_STANDING_ENUM` matching `02` §3 (reconciliations #17, #18).
  2. `lib/validators/profile.ts`: `updateProfileSchema` per `05` §2.3 (include `classStanding`; reject `gpa` unless user confirms — default NO).
  3. `lib/actions/profile.ts#updateProfile`:
     - `safeAction` bucket `profile_write` (30/min).
     - Merge input into `profiles` via the user-context Supabase client.
     - Server recomputes derived `profile_fields_complete` by checking `REQUIRED_PROFILE_FIELDS` post-merge; do not treat this as full onboarding completion.
  4. `SchoolSelect`: combobox reads from `school_domains` via an RSC that prefetches the list.
  5. `RolesChipSelect`: Radix-based chip group, max 6 enforced client-side with toast + server-side in zod.
  6. Page: server-component that loads current profile (may be partial) and renders `<ProfileForm mode="onboarding" defaultValues={...}>`.
- **Acceptance**:
  - Saving required fields makes the profile-fields gate pass and redirects to `/onboarding/resume`.
  - Submitting without required fields shows inline errors; row is still saved partially.
  - Attempting 7 roles rejects the 7th client-side AND zod rejects it if the client is bypassed.
- **References**: `docs/01-product-architect.md` §4.1; `docs/02-data-security.md` §2.1; `docs/04-frontend-ux.md` §§4.3, 4.3a; `docs/05-backend-api.md` §§1.1, 2.3.
- **Complexity**: M (2–3 h).

---

## 7. Testing checklist

### 7.1 Unit tests (Vitest)

- zod validators: valid/invalid for `updateProfileSchema`, `requestStudentEmailCodeSchema`, `verifyStudentEmailCodeSchema`, `recordConsentSchema` (including SMS-without-phone cross-field), `adminListMembersSchema`, and export filter schema.
- `nextOnboardingStep(member)`: permutations of the derived onboarding state helpers (`profile_fields_complete`, `has_current_resume`, `required_consents_current`, admin override).
- `consumeRateLimit` wrapper: first N pass, N+1 blocks, after window resets.
- CSV row builder / `rfc4180` escape: values with `"`, `,`, `\r\n`, Unicode, and `interestedRoles` sort stability.
- Funnel logic with admin override (`is_admin=true` still allowed on `/admin/*` even when member-facing onboarding is incomplete).

### 7.2 Integration tests (Vitest + Supabase local)

Spin a fresh `supabase start` per CI job; apply migrations; seed; then:

- `requestStudentEmailCode` + `verifyStudentEmailCode` happy path (hash round-trip + audit row).
- Duplicate student email across users → `EMAIL_TAKEN`.
- Expired code (fast-forward time / set `expires_at` via direct UPDATE) → `OTP_EXPIRED`.
- 5 wrong codes → 5th returns `OTP_LOCKED`.
- Resend invalidates the prior active code and enforces the 60-second cooldown.
- Concurrent verify double-submit produces one success, one safe failure, and one audit row.
- `finalizeResumeUpload` happy path: upload a 1 MB PDF to signed URL, finalize, verify `is_current=true` and prior row flipped to false.
- Oversize PDF (11 MB stub) → `RESUME_TOO_LARGE` and storage object deleted.
- `adminListMembers` gated by `is_admin`: non-admin gets `FORBIDDEN`.
- Export eligibility helper gating: a user who has withdrawn recruiter consent is absent; a user on v1 of recruiter consent with `consent_versions.current=v2` is absent; admin rows are absent.
- RLS enforcement: signed-in user A cannot SELECT user B's `profiles`, `resumes`, or `consents` rows (direct Supabase JS calls).
- Append-only consents: UPDATE and DELETE both fail.

### 7.3 E2E (Playwright)

- **Full onboarding happy path**: Google OAuth stub → verify email (intercept the Resend send and read the code from a test hook) → profile → resume → consent → done → `/dashboard`.
- **Admin login + export**: seed second test user as admin; list members; filter by school; export CSV; assert CSV headers + row count matches preview; confirm signed URL downloads; confirm the file contains no structured contact channels.
- **Admin-as-404 for non-admin**: unauthenticated and non-admin both see 404 on `/admin/*`.
- **Consent withdrawal**: toggle off recruiter consent on `/dashboard/settings`; immediately re-run export; previously-included user absent.

### 7.4 Manual QA (20-item smoke list)

1. `/` renders with correct brand color and "Continue with Google" CTA.
2. Google OAuth completes and a `profiles` row is created.
3. `/onboarding/verify-email` accepts a valid `.edu`, rejects `@gmail.com` with domain error.
4. OTP arrives within 60s.
5. Wrong OTP shows attempts remaining; correct OTP advances.
6. Profile form validation rejects missing required fields; 7-role input blocked.
7. Resume upload accepts a ≤10 MB PDF; rejects 11 MB; rejects .docx.
8. Consent page required boxes checked; optionals togglable; SMS grayed without phone.
9. Onboarding "Done" auto-redirects to `/dashboard`.
10. `/dashboard` eligibility banner green when all 4 conditions true; amber with reason otherwise.
11. Replace resume flow: new file uploads, old version listed in history (admin view).
12. Withdraw recruiter consent on `/dashboard/settings`: banner flips amber.
13. Non-admin hitting `/admin` returns 404.
14. Admin hitting `/admin` renders distinct shell with badge.
15. Member table filters via URL — sharing URL with another admin shows identical view.
16. Member detail page renders all four panels (profile, resumes, consents, audit).
17. Manual verification requires typing `VERIFY` + reason ≥ 10 chars.
18. Export CSV: row count in preview matches rows in downloaded file.
19. CSV signed URLs return the PDF within 15 min and 403 after.
20. Resend webhook hard-bounce un-verifies the matching student email.

### 7.5 Security tests

- Auth-bypass: call `updateProfile` without a session cookie → `UNAUTHORIZED`.
- Cross-user read: forge a session for user A and attempt `from('profiles').select().eq('id', userB)` → no rows (RLS).
- Oversize PUT: send 11 MB PDF to signed URL → Storage rejects at bucket level.
- Admin route as non-admin: `GET /admin` as regular member → 404.
- `SUPABASE_SERVICE_ROLE_KEY` grep: `grep -R "SERVICE_ROLE" app/ components/ | grep -v server-only` returns nothing.
- Signed URL expiry: minted member signed URL is 401 at `expires_at + 1s`.
- CSRF: server action called from `Origin: https://evil.com` → rejected by Next 15's default origin check.
- RLS test for VIEWs: `v_latest_consents` inherits security-invoker semantics; authenticated user A cannot SELECT user B rows through it.
- Redirect sanitization: external `next=https://evil.com` values are rejected at auth callback.

---

## 8. Deployment checklist

1. **Supabase prod project created.**
   - Note the project ref; set `NEXT_PUBLIC_SUPABASE_URL`, anon, service role in Vercel.
   - Apply migrations 000001 → 000010 in order via `supabase db push`.
   - Run `pnpm tsx scripts/seed.ts` against prod.
2. **Storage bucket verified.**
   - `resumes` bucket exists, `public = false`, `file_size_limit = 10 MiB`, `allowed_mime_types = ['application/pdf']`.
   - Storage policies present (test: unauthenticated GET returns 400).
3. **Google OAuth prod.**
   - Google Cloud OAuth 2.0 client: authorized origins `https://members.progsu.org`, `https://*-progsu.vercel.app` (preview), `http://localhost:3000`.
   - Authorized redirect URI: **only** `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase's, not ours).
   - Supabase Auth → URL Configuration: Site URL = prod; additional redirect URLs include prod `/auth/callback`, local `/auth/callback`, and preview wildcards.
4. **Resend prod.**
   - Domain `mail.progsu.org` verified; DKIM + SPF + DMARC green in Resend dashboard.
   - Webhook endpoint registered: `POST https://members.progsu.org/api/webhooks/resend` with secret set to `RESEND_WEBHOOK_SECRET`.
5. **Vercel project.**
   - Env vars (exhaustive):
     - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_FEATURE_DOMAIN_ADMIN=false`
     - `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`
     - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`
     - `OTP_PEPPER`, `PRIVACY_INBOX_EMAIL=privacy@progsu.org`, `LOG_LEVEL=info`
   - Preview branch: mark for preview-only env (do NOT share prod Supabase).
   - Production domain: `members.progsu.org` with HSTS header set.
6. **First admins seeded via SQL.** Run at prod service role:
   ```sql
   UPDATE public.profiles
   SET is_admin = true
   WHERE google_email IN ('devon@progsu.org', 'president@progsu.org');
   ```
   Per `01` §9.3, seed at least two admins so one losing Google access is not a lockout.
7. **Smoke test.** From a fresh Google account:
   - Sign in → complete onboarding → verify dashboard banner green.
   - As one of the seeded admins: list members, open detail, export CSV, open a resume signed URL (should work), wait 16 minutes, open again (should 403).
   - Intentionally fail the OTP 5 times on a secondary test account and verify lockout message.
8. **Rollback.**
   - Vercel: one-click revert to the previous deployment. Document the exact steps in `README.md#Rollback`.
   - DB: each forward migration in `supabase/migrations/` has a matching `supabase/migrations/rollback/DATE_NAME_down.sql` with `DROP` + `ALTER` statements to undo it. Apply in reverse order via `psql` if required.
   - Data rollback is NOT attempted (no point-in-time restore in V0 beyond Supabase's daily backups).

---

## 9. Future features signpost

V0 intentionally omits these; capture them here so PM / eng know what is next:

| Post-V0 version | Feature | One-line rationale |
|---|---|---|
| V0.5 | Resume ZIP export alongside CSV | Recruiter ergonomics; hidden behind a feature flag already in `04` §8.3. |
| V0.5 | Sentry | Drop-in per `05` §8.3; stop `INTERNAL` being a guess. |
| V0.5 | "Download my data" self-service JSON export | Privacy deferrable in `06` §12. |
| V1 | Event attendance + check-ins | Product roadmap, `01` §7. Schema extends off `profiles.id`. |
| V1 | Email blasts + SMS blasts | Consents already collected; send pipeline per `06` R8. |
| V1 | Saved admin filters / segments | Per `01` §7; URL-state friendly. |
| V1 | Admin domain CRUD UI | Currently flagged; `FEATURE_DOMAIN_ADMIN` exists. |
| V1 | Auto re-verification job | `03` §7 V1 hooks already designed. |
| ~~V1~~ → **V0** | ~~Auto-archive post-graduation~~ — moved into V0 per decision **D5**. See §4 step 43b. |  |
| V1 | Resume history 3-version retention cron | `06` §9; schema already append-only. |
| V1 | Upstash rate-limit swap | Seam kept in `05` §7.1. |
| V1.5 | Resume book PDF generation | For career fairs; `01` §7. |
| V2 | Recruiter self-serve portal | CSV remains V0's output. |
| V2 | LinkedIn/GitHub enrichment (consented) | New consent type drops in. |
| V3+ | SSO/SAML/InCommon | Auth abstraction preserved. |
| V3+ | Multi-chapter tenancy | Accept one-time migration cost. |

---

## 10. Open questions still needing user input

Deduplicated from all six docs, clustered by who owns the decision.

### 10.A — User (Joey / build lead)

1. ~~Brand accent~~ — **Resolved D1:** purple `#7C3AED` (violet-600).
2. **Any reason to expand the locked V0 profile field list?** Default recommendation: **no**. (`00` plan review + canonical contract)
3. **Dark mode for V0.** Currently out of scope. Confirm. (`04` §11 Q5)
4. ~~School allowlist at launch~~ — **Resolved:** ship the 6 seeded domains as-is (owner confirmed item 7 of session Q&A).
5. **Analytics / event tracking.** Any vendor (Posthog, Segment) for V0? If yes, triggers a cookie banner. (`04` §11 Q10; `06` §12)
6. **Session-expired UX.** Preserve mid-form drafts in localStorage? Default NO for V0. (`04` §11 Q12)

### 10.B — Progsu leadership (president / officer team)

7. ~~Second+ admin seeded day-1~~ — **Resolved D6:** yes; emails to be collected before launch. Leadership owns the list.
8. **Admin impersonation / "view as member" in V0?** Recommendation: **no**. Confirm. (`01` §10 Q1)
9. **Behavior on school domain deactivation for already-verified users.** Options in `03` §10 Q2. Recommendation: keep verified (V0 simplicity); decide V1 sweep. Confirm.
10. ~~`class_standing` enum vs free text~~ — **Resolved D7:** enum per `02` §3.
11. **Re-verification on school transfer.** Design ready per `03` §E3; confirm it ships in V0 or is V1 scope. (`01` §10 Q5; `06` §13 Q6)
12. ~~Post-graduation auto-archive policy~~ — **Resolved D5:** yes; auto-archive 12 months after `grad_year`. See §4 Phase 9 and §9.
13. **"Open to recruiters" wording / separation from consent.** Confirm `06` §5 copy.
14. ~~Data controller of record at Progsu~~ — **Resolved D4:** no named controller for V0; privacy policy references "Progsu leadership" generically.
15. ~~Age floor~~ — **Resolved D3:** 18+ only, enforced via `age_confirmation` consent row on the consent page. Copy TBD from leadership/legal.
16. ~~V0 export-contact policy~~ — **Resolved D2:** CSV includes `google_email`, `student_email`, `phone_number`. No revisit needed pre-launch.
17. **Resume-upload PII warning copy.** Brand-voice wording for the tip under the file picker. (`06` §13 Q5)

### 10.C — Legal counsel (Progsu's attorney, via leadership)

18. **Final privacy policy and ToS text for `/privacy` and `/terms`.** (`06` §11)
19. **Recruiter DPA template** signed before any external CSV handoff. (`06` §12)
20. **Consent copy (§5 blocks + withdrawal modal + version-bump re-prompt).** Draft in `06` §5; needs attorney pass. (`04` §11 Q2; `06` §5)
21. **Source of the `/privacy` and `/terms` content** — does Legal write or does Progsu? (`04` §11 Q4)
22. **Consent v1 → v2 re-consent flow legal approval.** Gating semantics locked (`06` §6); copy for the re-prompt banner needs attorney sign-off.
23. **Incident response runbook + named on-call officer.** (`06` §12)

### 10.D — Deferred design questions (flag only, not blocking V0)

24. **Resume-history retention policy** (`06` §9): 3 versions vs all. V0 keeps all; V1 prunes.
25. **Email marketing send pipeline design** (`06` R8). Not in V0 but must be designed before V1 first send.
26. **Mobile session TTL tuning.** Default Supabase 3600s / 7d refresh. Observe real user pain before changing. (`06` R5)
27. **Bcrypt cost tuning** (currently 12). Tune after a load test. (`03` §10 Q4)
28. **Role taxonomy final labels.** `04` §4.3a listed 15 human strings; `02`/`05` use 12 DB enum values. V0 ships 12; UX team owns the display labels.

---

End of implementation plan.
