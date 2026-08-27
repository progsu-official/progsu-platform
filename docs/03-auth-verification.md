# 03 — Auth & Verification Design

Owner: Auth & Verification Engineer
Status: Draft v1 (design-only, no production code)
Scope: Google OAuth (via Supabase Auth) + independent Student-Email OTP (via Resend)

---

## 1. Architecture overview

The platform uses **two independent identity artifacts**:

1. A **primary identity** — the Google account attached to the Supabase Auth user. This proves "a real human with a Google account is here" and gives us a stable `auth.users.id` (UUID).
2. A **student-email claim** — a separate, app-owned attestation that the same user also controls an email address on an allowlisted school domain. This is proven by a 6-digit OTP delivered via Resend, stored hashed in our own table, and written into the user's `profile` on success.

The two are deliberately decoupled so a graduated user with a revoked `.edu` address still has a working Google login, and so we can rotate the school-domain allowlist without breaking existing sessions. Supabase never sees the student email as an auth factor.

```
                  TRUST BOUNDARY (server side)
                          |
+---------+   HTTPS   +---+-----------------+   +-----------------+
| Browser | <-------> | Next.js (Vercel)    |-->| Supabase Auth   |
|         |  cookies  |  - middleware.ts    |   |  (Google OAuth) |
|         |  (HttpOnly|  - /auth/callback   |   +-----------------+
|  React  |   SameSite|  - Server Actions   |   +-----------------+
|  Client |   Lax)    |  - RSCs             |-->| Postgres (RLS)  |
+---------+           +---------+-----------+   |  profiles        |
                                |               |  email_verif_*   |
                                |               |  school_domains  |
                                v               |  audit_log       |
                          +-----+--------+      +-----------------+
                          | Resend API   |
                          | (OTP email)  |
                          +--------------+

     Everything left of the boundary is untrusted.
     SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY live ONLY on the server.
     Browser only ever holds the anon key + opaque auth cookies.
```

Key principles:

- All mutations (request/verify OTP, profile writes) run as **Server Actions** so the service-role key and Resend key stay out of client bundles.
- Supabase session lives in **HttpOnly cookies** managed by `@supabase/ssr`. Middleware refreshes tokens on every request.
- The student-email flow is built on our own tables (`email_verification_codes`, `school_domains`, `audit_log`) — Supabase magic-link is explicitly **not used**.

---

## 2. Google OAuth flow

### 2.1 Supabase configuration (one-time)

In the Supabase dashboard → Authentication → Providers → Google:

1. Create a Google Cloud OAuth 2.0 Client (Web app).
2. Authorized JavaScript origins:
   - `http://localhost:3000`
   - `https://<preview>.vercel.app` (optional, only if using wildcard previews)
   - `https://members.progsu.com` (prod)
3. Authorized redirect URIs — point at **Supabase's** callback, not our app:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
4. Paste the Client ID / Secret into Supabase.
5. In Supabase → Authentication → URL Configuration:
   - Site URL: `https://members.progsu.com`
   - Additional redirect URLs: `http://localhost:3000/auth/callback`, `https://members.progsu.com/auth/callback`, and preview wildcards if needed.
6. Email confirmation: **disabled** (Google is already confirmed).
7. JWT expiry: default 3600s. Refresh handled by middleware.

### 2.2 Next.js implementation

Three pieces cooperate:

**`middleware.ts`** — runs on every request, refreshes the Supabase session cookie if expired, and writes the updated cookie back to the response. Using `@supabase/ssr`'s `createServerClient` with the cookie adapter.

```ts
// middleware.ts (sketch)
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n) => req.cookies.get(n)?.value,
        set: (n, v, o) => res.cookies.set({ name: n, value: v, ...o }),
        remove: (n, o) => res.cookies.set({ name: n, value: '', ...o }),
      },
    },
  );
  // Critical: this call refreshes the session and rewrites cookies on `res`.
  await supabase.auth.getUser();
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)'],
};
```

**`app/auth/callback/route.ts`** — Supabase redirects the browser here with `?code=...` after Google consents. We exchange the code for a session, then redirect.

```ts
// app/auth/callback/route.ts (sketch)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/onboarding';
  if (!code) return NextResponse.redirect(new URL('/login?error=no_code', url));

  const supabase = createRouteHandlerClient(); // ssr variant, wires cookies
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL('/login?error=exchange', url));
  return NextResponse.redirect(new URL(next, url));
}
```

**Server-component `getUser()` pattern** — never trust `getSession()` in an RSC (it reads cookies without verification). Always `getUser()`, which hits the Supabase Auth server and validates the JWT.

```ts
// lib/auth/server.ts
export async function getUser() {
  const supabase = createServerClient(/* ... */);
  const { data: { user } } = await supabase.auth.getUser();
  return user; // null if unauthenticated
}
```

Client-side sign-in kicks off the OAuth redirect:

```ts
// on a "Continue with Google" button
const supabase = createBrowserClient(URL, ANON);
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
    queryParams: { access_type: 'offline', prompt: 'consent' },
  },
});
```

### 2.3 Session storage — why cookies, not localStorage

| Concern | Cookies (`@supabase/ssr`) | localStorage |
|---|---|---|
| XSS exfiltration | HttpOnly → JS cannot read | Readable by any script on the page |
| SSR availability | Sent with every request automatically | RSC/middleware can't see it |
| CSRF | Mitigated via SameSite=Lax + PKCE | N/A but XSS is worse |
| Mobile webview | Standard | Works but breaks SSR |

We use `SameSite=Lax`, `Secure` (prod), `HttpOnly`, path `/`, 7-day max-age for refresh token.

### 2.4 Sign-out

```ts
// server action
export async function signOut() {
  const supabase = createServerClient(/* ... */);
  await supabase.auth.signOut(); // clears cookies on response
  redirect('/');
}
```

`signOut()` invalidates the refresh token server-side and wipes the Supabase cookies. We do **not** revoke the Google token; the user can re-sign-in without re-consenting unless they removed us from [myaccount.google.com](https://myaccount.google.com).

### 2.5 Edge cases for Google OAuth

| Scenario | Behavior |
|---|---|
| User revokes app at myaccount.google.com | Existing session keeps working until refresh fails. Next `getUser()` returns 401 → middleware clears cookies → user sees `/login`. |
| User's Google email changes | Supabase updates `auth.users.email` on next sign-in. `profile.google_email` is synced via a DB trigger or on next `getUser()`. Old email is logged in `audit_log` with `event='google_email_changed'`. |
| Session expiry mid-onboarding | Middleware silently refreshes. If refresh also expired (>7d), user is redirected to `/login?next=<current>`; onboarding state persists in the DB, so they resume where they left off. |
| User opens two tabs, signs out in one | The other tab's next server action fails with 401 → client catches and routes to `/login`. |
| OAuth `code` replayed | Supabase binds codes via PKCE — replay fails with a 400. |

---

## 3. Student-email OTP flow

### 3.1 Relevant tables (reference; full DDL in `02-data-model.md`)

```sql
create table school_domains (
  domain        text primary key,           -- 'gatech.edu'
  school_name   text not null,              -- 'Georgia Institute of Technology'
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);

create table email_verification_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         citext not null,            -- normalized student email
  code_hash     text not null,              -- bcrypt(12) or argon2id
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index ix_evc_user_email_active on email_verification_codes (user_id, email)
  where consumed_at is null;
create index ix_evc_user_created on email_verification_codes (user_id, created_at desc);
```

Raw codes are **never** written anywhere except the outbound email body; only `code_hash` lives in DB.

### 3.2 `requestCode(studentEmail)` server action

```
  [client form] --> POST server action
        |
        v
  1. Verify Supabase session (getUser).
  2. Normalize: email.trim().toLowerCase().
  3. Parse domain; SELECT from school_domains WHERE domain = $1 AND is_active.
        → if not found: return { ok:false, code:'DOMAIN_NOT_ALLOWED' }.
  4. Rate-limit check against email_verification_codes:
        a) 60s per (user_id, email)
        b) 5 per hour per user_id
        → if over: return { ok:false, code:'RATE_LIMITED', retryAfter }.
  5. Uniqueness: SELECT 1 FROM profiles
        WHERE student_email = $1 AND student_email_verified
          AND user_id <> :me.
        → if exists: { ok:false, code:'EMAIL_TAKEN' }.
  6. code = crypto.randomInt(0, 1_000_000).toString().padStart(6,'0')
     hash = await bcrypt.hash(code, 12)   // or argon2id
  7. UPDATE email_verification_codes SET consumed_at = now()
        WHERE user_id=:me AND email=$1 AND consumed_at IS NULL;
  8. INSERT row (user_id, email, code_hash, expires_at=now()+10min, attempts=0).
  9. resend.emails.send({
        from: RESEND_FROM_EMAIL,
        to: email,
        subject: 'Your Progsu verification code',
        react: <OtpEmail firstName=... code={code} expiresInMinutes={10} />,
        text: plaintextVersion,
        headers: { 'Idempotency-Key': `student-otp/${userId}/${email}/${minuteBucket}` }
     });
 10. return { ok:true, expiresAt }.
```

Notes:

- Step 6 uses `node:crypto.randomInt` (CSPRNG). `Math.random` is forbidden.
- Step 7 keeps at most one active code per (user, email). A second request within the 60s window is rejected by step 4 before we get here, so races are bounded.
- Step 9 includes a text fallback because many spam filters distrust HTML-only OTP mails.
- On Resend failure, we **roll back** the insert (`savepoint`) so the rate-limit counter doesn't burn on a send error; we still log the failure.

### 3.3 `verifyCode(studentEmail, code)` server action

```
  1. Verify Supabase session.
  2. Normalize email; validate code matches /^[0-9]{6}$/ (cheap filter).
  3. SELECT * FROM email_verification_codes
        WHERE user_id = :me AND email = :email AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  4. If no row → { ok:false, code:'NO_ACTIVE_CODE' }.
  5. If row.expires_at < now() → { ok:false, code:'EXPIRED' }.
  6. If row.attempts >= 5 → UPDATE consumed_at=now();
        return { ok:false, code:'LOCKED', requireRerequest:true }.
  7. const match = await bcrypt.compare(code, row.code_hash);   // constant-time by impl
     If !match:
        UPDATE attempts = attempts + 1;
        return { ok:false, code:'WRONG_CODE',
                 attemptsRemaining: 5 - (row.attempts+1) }.
  8. On match, in one transaction:
        UPDATE email_verification_codes SET consumed_at = now() WHERE id = row.id;
        UPDATE profiles SET
          student_email             = :email,
          student_email_verified    = true,
          student_email_verified_at = now(),
          school_domain             = :domain,
          school_name               = (select school_name from school_domains ...),
          verification_method       = 'student_email_otp'
          WHERE user_id = :me;
        INSERT INTO audit_log (user_id, event, meta)
          VALUES (:me, 'student_email_verified',
                  jsonb_build_object('email',:email,'domain',:domain));
  9. return { ok:true }.
```

Steps 3–8 run under `FOR UPDATE` so two parallel submits from the same user can't both succeed or both increment attempts twice.

---

## 4. API / server-action surface

All server actions are async functions exported from `app/(auth)/_actions/*.ts` and called via `<form action={...}>` or `useTransition`. All use zod for input validation. All require Supabase session unless noted.

### 4.1 `requestStudentEmailCode`

```ts
const Input = z.object({
  studentEmail: z.string().email().max(254),
});
type Output =
  | { ok: true; expiresAt: string /* ISO */ }
  | { ok: false; code:
      | 'UNAUTHENTICATED'
      | 'DOMAIN_NOT_ALLOWED'
      | 'RATE_LIMITED'
      | 'EMAIL_TAKEN'
      | 'SEND_FAILED';
      retryAfter?: number /* seconds */;
      message?: string;
    };
```

Auth: Supabase session required.

### 4.2 `verifyStudentEmailCode`

```ts
const Input = z.object({
  studentEmail: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});
type Output =
  | { ok: true }
  | { ok: false; code:
      | 'UNAUTHENTICATED'
      | 'NO_ACTIVE_CODE'
      | 'EXPIRED'
      | 'LOCKED'
      | 'WRONG_CODE';
      attemptsRemaining?: number;
    };
```

### 4.3 `resendStudentEmailCode`

Alias → calls `requestStudentEmailCode` under the hood. Same input/output. Reason for separate export: UI can show a distinct "Resend code" button without re-collecting the email.

### 4.4 `changeStudentEmail`

```ts
const Input = z.object({
  newStudentEmail: z.string().email(),
});
type Output =
  | { ok: true; expiresAt: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'DOMAIN_NOT_ALLOWED' | 'SAME_AS_CURRENT' | 'RATE_LIMITED' | 'EMAIL_TAKEN'; };
```

Effect: In one transaction — if the user currently has a verified email, write the old email to `audit_log` (`event='student_email_unverified'`), then set `student_email_verified=false`, `student_email_verified_at=null`, `school_domain=null`, `school_name=null`, `verification_method=null`, and finally invoke `requestStudentEmailCode` with the new address.

### 4.5 `signOut`

```ts
type Output = void; // always redirects to '/'
```

---

## 5. Edge cases

| # | Case | Handling |
|---|---|---|
| E1 | Duplicate student email across users | `requestCode` step 5 rejects with `EMAIL_TAKEN`. If both users need it (shared dept inbox), admin unverifies the prior holder. |
| E2 | Google email happens to be on a school domain | Still requires OTP. `google_email` and `student_email` are independent columns; we never auto-copy. (Open Q in §10.) |
| E3 | Re-verification | `changeStudentEmail` clears verified flags and logs `student_email_unverified` with the prior value before issuing a new OTP. |
| E4 | Expired OTP | Verify returns `EXPIRED`; client prompts "Request a new code." |
| E5 | Used OTP (consumed_at set) | Row skipped by the `WHERE consumed_at IS NULL` filter → returns `NO_ACTIVE_CODE`. |
| E6 | Tampered OTP (wrong length, non-numeric) | Fails zod before hitting DB → generic `WRONG_CODE` with `attemptsRemaining` intact (no DB write). |
| E7 | User closes tab mid-OTP | Returning user sees waiting-state derived from latest active row in DB (`ttl = expires_at - now()`). After 60s they can resend. |
| E8 | Graduated-out domain | Admin tool: `POST /admin/users/:id/unverify` clears verification and logs `student_email_admin_unverified`. User keeps Google login. |
| E9 | Brute-force attempts | 5-attempts-per-code cap (§3.3 step 6), plus 5-codes-per-hour per user (§3.2 step 4), plus 60s cool-down. |
| E10 | Code-request flood | Same 60s + 5/hour bounds; Resend idempotency key collapses duplicates in the same minute bucket. |
| E11 | Fake school domains | Allowlist-only. New domains require an admin insert into `school_domains`. |
| E12 | Google email changed on Google's end | Supabase returns updated `email` on refresh; we detect the diff in middleware and log `google_email_changed`. Does **not** touch `student_email`. |
| E13 | Two concurrent verify calls | `FOR UPDATE` in §3.3 serializes; second call sees `consumed_at` set → `NO_ACTIVE_CODE`. |
| E14 | Domain deactivated after user verified | User keeps verified status (V0 policy); no automatic unverification. Admin can unverify manually. See §10. |

---

## 6. Rate limiting & abuse controls

| Limit | Where enforced | Mechanism |
|---|---|---|
| 1 code per 60s per email | Server action + DB query | SQL count in `requestCode` step 4 |
| 5 codes per hour per user | Server action + DB query | SQL count in `requestCode` step 4 |
| 5 attempts per code | Server action + DB row | `attempts` column check in `verifyCode` step 6 |
| Only allowlisted domains | Server action + DB lookup | `school_domains.is_active` |
| Duplicate verified email | Server action + DB lookup + DB unique partial index | `profiles (student_email) where student_email_verified` |
| Duplicate Resend sends | Resend API | `Idempotency-Key` header |
| Supabase brute-force | Supabase Auth | Built-in rate limits on `/auth/v1/*` |
| Session cookie tampering | Supabase | Signed JWT |

**SQL fragment — 60s and 5/hour check in one round trip:**

```sql
-- :uid = current user_id, :email = normalized student email
select
  sum(case when created_at > now() - interval '60 seconds' and email = :email
           then 1 else 0 end) as recent_same_email,
  sum(case when created_at > now() - interval '1 hour'
           then 1 else 0 end) as hourly_total
from email_verification_codes
where user_id = :uid
  and created_at > now() - interval '1 hour';
-- Reject if recent_same_email > 0 OR hourly_total >= 5.
```

Additionally, a weekly pg_cron job purges consumed/expired rows older than 30 days to keep the table lean without losing short-term forensic data.

---

## 7. Reverification strategy

V0 policy:

- **No auto-expiry.** Once `student_email_verified=true`, it stays true until the user changes it or an admin unverifies.
- **Self-service:** The settings page offers "Change student email" (`changeStudentEmail` action) and "Re-verify current student email" (re-runs OTP against the same address).
- **Admin tool:** `POST /admin/users/:id/unverify` clears verified flags and writes `audit_log.event='student_email_admin_unverified'`. Used when a domain is deactivated or a user has clearly graduated.

Future (V1+) hooks — not built now but not designed out:

- Add `reverify_due_at` column on `profiles`, compute annual due date.
- Nightly job flips `student_email_verified=false` on overdue rows and sends a reminder email.
- Dashboard shows "Your student-email verification expires in N days" with a one-click re-verify button.

---

## 8. React Email OTP template sketch

```tsx
// emails/OtpEmail.tsx
import {
  Html, Head, Body, Container, Section, Text, Heading, Hr,
} from '@react-email/components';

export interface OtpEmailProps {
  firstName: string;
  code: string;              // raw 6-digit; rendered, then discarded
  expiresInMinutes: number;  // 10
}

export function OtpEmail({ firstName, code, expiresInMinutes }: OtpEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f6f6' }}>
        <Container style={{ background: '#fff', padding: 32, maxWidth: 520 }}>
          <Heading as="h1" style={{ fontSize: 20 }}>Verify your student email</Heading>
          <Text>Hi {firstName},</Text>
          <Text>Enter this code in Progsu to confirm your student email:</Text>

          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Text style={{ fontSize: 36, letterSpacing: 8, fontWeight: 700 }}>
              {code}
            </Text>
          </Section>

          <Text>
            This code expires in {expiresInMinutes} minutes. If you didn’t request it,
            you can ignore this email.
          </Text>

          <Hr />
          <Text style={{ fontSize: 12, color: '#666' }}>
            Progsu · Member Platform · Never share this code with anyone.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const otpPlainText = (p: OtpEmailProps) => `Hi ${p.firstName},

Your Progsu student-email verification code is: ${p.code}

It expires in ${p.expiresInMinutes} minutes. If you didn't request this, ignore this email.

— Progsu`;
```

Usage:

```ts
await resend.emails.send({
  from: process.env.RESEND_FROM_EMAIL!,           // 'Progsu <no-reply@mail.progsu.com>'
  to: studentEmail,
  subject: 'Your Progsu verification code',
  react: <OtpEmail firstName={firstName} code={code} expiresInMinutes={10} />,
  text: otpPlainText({ firstName, code, expiresInMinutes: 10 }),
  headers: { 'Idempotency-Key': idempotencyKey },
});
```

---

## 9. Environment variables

| Var | Scope | Example / notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | `https://abcdxyz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | public; safe in bundle |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Never exposed to browser. Used by server actions for admin ops (e.g., profile writes that bypass RLS, audit_log inserts). |
| `NEXT_PUBLIC_SITE_URL` | client + server | `http://localhost:3000` / `https://members.progsu.com`. Used to build `redirectTo`. |
| `RESEND_API_KEY` | **server only** | Resend dashboard → API keys. |
| `RESEND_FROM_EMAIL` | server | `Progsu <no-reply@mail.progsu.com>`. Domain must be verified in Resend. |
| `OTP_CODE_TTL_MINUTES` | server | default 10 — keeps magic numbers out of code |
| `OTP_MAX_ATTEMPTS` | server | default 5 |
| `OTP_PER_EMAIL_COOLDOWN_SECONDS` | server | default 60 |
| `OTP_PER_USER_HOURLY_LIMIT` | server | default 5 |
| `BCRYPT_COST` | server | default 12 (tune per load test) |
| `NODE_ENV` | both | `development` \| `production` |

Local dev uses `.env.local`; prod uses Vercel project env. The service-role and Resend keys **must** be marked server-only in Vercel and never referenced in a `use client` file.

---

## 10. Open questions / risks

1. **Personal Gmail vs student email independence.** Current spec treats `google_email` and `student_email` as fully independent. If product later wants "fast-path: if google_email ends in an allowlisted domain, skip OTP and mark verified," we'd need a policy flag on `school_domains` (`allow_google_fastpath boolean`). Default today is OTP for everyone. Needs product sign-off before V1.
2. **Domain deactivation and existing verifications.** When `school_domains.is_active` flips to false, already-verified users retain their status (V0). Do we (a) leave them, (b) silently unverify, (c) mark "verification stale" and prompt re-verification? Leaning (c) for V1 with a nightly job, but V0 keeps (a) for simplicity. Product must decide the cutoff policy.
3. **Shared mailboxes.** A lab mailing list like `lab-announce@gatech.edu` would block any single user from claiming it after the first. Acceptable edge case; admin can unlock if legitimate.
4. **Bcrypt vs argon2id.** Bcrypt(12) is zero-dep on Node; argon2id needs a native addon but is memory-hard. For 6-digit numeric codes with 5-attempt caps the cost of brute-force is already dominated by our rate limits. V0 uses bcrypt(12); revisit if we ever widen code space.
5. **Resend deliverability to `.edu` domains.** Some university spam filters aggressively block transactional mail. We should warm the Resend domain early and monitor bounce rates. If deliverability becomes an issue, add Postmark as a fallback provider.
6. **Timing-leak on `EMAIL_TAKEN`.** Returning `EMAIL_TAKEN` discloses that another account has verified that address. Acceptable for student-email semantics (the user likely owns the inbox), but worth noting — we could collapse it to a generic error if privacy review objects.
7. **PKCE vs implicit grant.** `@supabase/ssr` defaults to PKCE — confirmed. No action needed, but listing so future readers don't revert it.
8. **Session binding to IP / UA.** Not enforced in V0. Could cause false logouts on mobile IP changes; skip for now.

---

## Appendix A — Folder layout cheatsheet

```
app/
  (auth)/
    login/page.tsx              # "Continue with Google"
    onboarding/
      student-email/page.tsx    # form → requestStudentEmailCode
      verify/page.tsx           # form → verifyStudentEmailCode
    _actions/
      googleSignOut.ts
      requestStudentEmailCode.ts
      verifyStudentEmailCode.ts
      changeStudentEmail.ts
  auth/
    callback/route.ts           # OAuth code exchange
emails/
  OtpEmail.tsx
lib/
  auth/
    server.ts                   # getUser(), createServerClient()
    browser.ts                  # createBrowserClient()
  otp/
    generate.ts                 # crypto.randomInt + bcrypt.hash
    rateLimit.ts                # SQL from §6
middleware.ts
```

## Appendix B — State machine (OTP UI)

```
      [idle] --submit email--> [requesting]
   [requesting] --ok-------->  [awaiting_code]
   [requesting] --rate_limit->[cooldown] (shows countdown; back to idle @ 0)
[awaiting_code] --submit-->   [verifying]
    [verifying] --ok-------->  [done]
    [verifying] --wrong_code-> [awaiting_code] (show attemptsRemaining)
    [verifying] --expired---->[idle] (toast: "Code expired, request a new one")
    [verifying] --locked---->[idle] (toast: "Too many attempts, request a new one")
  [awaiting_code] --resend--> [requesting] (only after 60s)
```
