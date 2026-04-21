# 04 — Frontend UX Engineering

**Owner:** Frontend UX Engineer
**Stack:** Next.js 15 (App Router) · React Server Components · Tailwind CSS · shadcn/ui (Radix) · react-hook-form · zod · nuqs
**Scope:** V0 of the Progsu Member Platform — member-facing onboarding + dashboard, plus internal admin surface.

---

## 0. Brand tokens (proposed, pending sign-off)

| Token                | Value                     | Usage                                        |
|----------------------|---------------------------|----------------------------------------------|
| `--background`       | `slate-50` / `white`      | Page background                              |
| `--foreground`       | `slate-900`               | Primary text                                 |
| `--muted`            | `slate-500`               | Secondary text, helper copy                  |
| `--border`           | `slate-200`               | Hairlines, table rules                       |
| `--accent` (primary) | `#2B5FD9` (indigo-600-ish)| Buttons, focus rings, active progress steps  |
| `--accent-foreground`| `white`                   | Text on accent buttons                       |
| `--success`          | `emerald-600`             | Verified badges, success toasts              |
| `--warning`          | `amber-600`               | Expiring OTP, soft warnings                  |
| `--destructive`      | `rose-600`                | Errors, destructive admin actions            |

**Accent rationale:** A single saturated blue (`#2B5FD9`) reads as "student/collegiate but not corporate gray." Paired with slate it keeps the UI calm for heavy admin tables. Deferred to user — see Open Questions §11.

**Dark mode:** out of scope for V0. Tokens are defined through shadcn's CSS-variable convention so a later dark theme is additive, not a rewrite.

**Typography:** `Inter` via `next/font`. Base 15px, `font-medium` for headings, `font-semibold` only on H1 + page titles. No display face for V0.

**Spacing scale:** Tailwind default. Page gutters `px-6 md:px-8`, cards `p-6`, dense admin rows `py-2.5`.

**Tone:** friendly-professional. Sentence case for buttons and headings (not Title Case), no exclamation points outside success toasts, no emoji.

---

## 1. Route map

### Public — `(marketing)` group, no auth

| Path              | Purpose                                           | Rendering | Auth        | Redirect rules                                              |
|-------------------|---------------------------------------------------|-----------|-------------|-------------------------------------------------------------|
| `/`               | Landing page explaining Progsu + single CTA.     | Server    | None        | If signed in and fully onboarded -> `/dashboard`.            |
| `/login`          | Magic-link / OAuth sign-in entry.                 | Server*   | None        | If signed in -> route through onboarding gate (see §7).     |
| `/legal/privacy`  | Privacy policy (source: Privacy agent).           | Server    | None        | —                                                           |
| `/legal/terms`    | Terms of service.                                 | Server    | None        | —                                                           |

\* `/login` shell is a server component; the actual form is a client island.

### Auth callback

| Path             | Purpose                                           | Rendering | Auth        | Redirect rules                                              |
|------------------|---------------------------------------------------|-----------|-------------|-------------------------------------------------------------|
| `/auth/callback` | Handle Supabase OAuth/magic-link exchange, set session cookie, bounce to next onboarding step or `/dashboard`. | Server (Route Handler + small page) | Partial | See §7 funnel. |

### Onboarding — `(onboarding)` group, auth required

| Path                          | Purpose                                                      | Rendering         | Auth | Redirect rules                                          |
|-------------------------------|--------------------------------------------------------------|-------------------|------|---------------------------------------------------------|
| `/onboarding/verify-email`    | Collect + verify student email with 6-digit OTP.             | Server + client form | Yes  | If `student_email_verified=true` -> next step.         |
| `/onboarding/profile`         | Collect profile (name, school, major, grad year, roles, etc.) | Server + client form | Yes  | Must have `student_email_verified=true`.                |
| `/onboarding/resume`          | Upload resume PDF.                                           | Server + client    | Yes  | Must have `profile_completed=true`.                     |
| `/onboarding/consent`         | 5 consent checkboxes.                                        | Server + client form | Yes  | Must have resume uploaded.                              |
| `/onboarding/done`            | Success screen; auto-redirect to `/dashboard` after 2s.      | Server            | Yes  | Must have all consents recorded; else bounce back.      |

### Member — `(app)` group, auth required, fully onboarded

| Path                  | Purpose                                                    | Rendering          | Auth | Redirect rules                                        |
|-----------------------|------------------------------------------------------------|--------------------|------|-------------------------------------------------------|
| `/dashboard`          | Landing for members — status card + quick actions.         | Server             | Yes  | If not fully onboarded -> §7 funnel.                  |
| `/dashboard/profile`  | View + edit profile.                                       | Server + client form | Yes  | —                                                     |
| `/dashboard/resume`   | Replace resume, view current version + history.            | Server + client    | Yes  | —                                                     |
| `/dashboard/settings` | Email prefs, recruiter opt-in toggle, delete account, consent re-review. | Server + client | Yes  | —                                                     |

### Admin — `(admin)` group, auth + `is_admin=true` server-enforced

| Path                         | Purpose                                             | Rendering                   | Auth | Redirect rules                                 |
|------------------------------|-----------------------------------------------------|-----------------------------|------|------------------------------------------------|
| `/admin`                     | Admin home: KPI cards + recent signups.             | Server                      | Admin | Non-admin -> `notFound()`.                    |
| `/admin/members`             | Filterable, paginated member table.                 | Server shell + client filters | Admin | Same.                                         |
| `/admin/members/[id]`        | Member detail (profile + resumes + consents + audit). | Server                      | Admin | Same; `notFound()` if member does not exist.  |
| `/admin/export`              | Export wizard (CSV now, ZIP later).                 | Server + client step        | Admin | Same.                                         |
| `/admin/settings/domains`    | Allowed student-email domains CRUD.                 | Server + client form        | Admin | Same.                                         |

**Rule:** Non-admin users hitting any `/admin/*` get a genuine `notFound()` (404) — never 403. We do not want to confirm the existence of the admin surface to members.

---

## 2. Layout shells

### 2.1 `app/(marketing)/layout.tsx`
Minimal shell: transparent top bar with logo + "Sign in" link, generous vertical padding, footer with legal links + copyright.

```
+-----------------------------------------------------------+
|  [Progsu]                                 Sign in  ->     |
+-----------------------------------------------------------+
|                                                           |
|                     {marketing children}                  |
|                                                           |
+-----------------------------------------------------------+
|  (c) 2026 Progsu   Privacy   Terms                        |
+-----------------------------------------------------------+
```

### 2.2 `app/(app)/layout.tsx`
Top nav, content container, no sidebar. Auth check happens in the layout server component; unauthenticated or incompletely-onboarded users are redirected before render (see §7).

```
+-----------------------------------------------------------+
|  [Progsu]   Dashboard  Profile  Resume  Settings     (AV) |
+-----------------------------------------------------------+
|                                                           |
|                    {app children}                         |
|                                                           |
+-----------------------------------------------------------+
```

- `(AV)` = avatar dropdown -> "Signed in as x@school.edu" · "Settings" · "Sign out".
- Active tab gets a 2px bottom border in `--accent`.
- Responsive: below `md`, tabs collapse into a hamburger that opens a Sheet.

### 2.3 `app/(admin)/layout.tsx`
Distinct visual treatment: slate-900 sidebar, off-white content area, persistent breadcrumb, admin badge pill near the logo so no one confuses it with the member app.

```
+---------------+-------------------------------------------+
| [Progsu ADMIN]|  Admin > Members > Jane Doe               |
|               +-------------------------------------------+
|  Members      |                                           |
|  Export       |                                           |
|  Settings     |         {admin children}                  |
|    Domains    |                                           |
|               |                                           |
|               |                                           |
|  -- AV --     |                                           |
+---------------+-------------------------------------------+
```

Server-side gate (pseudo):
```tsx
// app/(admin)/layout.tsx (server component)
export default async function AdminLayout({ children }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  const me = await getMember(session.userId);
  if (!me?.is_admin) notFound();         // <-- 404, not 403
  return <AdminShell>{children}</AdminShell>;
}
```

### 2.4 `app/(onboarding)/layout.tsx`
Centered single-column card (max-w-xl), horizontal progress indicator pinned to the top of the card, no nav chrome, no sign-in CTA. Sign-out accessible via a muted "Sign out" text link under the card.

```
+-----------------------------------------------------------+
|                                                           |
|   +---------------------------------------------------+   |
|   |  [1]--[2]--[3]--[4]                               |   |
|   |  Verify  Profile  Resume  Done                    |   |
|   |                                                   |   |
|   |   <step content>                                  |   |
|   |                                                   |   |
|   |   [  Continue  ]                                  |   |
|   +---------------------------------------------------+   |
|                                                           |
|                 Need to stop? Sign out                    |
+-----------------------------------------------------------+
```

The 4 visible steps in the indicator are: **Verify student email -> Complete profile -> Upload resume -> Done.** The consent step is intentionally collapsed into step 3's "Done" because consent is legally bundled with resume submission. (If Privacy agent insists consent is its own step, we add it as step 4 and relabel "Done" to step 5; see §11.)

---

## 3. Component map

All paths rooted at `/src`. shadcn components live in `components/ui/*` as generated; I only list the custom ones.

### 3.1 shadcn primitives used
`Button`, `Input`, `Label`, `Form` (+ field wrappers), `Dialog`, `Sheet`, `Table`, `Select`, `Badge`, `Toast` (sonner), `Tooltip`, `Checkbox`, `Separator`, `Card`, `Avatar`, `DropdownMenu`, `Breadcrumb`, `Progress`, `Skeleton`.

### 3.2 Custom components

| File                                                        | Props                                                                                      | Notes                                                                                   |
|-------------------------------------------------------------|--------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `components/brand/Logo.tsx`                                 | `size?: "sm" \| "md"`                                                                      | SVG wordmark. Used in every layout.                                                     |
| `components/brand/AdminBadge.tsx`                           | —                                                                                          | Small `Badge` variant reading "Admin" in accent.                                        |
| `components/onboarding/StepIndicator.tsx`                   | `currentStep: 1 \| 2 \| 3 \| 4`, `completedSteps: number[]`                                | Client component. aria-current on active step.                                          |
| `components/onboarding/StepShell.tsx`                       | `title: string`, `description?: string`, `children`, `footer`                              | Wraps each onboarding page's card.                                                      |
| `components/forms/LoginForm.tsx`                            | —                                                                                          | Client. Magic-link only for V0.                                                         |
| `components/forms/StudentEmailForm.tsx`                     | `defaultEmail?: string`                                                                    | Client. Issues OTP via server action.                                                   |
| `components/forms/OtpInput.tsx`                             | `length?: number = 6`, `onComplete: (code: string) => void`, `disabled?: boolean`          | Client. 6 individual inputs, auto-advance, paste-aware, arrow-key navigation.           |
| `components/forms/OtpResendTimer.tsx`                       | `cooldownSeconds: number`, `onResend: () => Promise<void>`                                 | Client. aria-live="polite" timer announcement.                                          |
| `components/forms/ProfileForm.tsx`                          | `defaultValues?: ProfileValues`, `mode: "onboarding" \| "edit"`                            | Client. Submits via server action; returns `{ok, errors}`.                              |
| `components/forms/SchoolSelect.tsx`                         | `value`, `onChange`                                                                        | Client. Combobox over allowed school list; plays nice with react-hook-form.             |
| `components/forms/RolesChipSelect.tsx`                      | `value: string[]`, `onChange`, `options: {value, label}[]`, `max?: number = 6`             | Client. Chip multi-select, max-enforcement, keyboard-accessible.                        |
| `components/forms/ResumeUploader.tsx`                       | `currentResume?: {url, filename, uploadedAt}`, `onUploaded: (r) => void`                   | Client. Drag-drop + progress + PDF/size guards + replace-flow.                          |
| `components/forms/ResumePreview.tsx`                        | `url: string`, `filename: string`                                                          | Client (lazy). Uses `<object>` with fallback link.                                      |
| `components/consent/ConsentBlock.tsx`                       | `name: string`, `label: ReactNode`, `version: string`, `href?: string`, `required?: bool`  | One checkbox row + inline link to legal text.                                           |
| `components/consent/ConsentGroup.tsx`                       | `blocks: ConsentBlockProps[]`, `onChange`                                                  | Thin wrapper that renders 5 ConsentBlocks.                                              |
| `components/admin/KpiCard.tsx`                              | `label: string`, `value: string \| number`, `delta?: string`                               | Server.                                                                                 |
| `components/admin/FilterSidebar.tsx`                        | `initialFilters: Filters`                                                                  | Client. url-synced via nuqs.                                                            |
| `components/admin/MemberTable.tsx`                          | `rows: MemberRow[]`, `page`, `pageSize`, `total`                                           | Server shell; client sort/select layered on top.                                        |
| `components/admin/MemberTableRow.tsx`                       | `member: MemberRow`, `onSelect?: (id) => void`                                             | Server.                                                                                 |
| `components/admin/VerifiedBadge.tsx`                        | `verified: boolean`                                                                        | Server.                                                                                 |
| `components/admin/MemberDetailPanel.tsx`                    | `memberId: string`                                                                         | Server wrapper that composes sub-panels below.                                          |
| `components/admin/MemberProfileCard.tsx`                    | `member: Member`                                                                           | Server.                                                                                 |
| `components/admin/ResumeHistoryList.tsx`                    | `resumes: Resume[]`                                                                        | Server.                                                                                 |
| `components/admin/ConsentHistoryList.tsx`                   | `consents: Consent[]`                                                                      | Server.                                                                                 |
| `components/admin/AuditLogList.tsx`                         | `entries: AuditEntry[]`                                                                    | Server.                                                                                 |
| `components/admin/ManualVerifyDialog.tsx`                   | `member: Member`                                                                           | Client. Typed-confirmation pattern ("type VERIFY to confirm").                          |
| `components/admin/ExportWizard.tsx`                         | `currentFilters: Filters`                                                                  | Client. Multi-step wizard with preview count.                                           |
| `components/admin/ExportButton.tsx`                         | `filters: Filters`, `format: "csv"`                                                        | Client. Calls server action, streams file.                                              |
| `components/admin/DomainAllowlistTable.tsx`                 | `domains: Domain[]`                                                                        | Server shell + client add/remove.                                                       |
| `components/shared/EmptyState.tsx`                          | `title`, `description?`, `action?: ReactNode`, `icon?: ReactNode`                          | Reused everywhere.                                                                      |
| `components/shared/PageHeader.tsx`                          | `title`, `description?`, `actions?: ReactNode`                                             | Consistent H1 block.                                                                    |
| `components/shared/UserMenu.tsx`                            | `user: {email, name?, avatarUrl?}`                                                         | Client. DropdownMenu-based avatar menu.                                                 |
| `components/shared/SignOutButton.tsx`                       | `variant?`                                                                                 | Client, calls server action.                                                            |

### 3.3 Shared helpers

| File                                       | Purpose                                                               |
|--------------------------------------------|-----------------------------------------------------------------------|
| `lib/schemas/profile.ts`                   | zod schemas for profile, student email, OTP, consent.                 |
| `lib/schemas/admin.ts`                     | zod schemas for filters, manual-verify, domain CRUD.                  |
| `lib/onboarding/funnel.ts`                 | Pure function `nextOnboardingStep(member) -> Path \| null`.            |
| `lib/auth/guards.ts`                       | `requireSession`, `requireAdmin`, `requireOnboarded`.                 |
| `lib/format/dates.ts`                      | `formatRelativeTime`, `formatDate` (en-US).                           |
| `lib/searchParams.ts`                      | nuqs parsers for admin filters.                                       |

---

## 4. Form fields + validation

**Global zod conventions:** trim strings, reject empty strings (`z.string().min(1)`), lowercase all emails, coerce numbers, return inline `{field: "message"}` on server-action failure. Error messages are sentence-case, no periods.

### 4.1 `/login`

| Field   | Type  | Required | Zod rule                                  | UX notes                                        |
|---------|-------|----------|-------------------------------------------|-------------------------------------------------|
| email   | email | Yes      | `z.string().trim().toLowerCase().email()` | autofocus; autoComplete="email"; submit on Enter |

Submit -> server action `sendMagicLink`. On success, swap card to "Check your inbox" state with a "Try a different email" link.

### 4.2 `/onboarding/verify-email`

Two sub-forms on the same page, state-machined.

**Stage A — enter student email:**

| Field        | Type  | Required | Zod rule                                                                                              | UX notes                                                                               |
|--------------|-------|----------|-------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| studentEmail | email | Yes      | `z.string().trim().toLowerCase().email().refine(domainAllowed, "That email domain is not supported.")` | Helper text: "Use your .edu address." Domain check is server-side against allowlist.   |

**Stage B — enter OTP:**

| Field | Type   | Required | Zod rule                                        | UX notes                                                                                                    |
|-------|--------|----------|-------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| code  | string | Yes      | `z.string().regex(/^\d{6}$/, "Enter the 6-digit code.")` | OtpInput auto-submits on 6 digits. Resend disabled for 60s. Expires in 10 min (see Auth doc). |

### 4.3 `/onboarding/profile` (and `/dashboard/profile`)

| Field               | Type          | Required | Zod rule                                                                                                           | UX notes                                                                                        |
|---------------------|---------------|----------|--------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| firstName           | string        | Yes      | `z.string().trim().min(1, "Required").max(60)`                                                                     | autoComplete="given-name"                                                                       |
| lastName            | string        | Yes      | `z.string().trim().min(1, "Required").max(60)`                                                                     | autoComplete="family-name"                                                                      |
| preferredName       | string        | No       | `z.string().trim().max(60).optional()`                                                                             | Helper: "Shown to recruiters instead of your legal first name."                                 |
| pronouns            | enum+custom   | No       | `z.enum(["she/her","he/him","they/them","other"]).optional()` + `pronounsCustom?`                                  | If "other", show free-text max 30.                                                              |
| school              | enum (select) | Yes      | `z.string().min(1)` validated server-side against `allowed_schools` table                                           | Combobox with typeahead.                                                                        |
| major               | string        | Yes      | `z.string().trim().min(1).max(120)`                                                                                | Free text for V0; link majors taxonomy later.                                                   |
| minor               | string        | No       | `z.string().trim().max(120).optional()`                                                                            |                                                                                                 |
| gradYear            | number        | Yes      | `z.coerce.number().int().min(currentYear).max(currentYear + 7)`                                                    | Select dropdown pre-populated with current year +0..+6.                                         |
| gradTerm            | enum          | No       | `z.enum(["Spring","Summer","Fall","Winter"]).optional()`                                                           |                                                                                                 |
| gpa                 | number        | No       | `z.coerce.number().min(0).max(4.0).optional()`                                                                     | Helper: "Optional. Shown only if you opt in."                                                   |
| linkedinUrl         | url           | No       | `z.string().trim().url().regex(/linkedin\.com\//, "That does not look like a LinkedIn URL.").optional().or(z.literal(""))` |                                                                                                 |
| githubUrl           | url           | No       | Same pattern as LinkedIn, regex for `github.com/`                                                                  |                                                                                                 |
| portfolioUrl        | url           | No       | `z.string().trim().url().optional().or(z.literal(""))`                                                             |                                                                                                 |
| phone               | string        | No       | `z.string().trim().regex(/^\+?[\d\-\s()]{7,20}$/).optional().or(z.literal(""))`                                    | autoComplete="tel"                                                                              |
| locationCity        | string        | No       | `z.string().trim().max(80).optional()`                                                                             | For recruiter filtering.                                                                        |
| workAuth            | enum          | Yes      | `z.enum(["citizen","permanent_resident","visa_no_sponsorship","visa_sponsorship_needed","other"])`                 | Sensitive — see Privacy agent.                                                                  |
| interestedRoles     | string[]      | Yes      | `z.array(z.string()).min(1, "Pick at least one.").max(6, "Max 6 roles.")`                                         | **Chip multi-select**, not native select. See §4.3a.                                           |
| openToInternships   | boolean       | No       | `z.boolean().default(false)`                                                                                       |                                                                                                 |
| openToFullTime      | boolean       | No       | `z.boolean().default(false)`                                                                                       |                                                                                                 |

#### 4.3a `interested_roles` — chip multi-select, max 6

**Why chips, not native multi-select:**
1. Native `<select multiple>` has terrible touch UX and poor discoverability.
2. Chips make selected state visible at a glance; students are making tradeoffs between roles.
3. Accessible keyboard model is well-trod (Radix Tags Input pattern + combobox).
4. We can show a live count ("3 of 6 selected") which enforces the cap gently.

**Why max 6:**
- Empirically, students who tag 8+ roles become low-signal for recruiters (the filter collapses to "they want any job"). 6 is enough to express "backend or infra or SWE or ML or data or devops" without degrading the filter's usefulness.
- Keeps the row rendering in the admin table bounded so cells don't wrap unpredictably.
- If the user tries to add a 7th chip, we show an inline toast: "You can pick up to 6 roles. Remove one to add another." and do not select it.

**Role options (starter list, edit before launch):**
`["Software Engineering (General)", "Backend", "Frontend", "Full-stack", "Mobile", "Infrastructure / DevOps", "Machine Learning", "Data Science", "Data Engineering", "Security", "Embedded / Systems", "Product Management", "Quant", "Research", "Design Engineering"]`

### 4.4 `/onboarding/resume` (and `/dashboard/resume`)

| Field   | Type | Required | Zod rule                                                                                                                                                   | UX notes                                                                   |
|---------|------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| resume  | File | Yes      | `z.instanceof(File).refine(f => f.type === "application/pdf", "PDF only.").refine(f => f.size <= 5 * 1024 * 1024, "Max 5 MB.")` (server also re-validates) | Drag-drop zone, progress bar, preview, replace flow. MIME sniffed server-side. |

### 4.5 `/onboarding/consent`

**Wording is placeholder pending Privacy agent final copy. See §5.5.** All five are tracked individually (one row per block in `consents` table, with `version` + `accepted_at`).

| Field                       | Type    | Required     | Zod rule                                                                                   | UX notes                                                                  |
|-----------------------------|---------|--------------|--------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| consentTerms                | boolean | Yes          | `z.literal(true, { errorMap: () => ({message: "Required to continue."}) })`                | Links to `/legal/terms`.                                                  |
| consentPrivacy              | boolean | Yes          | same                                                                                       | Links to `/legal/privacy`.                                                |
| consentResumeSharing        | boolean | Yes          | same                                                                                       | Explains what we do with the resume.                                      |
| consentRecruiterOptIn       | boolean | No (opt-in)  | `z.boolean().default(false)`                                                               | Not required to finish onboarding. Editable later from Settings.          |
| consentCommsOptIn           | boolean | No (opt-in)  | `z.boolean().default(false)`                                                               | Non-transactional emails. Editable later.                                 |

### 4.6 Admin filters — `/admin/members`

All optional; URL-synced.

| Field                 | Type               | Zod rule                                            | UX notes                                                 |
|-----------------------|--------------------|-----------------------------------------------------|----------------------------------------------------------|
| q                     | string             | `z.string().trim().max(120).optional()`             | Debounced 300ms, searches name + student email.          |
| school                | string[]           | `z.array(z.string()).optional()`                    | Multi-select checkboxes.                                 |
| major                 | string             | `z.string().optional()`                             | Free text contains-match.                                |
| gradYearMin/Max       | number             | `z.coerce.number().int().optional()`                | Number inputs.                                           |
| roles                 | string[]           | `z.array(z.string()).optional()`                    | Chip group.                                              |
| verified              | `"any"\|"yes"\|"no"` | `z.enum(["any","yes","no"]).default("any")`        | Segmented control.                                       |
| hasResume             | same               | same                                                | Segmented control.                                       |
| openToRecruiters      | same               | same                                                | Segmented control.                                       |
| sort                  | enum               | `z.enum(["created_desc","created_asc","name_asc","grad_year_asc"]).default("created_desc")` | Dropdown on table header.                |
| page                  | number             | `z.coerce.number().int().min(1).default(1)`         |                                                          |
| pageSize              | enum               | `z.enum(["25","50","100"]).default("25")`           |                                                          |

### 4.7 Admin manual-verify dialog

| Field             | Type   | Required | Zod rule                                                                       | UX notes                                                                 |
|-------------------|--------|----------|--------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| reason            | string | Yes      | `z.string().trim().min(10, "Please give a short reason for the audit log.")` | Stored in audit log.                                                     |
| typedConfirmation | string | Yes      | `z.literal("VERIFY")`                                                          | User must type the word VERIFY to enable the destructive-styled button.  |

---

## 5. UX copy

All copy is in sentence case. One space after periods. No em-dashes in body copy; hyphens only.

### 5.1 Landing (`/`)

**Headline**
```
Your college career, in one profile.
```

**Subhead**
```
Progsu is the member platform for student engineering organizations. Verify your student status, upload a resume, and reach vetted recruiters.
```

**Primary CTA**
```
Sign in with your school email
```

Sub-CTA (muted link, below button)
```
Learn how it works
```

### 5.2 `/login`

**Page title**
```
Sign in
```

**Body**
```
We will email you a one-time link. No passwords to remember.
```

**Input label**
```
Email
```

**Input placeholder**
```
you@school.edu
```

**Submit button**
```
Send sign-in link
```

**Post-submit state (swap-in card)**
```
Check your inbox
We sent a sign-in link to {email}. The link is valid for 15 minutes.
```

**Secondary action**
```
Use a different email
```

### 5.3 OTP email (content lives in Auth doc, coordinated here)

**Subject**
```
Your Progsu verification code: {CODE}
```

**Plain-text body**
```
Hi,

Your Progsu student email verification code is:

    {CODE}

This code expires in 10 minutes. If you didn't request it, you can ignore this email.

- The Progsu team
```

**HTML body (same content, minimal styling)** — preheader: `Your 6-digit code for Progsu student verification.`

### 5.4 Onboarding step copy

**Step 1 — `/onboarding/verify-email`**

Heading
```
Verify your student email
```
Helper
```
Enter your .edu address. We will send a 6-digit code to confirm you are a current student.
```
Submit
```
Send code
```

**OTP stage**

Heading
```
Enter your code
```
Helper
```
We sent a code to {studentEmail}. It is valid for 10 minutes.
```
Resend link (after cooldown)
```
Resend code
```
Cooldown microcopy (aria-live polite)
```
You can resend in {n}s.
```

**Step 2 — `/onboarding/profile`**

Heading
```
Tell us about you
```
Helper
```
This is the profile vetted recruiters will see. You can edit it any time.
```
Submit
```
Save and continue
```

**Step 3 — `/onboarding/resume`**

Heading
```
Upload your resume
```
Helper
```
PDF only, up to 5 MB. You can replace this later from your dashboard.
```
Dropzone idle
```
Drag a PDF here, or click to choose a file.
```
Dropzone hover / active
```
Drop to upload.
```
Progress
```
Uploading {filename}... {percent}%
```
Replace flow header
```
Replace your current resume
```
Submit
```
Continue
```

**Consent sub-step (inside step 3 or standalone — see §11)**

Heading
```
Review and agree
```
Helper
```
Before we finish, please confirm how your information will be used. Items marked required are needed to finish your profile.
```
Submit
```
Agree and finish
```

**Step 4 — `/onboarding/done`**

Heading
```
You're all set.
```
Body
```
We have everything we need. You can always update your profile and resume from the dashboard.
```
Auto-redirect microcopy
```
Taking you to your dashboard...
```

### 5.5 Consent checkboxes — EXACT wording (PLACEHOLDER, defer to Privacy agent)

> **Reasoning inline:** Wording below is drafted so Privacy agent can diff-edit. Every block states the act, the actor, the scope, and (where relevant) the retention period. All strings store a `version` string (`"v1"` on launch) so changes later trigger a re-consent flow.

1. **Terms of service** (required)
```
I agree to the Progsu Terms of Service.
```
Inline link: `Read the terms` -> `/legal/terms`.

2. **Privacy policy** (required)
```
I have read and agree to the Progsu Privacy Policy, including how my information is collected, stored, and shared with Progsu officers and vetted recruiters.
```
Inline link: `Read the policy` -> `/legal/privacy`.

3. **Resume + profile sharing with recruiters** (required to receive recruiter outreach; currently required to complete onboarding — **flag for Privacy**)
```
I consent to Progsu sharing my profile and resume with recruiters at organizations that Progsu has vetted, for the purpose of career opportunities in engineering and related fields.
```

4. **Recruiter direct contact opt-in** (optional)
```
I agree to allow vetted recruiters to contact me directly using the email associated with my Progsu account.
```

5. **Non-transactional communications opt-in** (optional)
```
I would like to receive occasional announcements from Progsu about events, opportunities, and product updates. I can unsubscribe any time.
```

**Open issue for Privacy agent:** should item 3 be required-to-complete-profile or required-to-appear-in-recruiter-searches? These are different products. Current placeholder assumes the former.

### 5.6 Empty states

Members table — no results after filtering
```
No members match these filters.
Try clearing a filter, or search by name or email.
[ Clear filters ]
```

Members table — zero members overall
```
No members yet.
Once students verify their email, they will appear here.
```

Dashboard — no resume uploaded (should not happen post-onboarding, but defense-in-depth)
```
No resume on file.
Upload a PDF so recruiters can see your most recent work.
[ Upload resume ]
```

Admin member detail — no audit log
```
No activity yet.
```

### 5.7 Error states

| Condition                                  | Toast / inline copy                                                                                   |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------|
| Invalid OTP                                | `That code is not correct. Check your email and try again.`                                           |
| Expired OTP                                | `That code has expired. We can send you a new one.` (CTA: `Send a new code`)                          |
| Too many OTP attempts                      | `Too many attempts. Please wait 15 minutes before trying again.`                                      |
| File too big                               | `That file is over 5 MB. Try a smaller PDF.`                                                          |
| Wrong mime type                            | `We only accept PDF files.`                                                                           |
| Corrupt / unreadable PDF                   | `We could not read that PDF. Export a fresh copy and try again.`                                      |
| Domain not allowed                         | `That email domain is not supported. Please use your school email.`                                   |
| Duplicate student email                    | `That student email is already in use on another Progsu account. Contact support if this is a mistake.` |
| Network / server error (generic)           | `Something went wrong. Please try again.`                                                             |
| Unauthorized (session expired mid-action)  | `Your session expired. Please sign in again.` (button: `Sign in`)                                     |
| Non-admin tries admin action               | 404 page (no message).                                                                                |
| Manual-verify typed confirmation mismatch  | `Type VERIFY exactly to continue.`                                                                    |

### 5.8 Success states

| Condition            | Toast                                                                          |
|----------------------|--------------------------------------------------------------------------------|
| Profile saved        | `Profile saved.`                                                               |
| Resume uploaded      | `Resume uploaded.`                                                             |
| Resume replaced      | `New resume saved. The old version is archived.`                               |
| Student email verified | `Student email verified.`                                                    |
| Consent updated      | `Your preferences are up to date.`                                             |
| Account deleted      | `Your account and data have been deleted.` (full page, not toast)              |

### 5.9 Admin copy

**No results (filtered)** — see §5.6.

**Export success**
```
Export ready.
We built a CSV with {count} members matching your filters.
[ Download CSV ]
```

**Manual verify confirmation dialog**

Title
```
Manually verify {name}?
```
Body
```
This marks the member's student email as verified without the email OTP flow. Use this for edge cases like domain changes or lost inboxes. This action is logged.
```
Reason label
```
Reason (logged)
```
Typed-confirmation label
```
Type VERIFY to confirm
```
Button
```
Verify member
```

---

## 6. Progress indicator behavior

The `StepIndicator` renders 4 steps. States per step:

| State      | Visual                                                                  | Interactivity                                         |
|------------|-------------------------------------------------------------------------|-------------------------------------------------------|
| active     | Filled accent circle with step number, bold label, dotted ring for focus | Not a link (you are here).                           |
| done       | Accent circle with check icon, regular-weight label                     | Is a link. Clicking returns to that step (editable). |
| locked     | Slate-200 circle with slate-400 number, slate-400 label                 | Not a link. `aria-disabled="true"`.                   |

Rules:
- You can always go back to any *done* step (they remain editable until the account is marked fully onboarded).
- You cannot jump forward to a *locked* step; clicking does nothing (and the element has `aria-disabled`).
- On server-side redirect (see §7), if the user tries to hit a later step via URL and has not completed the prior ones, they are bounced to the earliest incomplete step.
- The connector line between steps is slate-200 until a step becomes done, then accent.

ASCII states:

```
Active at step 2, step 1 done, steps 3-4 locked:

  (v)-----(2)-----(3)-----(4)
  Verify  Profile Resume  Done
  done    active  locked  locked
```

Mobile: steps collapse to a compact "Step 2 of 4" label above the card, with the full indicator hidden behind a disclosure.

---

## 7. Routing guards

All guards are server-side in `(group)/layout.tsx` (`redirect()` before render).

Pseudo-code `lib/onboarding/funnel.ts`:
```ts
export function nextOnboardingStep(m: Member): string | null {
  if (!m.student_email_verified) return "/onboarding/verify-email";
  if (!m.profile_completed)      return "/onboarding/profile";
  if (!m.has_resume)             return "/onboarding/resume";
  if (!m.required_consents_ok)   return "/onboarding/consent";
  return null; // fully onboarded
}
```

Cascade applied:

| Source                                           | Condition                                                 | Redirect                                        |
|--------------------------------------------------|-----------------------------------------------------------|-------------------------------------------------|
| Any non-public route                             | No session                                                | `/login?next={requestedPath}`                   |
| Any `(app)` or `(onboarding)` route              | `nextOnboardingStep(me) !== null` and requested path !== that step | `nextOnboardingStep(me)`              |
| `(onboarding)` route                             | `nextOnboardingStep(me) === null`                         | `/dashboard`                                    |
| `/onboarding/verify-email`                       | already verified                                          | next step                                       |
| `/onboarding/profile`                            | profile not ready AND email not verified                  | `/onboarding/verify-email`                      |
| `/onboarding/resume`                             | profile not done                                          | `/onboarding/profile`                           |
| `/onboarding/consent`                            | no resume                                                 | `/onboarding/resume`                            |
| `/admin/*`                                       | signed in, not admin                                      | `notFound()` (404)                              |
| `/admin/*`                                       | signed in, admin, but NOT fully onboarded as a member     | Still allowed — admins can bypass the funnel on admin routes. |
| `/login` or `/`                                  | signed in AND fully onboarded                             | `/dashboard`                                    |

**Post-login redirect:** honor the `?next=` query param iff it resolves to a safe relative path we own and the user is allowed to view it (re-run the funnel before honoring).

---

## 8. Admin dashboard layout

All widths assume ~1280px content width.

### 8.1 `/admin/members`

```
+--------------------+---------------------------------------------------------------+
| Filters            |  Members                              [ Export CSV ]          |
|                    |  248 total, 42 verified today                                  |
|                    |  Search: [___________________ q ___________________]           |
|                    +---------------------------------------------------------------+
|  School            | Name              Student email               School  '27  Maj|
|  [ ] MIT           |  Jane Doe         jane@mit.edu    [verified]  MIT     '27  CS |
|  [ ] Stanford      |  John Q           john@cmu.edu    [pending ]  CMU     '26  EE |
|  [ ] CMU           |  Ana R            ana@stanford.. [verified]  SU      '27  CS |
|  [ ] Harvard       |  ...                                                           |
|  [ ] Show all...   |                                                                |
|                    |                                                                |
|  Major             |                                                                |
|  [________ typ ]   |                                                                |
|                    |                                                                |
|  Grad year         |                                                                |
|  From [2026]       |                                                                |
|  To   [2030]       |                                                                |
|                    |                                                                |
|  Roles             |                                                                |
|  [Backend x]       |                                                                |
|  [Frontend x]      |                                                                |
|  [ + add ]         |                                                                |
|                    |                                                                |
|  Verified          |                                                                |
|  ( any )(yes)(no)  |                                                                |
|                    |                                                                |
|  Has resume        |                                                                |
|  ( any )(yes)(no)  |                                                                |
|                    |                                                                |
|  Open to recruiters|                                                                |
|  ( any )(yes)(no)  |                                                                |
|                    |                                                                |
|  [ Clear filters ] |                                                                |
|                    +---------------------------------------------------------------+
|                    | Sort: Created v    Rows: 25 v     < 1 2 3 ... 10 >             |
+--------------------+---------------------------------------------------------------+
```

**Table columns (full set, scrollable horizontally below md):**
`[ checkbox ] | Name | Student email + verified badge | School | Grad year | Major | Resume (icon link) | Opted in to recruiters (bool icon) | Created | Actions (kebab) `

**Row actions (kebab menu):**
- View details
- Manually verify... (only if not verified)
- Copy student email
- Mark open-to-recruiters off... (only when on)

### 8.2 `/admin/members/[id]`

```
+---------------------------------------+---------------------------------------+
|  Jane Doe                             |  Resumes                              |
|  jane@mit.edu   [verified]            |   v3  2026-04-10  jane_v3.pdf  [view] |
|  MIT · CS · '27                       |   v2  2026-03-02  jane_v2.pdf  [view] |
|                                       |   v1  2026-01-14  jane_v1.pdf  [view] |
|  Pronouns: she/her                    |                                       |
|  Preferred: Janey                     +---------------------------------------+
|  LinkedIn: /in/jane                   |  Consents                             |
|  GitHub:   gh/janedoe                 |   Terms v1         2026-01-14         |
|  Phone:    +1 ...                     |   Privacy v1       2026-01-14         |
|  City:     Cambridge, MA              |   Resume sharing v1 2026-01-14        |
|  Work auth: Citizen                   |   Recruiter opt-in  2026-03-02 (on)   |
|  Roles: Backend, ML, Infra            |   Comms opt-in      2026-03-02 (on)   |
|  Open to: Internships, Full-time      |                                       |
|                                       +---------------------------------------+
|  [ Edit profile (admin override) ]    |  Audit log                            |
|  [ Resend OTP ]                       |   2026-04-10 uploaded resume v3       |
|  [ Manually verify... ]  (disabled)   |   2026-03-02 toggled recruiter opt-in |
|  [ Deactivate account ]               |   2026-01-14 verified student email   |
|                                       |   2026-01-14 completed profile        |
+---------------------------------------+---------------------------------------+
```

### 8.3 `/admin/export`

```
+---------------------------------------------------------------+
|  Export members                                                |
|                                                                |
|  Who can export:                                               |
|  Only admins can export member data, and exports are logged    |
|  in the audit log. Handle downloads per the privacy policy.    |
|                                                                |
|  Step 1 - filter                                               |
|   [ Use current filter set: school=MIT, verified=yes ]         |
|   [ Edit filters ]                                             |
|                                                                |
|  Step 2 - preview                                              |
|   This will export 37 members.                                 |
|   Columns: Name, Student Email, School, Major, Grad Year,      |
|   Roles, Work Auth, Opted in to Recruiters, Resume URL.        |
|                                                                |
|  Step 3 - download                                             |
|   [ Download CSV ]                                             |
|                                                                |
|  Could-ship (V0.5): [ Include resume ZIP ]  (disabled)          |
|   Bundles resumes for the 37 members as a single ZIP.          |
|   Not available in V0.                                         |
+---------------------------------------------------------------+
```

---

## 9. Accessibility baseline

- **Labels:** every input has a visible `<Label>` associated via `htmlFor`. No placeholder-as-label.
- **OTP input:** each of the 6 inputs has `aria-label="Digit {n} of 6"`. Auto-advance on input, move focus on Backspace when empty, paste splits into 6.
- **OTP resend timer:** wrapped in `<div role="status" aria-live="polite">` so screen readers announce "You can resend in 54s..." then "Resend now." Announcements are throttled to once every 10s until the final state.
- **Dialogs:** shadcn/Radix already handles focus-trap, return-focus on close, `Escape` to close. Destructive dialogs (Manual verify, Delete account) have the primary action focused *last* so tab-order encourages cancel-first.
- **Tables:** caption element for the admin table summarizing filters; `scope="col"` on headers; row-level links on Name cell (not row-click) so screen-reader users can navigate cells; keyboard: `Enter` on a row opens detail; arrow keys move row-to-row when body has `role="grid"` semantics. Selection checkboxes are reachable via tab.
- **Focus management:** on client-side route transitions (wizard steps), the first heading of the new step receives `tabIndex={-1}` and is focused to anchor the screen reader.
- **Color contrast:** all body text meets WCAG AA (4.5:1). `--accent` tested on white background (contrast ratio 5.6:1 at `#2B5FD9`). Verified badges also carry an icon + text, not color alone.
- **Error association:** every invalid field gets `aria-invalid="true"` and `aria-describedby` referencing the error message id.
- **Reduced motion:** step transitions, dropzone hover lift, and toast slides all wrapped in `prefers-reduced-motion: reduce` fallbacks (no transform, opacity-only).
- **Skip link:** every layout starts with a visually-hidden `"Skip to main content"` anchor pointing to `<main id="main">`.

---

## 10. Performance notes

- **Server components by default.** Admin table shell, member detail panels, consent history, audit log, KPI cards: all server rendered. Data fetched with `unstable_cache` keyed by filter signature, 30s TTL for KPIs.
- **Client islands only where interactive.** `FilterSidebar`, `MemberTable` sort + selection, `ExportWizard`, `ResumeUploader`, `OtpInput`, `ProfileForm`, `RolesChipSelect`, `UserMenu`, `ManualVerifyDialog`.
- **URL-synced filters.** `nuqs` for typed search-params, so server components re-render on filter change and there is no client-side re-fetch round-trip. Back/forward buttons work, filter URLs are shareable among admins.
- **Streaming.** The admin detail page uses `<Suspense>` to stream the profile card first; resumes, consents, and audit log each stream independently so a slow audit query does not block the rest.
- **Pagination.** Server-side, offset-based at V0. Keyset at V1 if tables exceed ~5k rows.
- **Image optimization.** Avatars (if/when enabled) served via `next/image` with `sizes="40px"`; loader left at default (no external CDN dependency in V0).
- **Bundle discipline.** No client-side PDF parsing (server does MIME sniff). No date library on the client path — `Intl.DateTimeFormat` suffices. `framer-motion` explicitly out; CSS transitions only.
- **Edge where safe.** Marketing routes and `/login` can run on the Edge runtime. Member and admin routes stay on Node runtime (DB driver + file handling).
- **Prefetch.** Links to `/onboarding/*` inside the funnel use `prefetch={true}` so the next step is warm before the user clicks Continue.

---

## 11. Open questions (for user + other agents)

1. **Brand accent color.** Placeholder `#2B5FD9`. Needs sign-off, or a Progsu-specific token pulled from the logo. (User.)
2. **Consent wording + versioning.** §5.5 is a draft. Privacy agent should own the final strings, version bumps, and re-consent triggers.
3. **Is `consentResumeSharing` required to complete onboarding, or required only to be visible in recruiter searches?** (Privacy agent + user.)
4. **Source of the `/legal/privacy` and `/legal/terms` content** — do we author or does Legal supply? (User.)
5. **Dark mode.** Declared out of scope; confirm we are not launching with both light and dark.
6. **Admin sign-off on onboarding skip.** Currently admins with `is_admin=true` but incomplete profile can view `/admin/*`; is that the desired behavior?
7. **Role taxonomy.** §4.3a list is a starter. Should match whatever the admin filter pulls from so labels stay in sync — Database agent to define the authoritative enum table.
8. **School allowlist bootstrap.** Which schools ship in V0? (User.)
9. **Resume ZIP export.** Flagged Could-ship. Confirm V0 excludes it.
10. **Analytics/event tracking.** Not scoped here. If present, we need event names per form submit and error surface (defer to Platform agent).
11. **Email provider for OTP.** Coordinated copy but sender identity / DKIM owned by Auth agent.
12. **Session-expired UX.** Current spec shows a toast + re-login button. Should mid-form session expiry preserve draft data in localStorage? (Nice-to-have, call it out for V0.5.)

---
