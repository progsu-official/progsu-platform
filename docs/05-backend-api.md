# Progsu Member Platform — Backend / API Design (V0)

Owner: Backend/API Engineer agent
Last updated: 2026-04-21
Status: V0 design, pre-build

Scope: This document specifies every backend surface for the Progsu V0 member platform — server actions, request/response shapes, zod validation, the resume upload flow, CSV export, admin queries, rate limits, error handling, webhooks, and environment variables. Auth, DB, and Storage docs own their respective internals; this doc owns the wire between the web UI and those systems.

---

## 0. Principles & Locked-in Stack

- **Next.js 15 + App Router.** Server Actions (`"use server"`) are the default surface for mutation and for authenticated reads that aren't static. Route handlers are reserved for webhooks and the Supabase OAuth callback.
- **zod** at every trust boundary. Inputs from the client are always parsed with a schema before they touch the DB or Storage.
- **Two Supabase clients**:
  - `createServerClient()` from `@supabase/ssr` — scoped to the current request's auth cookies, RLS-enforced. Used for any action running as the signed-in user.
  - `createServiceRoleClient()` — a process-level admin client keyed by `SUPABASE_SERVICE_ROLE_KEY`. Used for privileged reads (admin list/export), audit-log inserts, SECURITY DEFINER calls, and anything that must run without RLS.
- **Drizzle** for typed queries where RLS is not enforced (admin list, export, reporting). Drizzle runs under the service-role connection; all of its gating is explicit, in-code.
- **Supabase JS** for user-context reads/writes where RLS is doing the authorization work (member reading their own profile, uploading to their own folder).
- **Resume upload**: server-signed upload URL pattern, never client-signed. Server owns the path namespace `{user_id}/{resume_id}.pdf`.
- **CSV export**: server-side generation, streamed response. No client-side data fetch + CSV assembly.
- **Pagination**: offset pagination for V0 (simpler, fine at our row counts), hard cap at page 1000. Cursor pagination is future work (see §11).
- **Idempotency**: mutations that would double-write (resume finalize, consent record) are idempotent-by-intent — they check current state before writing.

Everything else follows from these.

---

## 1. Server-Action Inventory

File layout convention:

```
src/
  actions/
    auth.ts            // signOut, requestStudentEmailCode, verifyStudentEmailCode
    profile.ts         // updateProfile, setOpenToRecruiters
    resume.ts          // createResumeUploadUrl, finalizeResumeUpload, deleteResume
    consent.ts         // recordConsent, requestAccountDeletion
    admin/
      members.ts       // adminListMembers, adminGetMember, adminSetManualVerification
      domains.ts       // adminAddSchoolDomain, adminToggleSchoolDomain
      export.ts        // adminExportRecruiterCSV
      storage.ts       // adminGetSignedResumeUrl
  lib/
    safeAction.ts      // wrapper (see §8)
    rateLimit.ts
    supabase/
      server.ts        // createServerClient()
      service.ts       // createServiceRoleClient()
    audit.ts           // writeAuditRow(...)
```

### 1.1 User-facing actions

| Action | File | Auth | Zod input | Success data | Side effects | Rate limit |
|---|---|---|---|---|---|---|
| `signOut` | `actions/auth.ts` | Session | `z.void()` | `{ redirectTo: string }` | Clears Supabase cookies; redirects to `/`. | None (trivial). |
| `requestStudentEmailCode` | `actions/auth.ts` | Session, `student_email_verified=false` not required (re-verify allowed) | `{ studentEmail: string }` | `{ expiresInSeconds: number }` | **Defer to Auth doc.** This action generates+hashes OTP, writes row, sends Resend email. This doc only documents the seam. | 3 / 15 min / user. |
| `verifyStudentEmailCode` | `actions/auth.ts` | Session | `{ studentEmail: string, code: string }` | `{ studentEmailVerified: true }` | Writes `school_email_verifications` row; flips `profiles.student_email_verified=true`. | 5 attempts / 15 min / user; lockout at 5 (see Auth doc). |
| `updateProfile` | `actions/profile.ts` | Session | Partial profile (see §2.3) | `{ profile: Profile, profileCompleted: boolean }` | Upsert into `profiles`. Flips `profile_completed=true` IFF all required fields present. | 30 / min / user. |
| `setOpenToRecruiters` | `actions/profile.ts` | Session | `{ openToRecruiters: boolean }` | `{ openToRecruiters: boolean }` | Updates `profiles.open_to_recruiters`. Writes audit only if value actually changed. | 30 / min / user. |
| `createResumeUploadUrl` | `actions/resume.ts` | Session, `student_email_verified=true` | `z.void()` | `{ resumeId: string, path: string, signedUrl: string, expiresIn: number }` | Inserts `resumes` row with `is_current=false`; calls Storage `createSignedUploadUrl`. | 10 / hour / user. |
| `finalizeResumeUpload` | `actions/resume.ts` | Session | `{ resumeId: string }` | `{ resumeId: string, isCurrent: true, sizeBytes: number }` | HEADs the Storage object; validates size ≤ 10 MB and `content-type: application/pdf`; calls SECURITY DEFINER `set_current_resume(resume_id)` (flips prior current to false, this one to true); writes audit; sends "resume updated" email via Resend (fire-and-forget). | 10 / hour / user. |
| `deleteResume` | `actions/resume.ts` | Session, owner | `{ resumeId: string }` | `{ resumeId: string, deletedAt: string }` | **Own-only, soft-delete** (sets `deleted_at`, does NOT remove Storage object in V0). If resume is current, clears `is_current` and the member has no current resume until they upload another. Writes audit. Hard-delete of storage objects is a future cron job. | 10 / hour / user. |
| `recordConsent` | `actions/consent.ts` | Session | `{ consentType, accepted, version }` | `{ consentId, recordedAt }` | Appends row to `consents` with IP + UA captured from request headers (via `headers()` helper). Never updates — always append. | 60 / hour / user. |
| `requestAccountDeletion` | `actions/consent.ts` | Session | `{ reason?: string }` | `{ requestedAt: string }` | V0: writes `account_deletion_requests` row, writes audit, sends Resend email to `admin@progsu.org`. Actual deletion is a manual admin action. | 3 / day / user. |

**Rationale for `deleteResume` being own-only**: in V0 only the member can soft-delete their resume. Admins cannot delete member resumes — they can only un-verify or escalate to full account deletion. This preserves "admin never touches member-owned artifacts" as a V0 property and simplifies audit semantics.

### 1.2 Admin actions

| Action | File | Auth | Zod input | Success data | Side effects | Rate limit |
|---|---|---|---|---|---|---|
| `adminListMembers` | `admin/members.ts` | `is_admin=true` | `{ filters, page, pageSize, sort }` (see §2.4) | `{ rows, total, page, pageSize }` | Read-only. Uses Drizzle under service role. Writes **no** audit (list reads are too noisy; individual get is audited). | 120 / min / admin. |
| `adminGetMember` | `admin/members.ts` | `is_admin=true` | `{ userId: string }` | `{ profile, consents, resumes, auditTail }` | Writes one `admin_member_view` audit row (deduplicated to once per admin+member+hour). | 120 / min / admin. |
| `adminSetManualVerification` | `admin/members.ts` | `is_admin=true` | `{ userId, verified: boolean, reason: string }` | `{ userId, verified, at }` | Updates `profiles.student_email_verified` and writes `manual_verifications` audit row with reason + admin id. | 30 / min / admin. |
| `adminAddSchoolDomain` | `admin/domains.ts` | `is_admin=true` | `{ domain, schoolName, schoolSlug }` | `{ domain }` | Inserts `school_domains` row. V0: flagged for "deferred, via migration only" per product doc §9.1 — action exists but is wired to return `FORBIDDEN` unless `FEATURE_DOMAIN_ADMIN=true`. | 10 / min / admin. |
| `adminToggleSchoolDomain` | `admin/domains.ts` | `is_admin=true` | `{ domain, isActive }` | `{ domain, isActive }` | Flips `school_domains.is_active`. Same feature-flag gate as above. | 10 / min / admin. |
| `adminExportRecruiterCSV` | `admin/export.ts` | `is_admin=true` | `{ filters, includeContactInfo?: false }` | **Streams** CSV with `Content-Type: text/csv` and `Content-Disposition`. Response wrapper is NOT the standard `{ok,data}` shape — see §5. | Writes one `exports` audit row with admin id, filters, row count. | 10 / hour / admin. |
| `adminGetSignedResumeUrl` | `admin/storage.ts` | `is_admin=true` | `{ resumeId }` | `{ signedUrl, expiresAt }` | Returns a 15-min signed URL. Writes `resume_signed_url_issued` audit row. | 60 / min / admin. |

Admin actions never use the user-context Supabase client. Everything goes through `createServiceRoleClient()` with explicit `is_admin` gating at the top of each action (see §8 `safeAction`).

---

## 2. Zod Schemas

All inputs pass through zod before hitting DB or Storage. Schemas live in `src/lib/validation/*.ts` and are reused between actions and client forms (React Hook Form resolvers).

### 2.1 Shared primitives

```ts
// src/lib/validation/primitives.ts
import { z } from "zod";

export const uuid = z.string().uuid();

// E.164: +[country][number], 8–15 digits total after the +.
// Accepts null/undefined at the field level; here we just validate shape.
export const e164Phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, { message: "Phone must be E.164 (+12025550123)" });

// Permissive-but-typed URL: must parse, must be http(s), max 2048.
export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "URL must start with http:// or https://",
  });

// Used on every action that writes. captured from next/headers at call time,
// not sent by the client.
export const requestContext = z.object({
  ip: z.string().ip().optional(),
  userAgent: z.string().max(1024).optional(),
});
```

### 2.2 Enums mirrored from DB

```ts
// src/lib/validation/enums.ts
import { z } from "zod";

export const ROLE_ENUM = [
  "swe_frontend",
  "swe_backend",
  "swe_fullstack",
  "swe_mobile",
  "swe_infra",
  "data_engineer",
  "data_scientist",
  "ml_engineer",
  "security",
  "pm",
  "design",
  "other",
] as const;
export const roleEnum = z.enum(ROLE_ENUM);

export const CLASS_STANDING_ENUM = [
  "freshman",
  "sophomore",
  "junior",
  "senior",
  "grad",
  "alumni",
  "other",
] as const;
export const classStandingEnum = z.enum(CLASS_STANDING_ENUM);

export const CONSENT_TYPE_ENUM = [
  "privacy_policy",
  "terms_of_service",
  "recruiter_resume_sharing",
  "email_marketing",
  "sms_marketing",
] as const;
export const consentTypeEnum = z.enum(CONSENT_TYPE_ENUM);
```

### 2.3 Profile input

`updateProfile` accepts partial updates. Every field is optional at the schema level; the server computes `profile_completed` server-side by re-checking all required fields post-merge.

```ts
// src/lib/validation/profile.ts
import { z } from "zod";
import { classStandingEnum, roleEnum } from "./enums";
import { e164Phone, httpsUrl } from "./primitives";

const currentYear = new Date().getUTCFullYear();

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    school: z.string().trim().min(1).max(120),
    gradYear: z.number().int().min(currentYear - 1).max(currentYear + 6),
    major: z.string().trim().min(1).max(120),
    classStanding: classStandingEnum,
    // min 0 allows a user to clear their roles; enforce at most 6.
    interestedRoles: z
      .array(roleEnum)
      .min(0)
      .max(6)
      .refine((a) => new Set(a).size === a.length, {
        message: "Duplicate roles",
      }),
    linkedinUrl: httpsUrl.optional().nullable(),
    githubUrl: httpsUrl.optional().nullable(),
    portfolioUrl: httpsUrl.optional().nullable(),
    phoneNumber: e164Phone.optional().nullable(),
  })
  .partial() // makes every top-level field optional for patch semantics
  .strict(); // reject unknown keys

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const REQUIRED_PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "school",
  "gradYear",
  "major",
  "classStanding",
] as const satisfies ReadonlyArray<keyof UpdateProfileInput>;
```

### 2.4 Admin list input

```ts
// src/lib/validation/admin.ts
import { z } from "zod";
import { classStandingEnum, roleEnum } from "./enums";

export const adminListMembersSchema = z.object({
  filters: z
    .object({
      search: z.string().trim().max(120).optional(), // ILIKE on name + email
      gradYears: z.array(z.number().int()).max(10).optional(),
      schools: z.array(z.string().max(120)).max(20).optional(),
      interestedRoles: z.array(roleEnum).max(6).optional(),
      classStanding: z.array(classStandingEnum).max(7).optional(),
      verified: z.enum(["all", "verified", "unverified"]).default("all"),
      openToRecruiters: z.enum(["all", "yes", "no"]).default("all"),
      hasResume: z.enum(["all", "yes", "no"]).default("all"),
    })
    .default({}),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  sort: z
    .enum([
      "created_at_desc",
      "created_at_asc",
      "name_asc",
      "name_desc",
      "grad_year_asc",
    ])
    .default("created_at_desc"),
});

export type AdminListMembersInput = z.infer<typeof adminListMembersSchema>;
```

### 2.5 Other action schemas

```ts
// src/lib/validation/auth.ts
export const requestStudentEmailCodeSchema = z.object({
  studentEmail: z.string().trim().toLowerCase().email().max(254),
});
export const verifyStudentEmailCodeSchema = z.object({
  studentEmail: z.string().trim().toLowerCase().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

// src/lib/validation/resume.ts
export const finalizeResumeUploadSchema = z.object({
  resumeId: z.string().uuid(),
});
export const deleteResumeSchema = z.object({
  resumeId: z.string().uuid(),
});

// src/lib/validation/consent.ts
import { consentTypeEnum } from "./enums";
export const recordConsentSchema = z.object({
  consentType: consentTypeEnum,
  accepted: z.boolean(),
  version: z
    .string()
    .regex(/^v\d+$/, { message: "Version must look like v1, v2, ..." }),
});

export const requestAccountDeletionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// src/lib/validation/profile.ts (cont.)
export const setOpenToRecruitersSchema = z.object({
  openToRecruiters: z.boolean(),
});

// src/lib/validation/admin.ts (cont.)
export const adminGetMemberSchema = z.object({ userId: z.string().uuid() });

export const adminSetManualVerificationSchema = z.object({
  userId: z.string().uuid(),
  verified: z.boolean(),
  reason: z.string().trim().min(5).max(500),
});

export const adminAddSchoolDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
    .max(253),
  schoolName: z.string().trim().min(1).max(120),
  schoolSlug: z.string().trim().regex(/^[a-z0-9-]+$/).min(2).max(40),
});

export const adminToggleSchoolDomainSchema = z.object({
  domain: z.string().trim().toLowerCase().max(253),
  isActive: z.boolean(),
});

export const adminExportRecruiterCSVSchema = z.object({
  filters: adminListMembersSchema.shape.filters, // reuse
  includeContactInfo: z.literal(false).default(false), // V0: forbidden
});

export const adminGetSignedResumeUrlSchema = z.object({
  resumeId: z.string().uuid(),
});
```

---

## 3. Return Shapes & Error Codes

Every action returns a discriminated union:

```ts
// src/lib/actions/result.ts
export type ActionError = {
  code: ErrorCode;
  message: string;
  field?: string; // populated for INVALID_INPUT
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DOMAIN_NOT_ALLOWED"
  | "OTP_EXPIRED"
  | "OTP_INVALID"
  | "OTP_LOCKED"
  | "RESUME_TOO_LARGE"
  | "RESUME_BAD_MIME"
  | "STORAGE_OBJECT_MISSING"
  | "INTERNAL";
```

CSV export is the one exception — it returns a streamed `Response` (see §5).

### 3.1 Error-code catalog

| Code | HTTP-ish semantic | When | Field? | Client UX |
|---|---|---|---|---|
| `UNAUTHORIZED` | 401 | No valid Supabase session. | — | Redirect to `/login`. |
| `FORBIDDEN` | 403 | Session valid but user lacks permission (e.g., non-admin hitting admin action, member trying to delete someone else's resume). | — | Show "You don't have access." Never surface the admin path. |
| `RATE_LIMITED` | 429 | Per-action bucket exceeded. | — | Show cooldown with `retryAfter` from error message; disable button. |
| `INVALID_INPUT` | 400 | zod parse failed, or a cross-field rule (e.g., SMS consent without phone). | Yes, dot-path of the offending field. | Highlight field; render zod message. |
| `NOT_FOUND` | 404 | Requested resource (resume, member, consent) missing. | — | Show inline "not found"; admin redirect to list. |
| `CONFLICT` | 409 | Idempotency clash (finalizing the same resume twice after deletion; toggling a domain that's already in that state). | — | Usually quiet recovery — refresh state. |
| `DOMAIN_NOT_ALLOWED` | 422 | School email domain not in `school_domains` allowlist. | `studentEmail` | Show allowlist hint; link to "request a school" form (V0: mailto). |
| `OTP_EXPIRED` | 422 | Entered code was correct but past expiry. | `code` | Offer "Send a new code." |
| `OTP_INVALID` | 422 | Code does not match. | `code` | Generic "Invalid code." (do not differentiate from `NOT_FOUND` to prevent enumeration). |
| `OTP_LOCKED` | 429 | Too many failed attempts; lockout active. | — | Show lock timer; offer admin-assist link. |
| `RESUME_TOO_LARGE` | 422 | Finalize found a Storage object > 10 MB. | — | "Max 10 MB" + re-upload. |
| `RESUME_BAD_MIME` | 422 | Finalize found a Storage object whose content-type is not `application/pdf`. | — | "PDF only" + re-upload. |
| `STORAGE_OBJECT_MISSING` | 404 | Finalize couldn't HEAD the Storage object (upload never happened or was discarded). | — | Retry upload. |
| `INTERNAL` | 500 | Uncaught. Logged with stack; message is generic. | — | Toast "Something went wrong"; include a request id for support. |

---

## 4. Resume Upload Flow

The resume upload is the most moving-parts-per-dollar feature in V0. Two server actions bracket a direct-to-Storage PUT so that we never proxy binary through a serverless function.

### 4.1 Sequence

```
Client                             Server (action)                   Supabase Storage
  |                                     |                                    |
  | 1. user picks file in <input>       |                                    |
  |    (client-side checks: size ≤ 10MB,|                                    |
  |     mime === "application/pdf")     |                                    |
  |                                     |                                    |
  | 2. createResumeUploadUrl()          |                                    |
  |------------------------------------>|                                    |
  |                                     | 3. safeAction: auth + rate limit   |
  |                                     |    check. require                  |
  |                                     |    student_email_verified=true     |
  |                                     |                                    |
  |                                     | 4. resume_id = uuid()              |
  |                                     |    path = `${user.id}/${resume_id}`|
  |                                     |            + ".pdf"                |
  |                                     |                                    |
  |                                     | 5. insert into resumes             |
  |                                     |    (id, user_id, storage_path,     |
  |                                     |     is_current=false, status="pending") |
  |                                     |                                    |
  |                                     | 6. storage.createSignedUploadUrl() |
  |                                     |----------------------------------->|
  |                                     |<-----------------------------------| signedUrl (15 min TTL)
  |<------------------------------------|                                    |
  |  { resume_id, path, signed_url }    |                                    |
  |                                     |                                    |
  | 7. PUT binary to signed_url         |                                    |
  |    headers: content-type: application/pdf,                               |
  |             x-upsert: false         |                                    |
  |-------------------------------------------------------------------------->|
  |<---------------------------------------------------------------------------| 200 OK
  |                                     |                                    |
  | 8. finalizeResumeUpload({resume_id})|                                    |
  |------------------------------------>|                                    |
  |                                     | 9. safeAction: auth + rate limit.  |
  |                                     |    load resumes row; assert owner  |
  |                                     |    and status="pending"            |
  |                                     |                                    |
  |                                     | 10. storage.head(path) or list()   |
  |                                     |    -> { size, mimetype }           |
  |                                     |----------------------------------->|
  |                                     |<-----------------------------------|
  |                                     |                                    |
  |                                     | 11. validate:                      |
  |                                     |     size <= 10 MiB                 |
  |                                     |     mime == application/pdf        |
  |                                     |     (failing? -> discard, error)   |
  |                                     |                                    |
  |                                     | 12. rpc("set_current_resume",      |
  |                                     |         { p_resume_id: resume_id })|
  |                                     |     SECURITY DEFINER:              |
  |                                     |       - UPDATE resumes             |
  |                                     |           SET is_current=false     |
  |                                     |           WHERE user_id=$ AND      |
  |                                     |           is_current=true;         |
  |                                     |       - UPDATE resumes             |
  |                                     |           SET is_current=true,     |
  |                                     |               status="active",    |
  |                                     |               size_bytes=$,        |
  |                                     |               mime="application/pdf"|
  |                                     |           WHERE id=$;              |
  |                                     |                                    |
  |                                     | 13. audit: "resume.finalized"      |
  |                                     |                                    |
  |                                     | 14. fire-and-forget:               |
  |                                     |      Resend "resume updated" email |
  |<------------------------------------|                                    |
  |   { resume_id, is_current: true,    |                                    |
  |     size_bytes }                    |                                    |
```

### 4.2 Failure modes

| Failure | Where | Handling |
|---|---|---|
| Client-side size/mime check fails | Browser | Block submission; never call `createResumeUploadUrl`. |
| `createResumeUploadUrl` fails (rate-limited, auth) | Server | Standard error shape; no DB row created (insert is after auth check so a `UNAUTHORIZED` never leaves orphans). |
| DB insert succeeds but `createSignedUploadUrl` fails | Server | Catch, delete the just-inserted row inside the same action (transactional intent). If delete fails too, leave the row with `status="pending"` and let the orphan cleanup cron handle it. |
| User closes tab before PUT | Client | Row remains `status="pending"`, no Storage object. Orphan cron sweeps after 24h. |
| PUT fails (network, Storage rejection) | Client/Storage | Client retries PUT up to 2× with backoff. If still failing, user must call `createResumeUploadUrl` again (new row, old row reaped by cron). |
| Finalize called twice | Server | Second call: row already `status="active"` → return `CONFLICT`, or short-circuit success if state matches and within 60s (idempotent). |
| Finalize finds no object | Server | `STORAGE_OBJECT_MISSING`; mark row `status="abandoned"`. |
| Finalize finds oversize/bad mime | Server | Mark row `status="rejected"`; call Storage `remove(path)` synchronously to drop the bad object; return `RESUME_TOO_LARGE` or `RESUME_BAD_MIME`. |
| SECURITY DEFINER fn fails mid-flip | DB | Function is transactional (BEGIN/COMMIT in the fn body). Atomic — either both `is_current` writes commit or neither does. |

### 4.3 Orphan cleanup cron (V0: Supabase scheduled function)

```sql
-- runs nightly at 03:00 UTC
DELETE FROM resumes
WHERE status = 'pending'
  AND created_at < now() - interval '24 hours';

-- Storage objects: the DB delete returns the paths; a companion Edge function
-- iterates the return and calls storage.remove() on each.
```

### 4.4 Representative code

```ts
// src/actions/resume.ts
"use server";
import { safeAction } from "@/lib/safeAction";
import { finalizeResumeUploadSchema } from "@/lib/validation/resume";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export const createResumeUploadUrl = safeAction(
  /* schema */ null,
  /* handler */ async (_, ctx) => {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return err("UNAUTHORIZED");

    // require verified student email
    const { data: profile } = await supabase
      .from("profiles")
      .select("student_email_verified")
      .eq("id", user.id)
      .single();
    if (!profile?.student_email_verified) return err("FORBIDDEN");

    const resumeId = crypto.randomUUID();
    const path = `${user.id}/${resumeId}.pdf`;

    const { error: insertErr } = await supabase
      .from("resumes")
      .insert({ id: resumeId, user_id: user.id, storage_path: path, is_current: false, status: "pending" });
    if (insertErr) return err("INTERNAL");

    const { data, error } = await supabase.storage
      .from("resumes")
      .createSignedUploadUrl(path);
    if (error) {
      await supabase.from("resumes").delete().eq("id", resumeId);
      return err("INTERNAL");
    }
    return ok({ resumeId, path, signedUrl: data.signedUrl, expiresIn: 900 });
  },
  { action: "createResumeUploadUrl", rateLimit: { bucket: "resume_upload", max: 10, windowMs: 3_600_000 } },
);

export const finalizeResumeUpload = safeAction(
  finalizeResumeUploadSchema,
  async (input, ctx) => {
    const supabase = createServerClient();
    const svc = createServiceRoleClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return err("UNAUTHORIZED");

    const { data: row } = await supabase
      .from("resumes")
      .select("id, user_id, storage_path, status")
      .eq("id", input.resumeId)
      .single();
    if (!row) return err("NOT_FOUND");
    if (row.user_id !== user.id) return err("FORBIDDEN");
    if (row.status === "active") return ok({ resumeId: row.id, isCurrent: true, sizeBytes: -1 }); // idempotent

    // HEAD the object
    const { data: obj, error: headErr } = await svc.storage
      .from("resumes")
      .list(user.id, { search: `${row.id}.pdf`, limit: 1 });
    if (headErr || !obj?.length) return err("STORAGE_OBJECT_MISSING");

    const meta = obj[0];
    if ((meta.metadata?.size ?? 0) > MAX_RESUME_BYTES) {
      await svc.storage.from("resumes").remove([row.storage_path]);
      await svc.from("resumes").update({ status: "rejected" }).eq("id", row.id);
      return err("RESUME_TOO_LARGE");
    }
    if (meta.metadata?.mimetype !== "application/pdf") {
      await svc.storage.from("resumes").remove([row.storage_path]);
      await svc.from("resumes").update({ status: "rejected" }).eq("id", row.id);
      return err("RESUME_BAD_MIME");
    }

    const { error: rpcErr } = await svc.rpc("set_current_resume", {
      p_resume_id: row.id,
      p_size_bytes: meta.metadata.size,
    });
    if (rpcErr) return err("INTERNAL");

    await writeAudit({ actor: user.id, action: "resume.finalized", target: row.id });
    // fire-and-forget email; do not await
    void sendResumeUpdatedEmail(user.id);
    return ok({ resumeId: row.id, isCurrent: true, sizeBytes: meta.metadata.size });
  },
  { action: "finalizeResumeUpload", rateLimit: { bucket: "resume_upload", max: 10, windowMs: 3_600_000 } },
);
```

---

## 5. CSV Export Logic

### 5.1 Gating (MUST match Data doc)

A member appears in a recruiter export when ALL of:

1. `profiles.student_email_verified = true`
2. `profiles.profile_completed = true`
3. `profiles.open_to_recruiters = true`
4. `profiles.deleted_at IS NULL` (soft-deleted members excluded)
5. The member's **most recent** `consents` row with `consent_type = 'recruiter_resume_sharing'` has `accepted = true` (revocation appears as a later row with `accepted=false`).
6. There is a `resumes` row with `is_current = true` AND `status = 'active'` for that user.
7. The filter constraints supplied by the admin pass.

### 5.2 SQL

```sql
-- Recruiter-export gating, as a CTE that every export query joins on.
WITH latest_recruiter_consent AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    accepted,
    version,
    recorded_at
  FROM consents
  WHERE consent_type = 'recruiter_resume_sharing'
  ORDER BY user_id, recorded_at DESC
),
current_resume AS (
  SELECT user_id, id AS resume_id, storage_path, size_bytes
  FROM resumes
  WHERE is_current = true AND status = 'active' AND deleted_at IS NULL
)
SELECT
  p.id,
  p.first_name,
  p.last_name,
  p.student_email,
  p.school,
  p.grad_year,
  p.major,
  p.class_standing,
  p.interested_roles,
  p.linkedin_url,
  p.github_url,
  p.portfolio_url,
  cr.resume_id,
  cr.storage_path
FROM profiles p
JOIN latest_recruiter_consent lrc ON lrc.user_id = p.id AND lrc.accepted = true
JOIN current_resume cr ON cr.user_id = p.id
WHERE p.student_email_verified = true
  AND p.profile_completed = true
  AND p.open_to_recruiters = true
  AND p.deleted_at IS NULL
  -- filter-driven predicates below, composed by Drizzle
  AND ($grad_years IS NULL OR p.grad_year = ANY($grad_years))
  AND ($schools IS NULL OR p.school = ANY($schools))
  AND ($roles IS NULL OR p.interested_roles && $roles::role_enum[])
ORDER BY p.last_name ASC, p.first_name ASC;
```

### 5.3 Columns in the CSV

| Column | Source | Notes |
|---|---|---|
| `first_name` | `profiles.first_name` | |
| `last_name` | `profiles.last_name` | |
| `student_email` | `profiles.student_email` | Only school email, never Google email. |
| `school` | `profiles.school` | |
| `grad_year` | `profiles.grad_year` | |
| `major` | `profiles.major` | |
| `class_standing` | `profiles.class_standing` | |
| `interested_roles` | `profiles.interested_roles` | Comma-joined, alphabetized. |
| `linkedin_url` | `profiles.linkedin_url` | Blank if null. |
| `github_url` | `profiles.github_url` | Blank if null. |
| `portfolio_url` | `profiles.portfolio_url` | Blank if null. |
| `resume_signed_url` | `storage.createSignedUrl(..., 900)` | 15-min TTL. Generated per-row during export. |

Explicitly **NOT** in V0 CSV: `google_email`, `phone_number`, `street_address`, consent history, audit tail. See product doc §10 Q2.

### 5.4 Streaming + escaping

Response is streamed; we never buffer the whole CSV in memory.

```ts
// src/actions/admin/export.ts
"use server";
import { adminExportRecruiterCSVSchema } from "@/lib/validation/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { rfc4180 } from "@/lib/csv";

export async function adminExportRecruiterCSV(rawInput: unknown): Promise<Response> {
  const admin = await requireAdmin(); // throws -> 401/403
  const input = adminExportRecruiterCSVSchema.parse(rawInput);
  const svc = createServiceRoleClient();

  const filename = `progsu-recruiter-${formatYYYYMMDD(new Date())}-${summarizeFilters(input.filters)}.csv`;

  const rowCountPromise = runCount(svc, input.filters);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // header row
      controller.enqueue(encoder.encode(CSV_HEADER + "\r\n"));

      let rowCount = 0;
      for await (const row of streamRows(svc, input.filters)) {
        const signedUrl = await signResume(svc, row.storage_path); // 900s
        const line = [
          rfc4180(row.first_name),
          rfc4180(row.last_name),
          rfc4180(row.student_email),
          rfc4180(row.school),
          String(row.grad_year),
          rfc4180(row.major),
          rfc4180(row.class_standing),
          rfc4180([...row.interested_roles].sort().join(",")),
          rfc4180(row.linkedin_url ?? ""),
          rfc4180(row.github_url ?? ""),
          rfc4180(row.portfolio_url ?? ""),
          rfc4180(signedUrl),
        ].join(",");
        controller.enqueue(encoder.encode(line + "\r\n"));
        rowCount++;
      }
      controller.close();

      // audit after stream completes
      await writeAudit({
        actor: admin.id,
        action: "export.recruiter_csv",
        metadata: {
          filters: input.filters,
          filter_summary: summarizeFilters(input.filters),
          row_count: rowCount,
          exported_at: new Date().toISOString(),
        },
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// src/lib/csv.ts — RFC 4180 escaping
export function rfc4180(value: string): string {
  const needsQuote = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}
```

The `summarizeFilters` helper produces a short, filename-safe slug:

```ts
// e.g., "all" | "cs-2027" | "swe_frontend-swe_backend"
function summarizeFilters(f: Filters): string {
  const parts: string[] = [];
  if (f.schools?.length) parts.push(f.schools.join("_"));
  if (f.gradYears?.length) parts.push(f.gradYears.join("-"));
  if (f.interestedRoles?.length) parts.push(f.interestedRoles.join("-"));
  return (parts.join("_") || "all").replace(/[^a-z0-9\-_]/gi, "").slice(0, 80);
}
```

### 5.5 Audit row shape

```json
{
  "actor_user_id": "6a1c...",
  "action": "export.recruiter_csv",
  "target_type": null,
  "target_id": null,
  "metadata": {
    "filters": { "gradYears": [2027, 2028], "interestedRoles": ["swe_frontend"] },
    "filter_summary": "2027-2028_swe_frontend",
    "row_count": 42,
    "exported_at": "2026-04-21T18:33:11.204Z"
  },
  "ip": "…",
  "user_agent": "…",
  "created_at": "2026-04-21T18:33:12.891Z"
}
```

### 5.6 Why stream, not pre-generated file

For V0 we pick **streaming**:

- Membership is O(1000s). Stream latency and memory are fine.
- No stale-file problem; the CSV is generated at request time with fresh signed URLs.
- No need for a separate "exports" Storage bucket or cleanup lifecycle.

Pre-generated (upload to Storage then return signed URL) is noted as future work if CSV sizes grow to tens of thousands of rows. See §11.

---

## 6. Admin Listing Queries

### 6.1 Why offset, not cursor (for V0)

- Member counts stay well under 10k through V1; offset pagination is fine perf-wise up to ~50k rows when combined with the right indexes.
- Admin UX needs a page-number display and "jump to page N." Cursor pagination doesn't give us total or jump without extra work.
- We hard-cap `page ≤ 1000` in zod to prevent deep-page abuse. Hitting page 1000 at pageSize=100 means the admin wanted 100k rows — they should be using export instead.

Revisit cursor pagination once table rows > 50k, or when admins complain about jitter when new members join mid-session.

### 6.2 Drizzle query

```ts
// src/actions/admin/members.ts
import { and, asc, desc, eq, sql, inArray, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, resumes } from "@/lib/db/schema";
import { adminListMembersSchema } from "@/lib/validation/admin";

export const adminListMembers = safeAction(
  adminListMembersSchema,
  async (input, ctx) => {
    await requireAdmin(ctx);

    const where = [eq(profiles.deletedAt, sql`NULL`)]; // soft-delete hide

    const { filters, page, pageSize, sort } = input;

    if (filters.verified === "verified") where.push(eq(profiles.studentEmailVerified, true));
    if (filters.verified === "unverified") where.push(eq(profiles.studentEmailVerified, false));

    if (filters.openToRecruiters === "yes") where.push(eq(profiles.openToRecruiters, true));
    if (filters.openToRecruiters === "no") where.push(eq(profiles.openToRecruiters, false));

    if (filters.gradYears?.length) where.push(inArray(profiles.gradYear, filters.gradYears));
    if (filters.schools?.length) where.push(inArray(profiles.school, filters.schools));
    if (filters.classStanding?.length) where.push(inArray(profiles.classStanding, filters.classStanding));

    if (filters.interestedRoles?.length) {
      // array overlap operator
      where.push(sql`${profiles.interestedRoles} && ${filters.interestedRoles}::role_enum[]`);
    }

    if (filters.hasResume === "yes") {
      where.push(sql`EXISTS (SELECT 1 FROM ${resumes} r WHERE r.user_id = ${profiles.id} AND r.is_current = true AND r.status = 'active')`);
    }
    if (filters.hasResume === "no") {
      where.push(sql`NOT EXISTS (SELECT 1 FROM ${resumes} r WHERE r.user_id = ${profiles.id} AND r.is_current = true AND r.status = 'active')`);
    }

    if (filters.search) {
      const s = `%${filters.search}%`;
      where.push(
        sql`(
          (${profiles.firstName} || ' ' || ${profiles.lastName}) ILIKE ${s}
          OR ${profiles.studentEmail} ILIKE ${s}
        )`,
      );
    }

    const orderBy = (() => {
      switch (sort) {
        case "name_asc":   return [asc(profiles.lastName), asc(profiles.firstName)];
        case "name_desc":  return [desc(profiles.lastName), desc(profiles.firstName)];
        case "created_at_asc":  return [asc(profiles.createdAt)];
        case "grad_year_asc":   return [asc(profiles.gradYear)];
        case "created_at_desc":
        default:           return [desc(profiles.createdAt)];
      }
    })();

    const [rows, [{ count }]] = await Promise.all([
      db.select({
          id: profiles.id,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          school: profiles.school,
          gradYear: profiles.gradYear,
          major: profiles.major,
          classStanding: profiles.classStanding,
          verified: profiles.studentEmailVerified,
          openToRecruiters: profiles.openToRecruiters,
          updatedAt: profiles.updatedAt,
          hasResume: sql<boolean>`EXISTS (SELECT 1 FROM ${resumes} r WHERE r.user_id = ${profiles.id} AND r.is_current = true AND r.status = 'active')`,
        })
        .from(profiles)
        .where(and(...where))
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ count: sql<number>`count(*)::int` }).from(profiles).where(and(...where)),
    ]);

    return ok({ rows, total: count, page, pageSize });
  },
  { action: "adminListMembers", rateLimit: { bucket: "admin_list", max: 120, windowMs: 60_000 } },
);
```

### 6.3 Indexes that make this fast

See Data doc for full index list. Ones that matter here:

- `profiles(grad_year)`
- `profiles(school)`
- `profiles(student_email_verified, open_to_recruiters)` composite — covers export gating and filter combo.
- GIN `profiles(interested_roles)` — for `&&` overlap.
- GIN trigram `profiles USING gin ((first_name || ' ' || last_name) gin_trgm_ops)` and on `student_email` for the ILIKE search.
  - Requires `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in a migration.

### 6.4 Return shape

```ts
type AdminListMembersData = {
  rows: Array<{
    id: string;
    firstName: string;
    lastName: string;
    school: string;
    gradYear: number;
    major: string;
    classStanding: string;
    verified: boolean;
    openToRecruiters: boolean;
    updatedAt: string;
    hasResume: boolean;
  }>;
  total: number;
  page: number;
  pageSize: number;
};
```

---

## 7. Rate Limits

### 7.1 Recommendation: DB-based for V0

V0 rate limits live in Postgres via a `rate_limit_events` table (as proposed in the Auth doc) so we ship without adding an infra dependency. We instrument `safeAction`'s `rateLimit` option to call a single `rpc("consume_rate_limit", { bucket, key, max, window_ms })` that does INSERT+COUNT atomically and returns `{ allowed, retry_after_ms }`.

Upstream path: when infra calcifies, move buckets to **Upstash Redis** (free tier; HTTP-reachable from Vercel Edge Functions; deterministic latency). Keep the `safeAction` seam identical so actions don't change.

### 7.2 Bucket table

| Action | Bucket | Limit | Key | Location |
|---|---|---|---|---|
| `requestStudentEmailCode` | `otp_send` | 3 / 15 min | `user.id` | DB (V0), Redis (V1) |
| `verifyStudentEmailCode` | `otp_verify` | 5 / 15 min | `user.id` | DB |
| `updateProfile` | `profile_write` | 30 / min | `user.id` | DB |
| `setOpenToRecruiters` | `profile_write` | (shared) | `user.id` | DB |
| `createResumeUploadUrl` | `resume_upload` | 10 / hour | `user.id` | DB |
| `finalizeResumeUpload` | `resume_upload` | 10 / hour | `user.id` | DB (shared bucket with create) |
| `deleteResume` | `resume_upload` | (shared) | `user.id` | DB |
| `recordConsent` | `consent_write` | 60 / hour | `user.id` | DB |
| `requestAccountDeletion` | `account_deletion` | 3 / day | `user.id` | DB |
| `signOut` | — | none | — | — |
| `adminListMembers` | `admin_list` | 120 / min | `admin.id` | DB |
| `adminGetMember` | `admin_list` | (shared) | `admin.id` | DB |
| `adminSetManualVerification` | `admin_write` | 30 / min | `admin.id` | DB |
| `adminExportRecruiterCSV` | `admin_export` | 10 / hour | `admin.id` | DB |
| `adminGetSignedResumeUrl` | `admin_storage` | 60 / min | `admin.id` | DB |
| Resume PUT to Storage | — | Supabase's own | Storage-enforced | Storage |
| OAuth callback | — | none | — | — |
| Resend webhook | `webhook_resend` | 60 / min | source IP | DB |

Unauthenticated callers (e.g., if an action is mistakenly reachable without a session) get a zero-budget bucket — the `safeAction` helper refuses before rate-limit even runs.

### 7.3 Representative `consume_rate_limit` RPC

```sql
CREATE OR REPLACE FUNCTION consume_rate_limit(
  p_bucket text, p_key text, p_max int, p_window_ms int
) RETURNS TABLE(allowed boolean, retry_after_ms int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
DECLARE v_window_start timestamptz := now() - (p_window_ms || ' ms')::interval;
BEGIN
  DELETE FROM rate_limit_events
  WHERE bucket = p_bucket AND key = p_key AND occurred_at < v_window_start;

  SELECT count(*) INTO v_count
  FROM rate_limit_events
  WHERE bucket = p_bucket AND key = p_key;

  IF v_count >= p_max THEN
    RETURN QUERY SELECT false, p_window_ms;
  END IF;

  INSERT INTO rate_limit_events(bucket, key, occurred_at) VALUES (p_bucket, p_key, now());
  RETURN QUERY SELECT true, 0;
END;
$$;
```

---

## 8. Error Handling & Observability

### 8.1 `safeAction` helper

Every server action is wrapped so that validation, auth, rate limit, logging, and the standard error shape are a one-line concern.

```ts
// src/lib/safeAction.ts
import { z, ZodSchema } from "zod";
import { headers, cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/log";
import { ActionResult, ErrorCode } from "./actions/result";

type SafeActionOpts = {
  action: string;
  requireAuth?: boolean; // default true
  requireAdmin?: boolean;
  rateLimit?: { bucket: string; max: number; windowMs: number };
};

type ActionCtx = {
  user?: { id: string; email: string };
  ip?: string;
  userAgent?: string;
  requestId: string;
};

export function safeAction<I, O>(
  schema: ZodSchema<I> | null,
  handler: (input: I, ctx: ActionCtx) => Promise<ActionResult<O>>,
  opts: SafeActionOpts,
): (raw: unknown) => Promise<ActionResult<O>> {
  return async (raw) => {
    const start = Date.now();
    const h = headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = h.get("user-agent") ?? undefined;
    const requestId = crypto.randomUUID();

    try {
      // 1. parse
      let input: I = undefined as unknown as I;
      if (schema) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return {
            ok: false,
            error: { code: "INVALID_INPUT", message: issue.message, field: issue.path.join(".") },
          };
        }
        input = parsed.data;
      }

      // 2. auth
      let user: { id: string; email: string } | undefined;
      if (opts.requireAuth ?? true) {
        const sb = createServerClient();
        const { data: { user: u } } = await sb.auth.getUser();
        if (!u) return errOut("UNAUTHORIZED", "Not signed in");
        user = { id: u.id, email: u.email ?? "" };

        if (opts.requireAdmin) {
          const { data: p } = await sb.from("profiles").select("is_admin").eq("id", u.id).single();
          if (!p?.is_admin) return errOut("FORBIDDEN", "Admin only");
        }
      }

      // 3. rate limit
      if (opts.rateLimit && user) {
        const rl = await consumeRateLimit(opts.rateLimit.bucket, user.id, opts.rateLimit.max, opts.rateLimit.windowMs);
        if (!rl.allowed) return errOut("RATE_LIMITED", `Try again in ${rl.retryAfterMs} ms`);
      }

      const ctx: ActionCtx = { user, ip, userAgent, requestId };
      const result = await handler(input, ctx);

      logEvent({
        action: opts.action,
        user_id: user?.id,
        request_id: requestId,
        duration_ms: Date.now() - start,
        ok: result.ok,
        error_code: result.ok ? undefined : result.error.code,
      });
      return result;
    } catch (unknownErr) {
      logEvent({
        action: opts.action,
        request_id: requestId,
        duration_ms: Date.now() - start,
        ok: false,
        error_code: "INTERNAL",
        // IMPORTANT: never leak stack to client
        error_stack: unknownErr instanceof Error ? unknownErr.stack : String(unknownErr),
      });
      return errOut("INTERNAL", "Something went wrong", requestId);
    }
  };
}

function errOut(code: ErrorCode, message: string, requestId?: string): ActionResult<never> {
  return { ok: false, error: { code, message: requestId ? `${message} [${requestId}]` : message } };
}
```

### 8.2 Logging

V0 uses structured console logging so Vercel's log tail is greppable:

```ts
export function logEvent(fields: Record<string, unknown>) {
  // Always JSON, always one line.
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}
```

Every line includes: `action`, `user_id` (when known), `request_id`, `duration_ms`, `ok`, `error_code`. That's enough to answer:

- "How many `RATE_LIMITED` on `otp_send` today?"
- "p95 latency of `adminListMembers`?"
- "Every failed `finalizeResumeUpload` in the last hour?"

### 8.3 Sentry (could-ship)

Drop-in points when we're ready:

1. `npm install @sentry/nextjs` + `sentry.server.config.ts` + `sentry.edge.config.ts`.
2. In `safeAction`'s catch, replace `logEvent({...error_stack})` with `Sentry.captureException(unknownErr, { extra: fields })`.
3. `logEvent` stays — it's the structured stream; Sentry is for exceptions only.

Not V0; flagged so the seam is clean.

---

## 9. Webhooks

### 9.1 Resend `email.bounced`

Only inbound webhook in V0. Endpoint: `POST /api/webhooks/resend` (route handler, NOT a server action).

Why a route handler: webhooks arrive without the user's cookie, Resend expects a conventional HTTP body, and we need to verify a signature header. Server actions don't fit.

```ts
// src/app/api/webhooks/resend/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

const SECRET = process.env.RESEND_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("resend-signature") ?? "";
  if (!verifySignature(raw, sig, SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = JSON.parse(raw);

  if (body.type !== "email.bounced") return NextResponse.json({ ok: true });

  const toAddress = body.data?.to?.[0];
  const bounceType: "hard" | "soft" = body.data?.bounce_type ?? "soft";
  const svc = createServiceRoleClient();

  await svc.from("audit_log").insert({
    actor_user_id: null,
    action: "email.bounced",
    target_type: "email",
    target_id: toAddress,
    metadata: { bounce_type: bounceType, raw: body },
  });

  if (bounceType === "hard" && toAddress) {
    // un-verify the matching student email so export gating drops them
    await svc
      .from("profiles")
      .update({ student_email_verified: false, unverified_reason: "hard_bounce" })
      .eq("student_email", toAddress.toLowerCase());
  }

  return NextResponse.json({ ok: true });
}

function verifySignature(body: string, sigHeader: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  // timing-safe
  const a = Buffer.from(expected);
  const b = Buffer.from(sigHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Rate limited at the bucket level (60/min per source IP). If a single Resend IP blows through, we 429 and let them retry — Resend retries bounces.

### 9.2 Supabase OAuth callback

`GET /auth/callback` is the other route handler (Supabase-owned convention). It exchanges the `code` param for a session, creates the `profiles` row on first login, and redirects into the onboarding path. Details owned by the Auth doc; listed here so the "route handlers exist" story is complete.

### 9.3 Not included in V0

- Stripe / payment webhooks — out of scope.
- SMS delivery receipts — SMS not sent in V0.
- Clerk/Auth0 webhooks — not our auth provider.

---

## 10. Environment Variables

### 10.1 Client-exposable (must start with `NEXT_PUBLIC_`)

| Name | Example | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase project URL — used by both server and browser clients. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...` | Public anon key; safe to ship to browser. |
| `NEXT_PUBLIC_APP_URL` | `https://platform.progsu.org` | Self-URL for OAuth callback and email links. |
| `NEXT_PUBLIC_FEATURE_DOMAIN_ADMIN` | `false` | Feature flag for `/admin/domains`. Default false in V0. |

### 10.2 Server-only (NEVER prefixed `NEXT_PUBLIC_`)

| Name | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for admin/export/audit/SECURITY DEFINER calls. Never read in client code. Grep CI rule to ensure no imports from `"use client"` files. |
| `DATABASE_URL` | Postgres connection string used by Drizzle. Pooled for serverless; non-pooled for migrations. |
| `DATABASE_URL_DIRECT` | Non-pooled URL used by migration scripts (drizzle-kit). |
| `RESEND_API_KEY` | Sending OTPs, welcome, resume-updated emails. |
| `RESEND_WEBHOOK_SECRET` | HMAC-SHA256 secret for inbound bounce webhook. |
| `UPSTASH_REDIS_REST_URL` | (Future) rate-limit store. Optional in V0; undefined → fall back to DB buckets. |
| `UPSTASH_REDIS_REST_TOKEN` | Paired with the URL above. |
| `OTP_PEPPER` | Secret pepper mixed into OTP hashing before DB write (per Auth doc). |
| `ADMIN_NOTIFY_EMAIL` | `admin@progsu.org` — where `requestAccountDeletion` emails land. |
| `SENTRY_DSN` | (Future) exception reporting. Unused in V0. |
| `LOG_LEVEL` | `info` / `debug`. Affects `logEvent` verbosity. |

### 10.3 `.env.example` checklist

The repo ships an `.env.example` matching the above, with every `NEXT_PUBLIC_` flagged inline so reviewers can immediately tell which values are safe-for-browser.

---

## 11. Open Questions / Risks

### 11.1 Drizzle vs Supabase client — drift risk

We use **both** clients and they can drift if schema changes in one doesn't hit the other.

**Plan:**

- `drizzle-kit pull` from the Supabase-managed DB regenerates Drizzle types after every migration.
- A CI step runs `drizzle-kit check` against the DB to fail builds when the TS schema doesn't match reality.
- Rule of thumb: if an action runs under service role and touches joins or complex WHEREs → Drizzle. If an action runs under the user's session and relies on RLS → Supabase JS. We don't reach into the other for the same call path.
- For types that travel across the boundary (e.g., `Profile` shape surfaced to the client), we derive them from Drizzle types via `InferSelectModel` and re-export from `src/lib/db/types.ts`. Supabase's generated types are a secondary source.

### 11.2 Export as streamed response vs pre-generated file

**V0 pick: streamed response** (see §5.6). Rationale: no Storage lifecycle; fresh signed URLs per row; small row counts.

When to revisit: sustained row counts > 5000, or admins want to re-download a historical export verbatim. At that point, we add `POST /admin/export/start` that writes the CSV to `exports/{admin_id}/{yyyymmdd}-{uuid}.csv` and returns a job id; admins poll `GET /admin/export/{job_id}` until the file signed URL lands. Until then, the streamed-response seam is the public contract.

### 11.3 CSRF on server actions

Next.js 15 server actions enforce **origin checks by default** — requests whose `Origin` or `Referer` don't match the allowed hosts are rejected at the framework level. This gives us CSRF protection without extra middleware, provided:

- `next.config.js` does NOT disable `experimental.serverActions.allowedOrigins` with a permissive list.
- Actions are never called from untrusted origins we've whitelisted.
- Cookies used by `@supabase/ssr` are `SameSite=Lax` (Supabase default).

**Call-out:** the default `SameSite=Lax` + action-origin check covers us. We do NOT add a hand-rolled CSRF token. If we ever add a browser extension origin, ship a design doc first.

### 11.4 Soft-delete vs hard-delete of resume Storage objects

V0 `deleteResume` is soft-delete at the DB level; the Storage object sticks around until the nightly cron processes rows where `deleted_at < now() - interval '30 days'`. That is documented in the Data doc retention table; surfaced here because it affects the `finalizeResumeUpload` failure path (a newly-rejected upload is `remove()`d immediately, not soft-deleted — different semantic).

### 11.5 `/api/profile` in product doc §5 vs server actions here

Product doc lists `/api/profile` as a route handler. This doc supersedes that: it becomes a server action (`actions/profile.ts#updateProfile`). Route handlers are reserved for webhooks and OAuth callback. Data doc and Frontend doc should align to this.

### 11.6 Idempotency keys

Not implemented in V0. Resume finalize is idempotent-by-state; consent record is append-only so double-writes are cosmetically duplicated but not dangerous. If we see duplicate consent rows in audit review, ship an idempotency-key header on `recordConsent` next.

---

## 12. Quick Reference — Every Action at a Glance

```ts
// User-facing
signOut(): ActionResult<{ redirectTo: string }>
requestStudentEmailCode(input): ActionResult<{ expiresInSeconds: number }>
verifyStudentEmailCode(input): ActionResult<{ studentEmailVerified: true }>
updateProfile(input): ActionResult<{ profile: Profile; profileCompleted: boolean }>
setOpenToRecruiters(input): ActionResult<{ openToRecruiters: boolean }>
createResumeUploadUrl(): ActionResult<{ resumeId: string; path: string; signedUrl: string; expiresIn: number }>
finalizeResumeUpload(input): ActionResult<{ resumeId: string; isCurrent: true; sizeBytes: number }>
deleteResume(input): ActionResult<{ resumeId: string; deletedAt: string }>
recordConsent(input): ActionResult<{ consentId: string; recordedAt: string }>
requestAccountDeletion(input): ActionResult<{ requestedAt: string }>

// Admin
adminListMembers(input): ActionResult<{ rows: Row[]; total: number; page: number; pageSize: number }>
adminGetMember(input): ActionResult<{ profile: Profile; consents: Consent[]; resumes: Resume[]; auditTail: AuditRow[] }>
adminSetManualVerification(input): ActionResult<{ userId: string; verified: boolean; at: string }>
adminAddSchoolDomain(input): ActionResult<{ domain: string }>
adminToggleSchoolDomain(input): ActionResult<{ domain: string; isActive: boolean }>
adminExportRecruiterCSV(input): Response // streamed text/csv
adminGetSignedResumeUrl(input): ActionResult<{ signedUrl: string; expiresAt: string }>
```

---

End of backend/API spec.
