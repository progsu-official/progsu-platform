# 02 — Data Model & Security Architecture

Progsu Member Platform · Supabase Postgres + Drizzle ORM + Next.js 15.
This document is the single source of truth for the database schema, Row-Level Security (RLS), storage policies, triggers, and seed data.

---

## 1. Entity-relationship overview

The data model is centered on `profiles` (1:1 with `auth.users`). Every member row is created by a trigger on sign-in. Student verification, consents, resumes, and audit events all attach to `profiles` via `user_id`. Admins are an `is_admin boolean` flag on `profiles`; there is no separate admins table in V0. School domains are a lookup table driving `@student.gsu.edu`-style OTP verification.

```
                                  ┌──────────────────────┐
                                  │  auth.users          │  (Supabase-managed)
                                  │  id uuid PK          │
                                  └──────────┬───────────┘
                                             │ 1:1 (id = id)
                                             ▼
                                  ┌──────────────────────┐
                                  │  profiles            │
                                  │  id uuid PK FK       │
                                  │  google_email        │
                                  │  student_email       │
                                  │  student_email_verified
                                  │  is_admin            │
                                  │  profile_completed   │
                                  │  open_to_recruiters  │
                                  └──────────┬───────────┘
                                             │ 1:N user_id
                ┌────────────────────────────┼────────────────────────────┬────────────────────────┐
                ▼                            ▼                            ▼                        ▼
  ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────┐
  │ email_verification_    │  │ resumes                │  │ consents               │  │ audit_log            │
  │  codes                 │  │ id uuid PK             │  │ id uuid PK             │  │ id uuid PK           │
  │ id uuid PK             │  │ user_id FK             │  │ user_id FK             │  │ actor_user_id FK     │
  │ user_id FK             │  │ storage_path           │  │ consent_type enum      │  │ target_user_id FK    │
  │ email                  │  │ is_current bool        │  │ accepted bool          │  │ action text          │
  │ code_hash              │  │ file_size, mime_type   │  │ version int, ip, ua    │  │ metadata jsonb       │
  │ expires_at, attempts   │  │ uploaded_at            │  │ accepted_at            │  │ created_at           │
  └────────────────────────┘  └────────────────────────┘  └────────────────────────┘  └──────────────────────┘

  ┌────────────────────────┐
  │ school_domains         │  (reference table, no user FK)
  │ domain PK              │
  │ school_name, slug      │
  │ is_active              │
  └────────────────────────┘

  storage.objects (bucket='resumes')
    path = '{user_id}/{resume_id}.pdf'
```

Key relationship notes:
- `profiles.id` IS `auth.users.id` (shared PK). ON DELETE CASCADE when the auth user is removed.
- `profiles.student_email_domain` is validated against `school_domains.domain` via CHECK at insert-time in the verification RPC (not a DB FK, because domains can be deactivated without orphaning verified profiles).
- `resumes`, `consents`, `email_verification_codes`, and `audit_log` all FK to `profiles.id` with ON DELETE CASCADE (user deletion wipes their data).

### Profiles: merged vs split?

**Decision: keep merged (`profiles` holds student verification columns).**

Rationale:
1. The verification state is 1:1 with the profile and always needed when rendering the dashboard — a split would require a left-join on every page load.
2. OTP *attempts* are volatile and already live in a separate table (`email_verification_codes`). Only the resolved state (`student_email`, `student_email_verified_at`, `verification_method`) belongs on the profile.
3. FERPA-style audit requirements are satisfied by `audit_log`, not by a separate `student_verifications` table.

If we later need historical verification records (e.g. re-verification every year), we promote `student_verifications` to its own table and soft-migrate the columns off `profiles`.

---

## 2. Tables

### 2.1 `profiles`

Login identity + student verification + member profile + admin flag.

```sql
create table public.profiles (
  id                              uuid primary key references auth.users(id) on delete cascade,

  -- Google OAuth identity (from auth.users metadata, denormalized for convenience)
  google_email                    citext not null,
  full_name                       text,
  avatar_url                      text,

  -- Student verification (separate from auth identity)
  student_email                   citext,
  student_email_domain            citext
    generated always as (split_part(student_email::text, '@', 2)) stored,
  student_email_verified          boolean not null default false,
  student_email_verified_at       timestamptz,
  verification_method             verification_method_t,  -- enum, see §3

  -- Member profile fields
  preferred_name                  text,
  phone_number                    text check (phone_number is null or phone_number ~ '^\+?[0-9\-\(\) ]{7,20}$'),
  class_standing                  class_standing_t,       -- enum
  major                           text,
  minor                           text,
  graduation_term                 text check (graduation_term is null or graduation_term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'),
  graduation_year                 int  check (graduation_year is null or (graduation_year between 2000 and 2100)),
  bio                             text check (bio is null or length(bio) <= 1000),
  linkedin_url                    text check (linkedin_url is null or linkedin_url ~* '^https?://([a-z]+\.)?linkedin\.com/'),
  github_url                      text check (github_url is null or github_url ~* '^https?://github\.com/'),
  personal_site_url               text check (personal_site_url is null or personal_site_url ~* '^https?://'),
  interested_roles                interested_role_t[] not null default '{}'::interested_role_t[],

  -- Flags
  is_admin                        boolean not null default false,
  profile_completed               boolean not null default false,
  open_to_recruiters              boolean not null default false,

  -- Timestamps
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

comment on table  public.profiles is '1:1 with auth.users. Created by handle_new_user() trigger. Student email verification tracked here; OTP attempts live in email_verification_codes.';
comment on column public.profiles.is_admin is 'Seed manually via SQL. Drives public.is_admin(auth.uid()) helper.';

alter table public.profiles enable row level security;

-- updated_at trigger
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
```

Indexes: see §4.

### 2.2 `email_verification_codes`

Pending/consumed OTP codes. Codes are hashed (never stored plaintext) so that a DB leak cannot be replayed against users.

```sql
create table public.email_verification_codes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  email             citext not null,
  code_hash         text   not null,              -- sha-256 of "userId:code" salted server-side
  expires_at        timestamptz not null,         -- issued_at + 10 minutes
  attempts          int    not null default 0,    -- incremented on every bad attempt
  max_attempts      int    not null default 5,
  consumed_at       timestamptz,                  -- set when the code succeeds
  created_at        timestamptz not null default now(),

  constraint chk_email_domain
    check (position('@' in email::text) > 0),
  constraint chk_attempts
    check (attempts >= 0 and attempts <= max_attempts + 1)
);

comment on table  public.email_verification_codes is 'OTP codes for @student.gsu.edu verification. code_hash = sha256(user_id::text || ":" || code || ":" || server_salt). Cleaned by scheduled job after 24h.';
comment on column public.email_verification_codes.code_hash is 'Never store plaintext OTP. Hash with a server-only salt so DB exfil alone is not replayable.';

create index email_verification_codes_user_email_idx
  on public.email_verification_codes (user_id, email)
  where consumed_at is null;

create index email_verification_codes_expires_idx
  on public.email_verification_codes (expires_at)
  where consumed_at is null;

alter table public.email_verification_codes enable row level security;
```

**Hashing rationale.** The OTP is a 6-digit number; an attacker with DB read access could otherwise see the plaintext code while the window is open. We hash `sha256(user_id || ':' || code || ':' || env.OTP_SALT)` server-side and compare on verify. The salt lives only in the server environment, not in the DB.

### 2.3 `resumes`

PDF only, ≤10 MB, one `is_current=true` per user.

```sql
create table public.resumes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  storage_path    text not null,                  -- '{user_id}/{resume_id}.pdf'
  file_name       text not null,                  -- original upload name, sanitized
  file_size       bigint not null check (file_size > 0 and file_size <= 10 * 1024 * 1024),
  mime_type       text   not null check (mime_type = 'application/pdf'),
  is_current      boolean not null default false,
  uploaded_at     timestamptz not null default now(),

  constraint resumes_storage_path_unique unique (storage_path)
);

comment on table public.resumes is 'PDF <= 10MB. Older rows kept for audit; only is_current=true one is used in exports.';

-- Exactly zero or one current resume per user (partial unique).
create unique index resumes_one_current_per_user
  on public.resumes (user_id)
  where is_current;

create index resumes_user_uploaded_idx
  on public.resumes (user_id, uploaded_at desc);

alter table public.resumes enable row level security;
```

### 2.4 `consents`

Append-only. Every accept/decline is a new row; we never mutate past consents.

```sql
create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  consent_type   consent_type_t not null,
  accepted       boolean not null,
  version        int    not null check (version >= 1),
  accepted_at    timestamptz not null default now(),
  ip_address     inet,
  user_agent     text,

  constraint consents_unique_per_version
    unique (user_id, consent_type, version)
);

comment on table public.consents is 'Append-only consent ledger. One row per (user, consent_type, version). No UPDATE/DELETE allowed via RLS.';

create index consents_user_type_idx
  on public.consents (user_id, consent_type, version desc);

create index consents_type_accepted_idx
  on public.consents (consent_type, accepted)
  where accepted;

alter table public.consents enable row level security;
```

### 2.5 `school_domains`

Configurable allowlist of student email domains. Admin-editable.

```sql
create table public.school_domains (
  domain        citext primary key,
  school_name   text   not null,
  school_slug   text   not null unique
                check (school_slug ~ '^[a-z0-9\-]+$'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.school_domains is 'Allowlist for student email verification. Admin-only writes; authenticated read.';

create index school_domains_active_idx
  on public.school_domains (is_active)
  where is_active;

alter table public.school_domains enable row level security;

create trigger school_domains_set_updated_at
  before update on public.school_domains
  for each row execute function public.set_updated_at();
```

### 2.6 `audit_log`

Admin-visible append-only log of sensitive actions.

```sql
create table public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  actor_user_id    uuid references public.profiles(id) on delete set null,  -- null = system
  target_user_id   uuid references public.profiles(id) on delete set null,  -- nullable for non-user actions
  action           text not null,          -- 'admin_export_recruiter', 'manual_verification_toggle', 'resume_delete', ...
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

comment on table public.audit_log is 'Append-only admin-visible log. Writes only via SECURITY DEFINER functions.';

create index audit_log_actor_idx    on public.audit_log (actor_user_id, created_at desc);
create index audit_log_target_idx   on public.audit_log (target_user_id, created_at desc);
create index audit_log_action_idx   on public.audit_log (action, created_at desc);
create index audit_log_metadata_gin on public.audit_log using gin (metadata);

alter table public.audit_log enable row level security;
```

---

## 3. Enums

All enums use Postgres `CREATE TYPE ... AS ENUM`. Adding values requires a migration; we do not UPDATE enum labels in place.

```sql
-- Consent categories. Never collapse these.
create type public.consent_type_t as enum (
  'privacy_policy',
  'terms_of_service',
  'recruiter_resume_sharing',
  'email_marketing',
  'sms_marketing'
);

-- Class standing
create type public.class_standing_t as enum (
  'freshman',
  'sophomore',
  'junior',
  'senior',
  'graduate',
  'phd',
  'alumni'
);

-- Roles a member is interested in. Multi-select on profile.
create type public.interested_role_t as enum (
  'software_engineering',
  'data_science',
  'data_engineering',
  'machine_learning',
  'product_management',
  'ui_ux_design',
  'devops_sre',
  'cybersecurity',
  'research',
  'consulting',
  'quant_finance',
  'other'
);

-- How the student email was verified.
create type public.verification_method_t as enum (
  'email_otp',        -- Resend OTP flow (default)
  'admin_manual'      -- Admin toggled verified=true with justification
);
```

`consent_type_t` is the only enum guaranteed stable by product; the others may gain values over time. Enum changes must be additive.

---

## 4. Indexes

| Table | Index | Rationale |
|---|---|---|
| `profiles` | `(is_admin) WHERE is_admin` | Fast admin-row detection in RLS helper fn (tiny partial index). |
| `profiles` | `(student_email_verified, open_to_recruiters) WHERE student_email_verified AND open_to_recruiters` | Recruiter export base filter. |
| `profiles` | `(student_email_domain)` | Admin filter by school. |
| `profiles` | `(graduation_year)` | Admin filter. |
| `profiles` | `(class_standing)` | Admin filter. |
| `profiles` | `GIN (interested_roles)` | Admin filter "any role in [list]" via `&&`. |
| `profiles` | `(lower(full_name) text_pattern_ops)` | Case-insensitive name search. |
| `profiles` | `(google_email)` UNIQUE | Login email lookup / de-dup guard. |
| `profiles` | `(student_email)` UNIQUE WHERE `student_email IS NOT NULL` | No two members may claim the same verified @school email. |
| `email_verification_codes` | `(user_id, email) WHERE consumed_at IS NULL` | Fast "is there an active code?" lookup. |
| `email_verification_codes` | `(expires_at) WHERE consumed_at IS NULL` | Cleanup job range scan. |
| `resumes` | `(user_id) WHERE is_current` UNIQUE | Enforce single current resume. |
| `resumes` | `(user_id, uploaded_at DESC)` | Member history view. |
| `consents` | `(user_id, consent_type, version DESC)` | Gating check: "latest version accepted?" |
| `consents` | `(consent_type, accepted) WHERE accepted` | Stats / re-consent migrations. |
| `school_domains` | `(is_active) WHERE is_active` | Verification RPC hot path. |
| `audit_log` | `(actor_user_id, created_at DESC)`, `(target_user_id, created_at DESC)`, `(action, created_at DESC)`, `GIN (metadata)` | Admin audit UI + targeted queries. |

```sql
-- Executable index definitions
create unique index profiles_google_email_idx on public.profiles (google_email);
create unique index profiles_student_email_idx
  on public.profiles (student_email) where student_email is not null;

create index profiles_is_admin_idx
  on public.profiles (is_admin) where is_admin;

create index profiles_recruiter_export_idx
  on public.profiles (student_email_verified, open_to_recruiters)
  where student_email_verified and open_to_recruiters;

create index profiles_student_domain_idx  on public.profiles (student_email_domain);
create index profiles_grad_year_idx        on public.profiles (graduation_year);
create index profiles_class_standing_idx   on public.profiles (class_standing);
create index profiles_interested_roles_gin on public.profiles using gin (interested_roles);
create index profiles_full_name_lower_idx
  on public.profiles (lower(full_name) text_pattern_ops);
```

---

## 5. RLS policies

RLS is ON for every table in `public.`. The single source of truth for admin authority is the helper function below.

### 5.1 Admin helper

`is_admin()` is `STABLE` (same row during a statement) and uses `SECURITY DEFINER` so it can read `profiles.is_admin` even when the caller cannot SELECT the row. `search_path=public` prevents hijacking via temp schemas.

```sql
create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = p_user_id),
    false
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant  execute on function public.is_admin(uuid) to authenticated, service_role;
```

### 5.2 `profiles`

```sql
-- Read own row
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Update own row (cannot elevate is_admin; enforced by column grant + a guard)
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
    -- student_email_verified may only be flipped via RPC (see §7); block direct client writes:
    and student_email_verified = (select p.student_email_verified from public.profiles p where p.id = auth.uid())
  );

-- Admin read all
create policy profiles_select_admin
  on public.profiles for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- Admin update all
create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- No client INSERT. Rows are created exclusively by handle_new_user() trigger.
-- No client DELETE. Deletion flows through Supabase Auth + cascade.
```

### 5.3 `email_verification_codes`

Clients never read or write this table. All access flows through server actions running as the service role.

```sql
-- Deny everything for authenticated; no policies = no access under RLS-on.
-- (Service role bypasses RLS by design.)

-- Explicit deny policies for defense-in-depth:
create policy evc_no_select
  on public.email_verification_codes for select
  to authenticated
  using (false);

create policy evc_no_insert
  on public.email_verification_codes for insert
  to authenticated
  with check (false);

create policy evc_no_update
  on public.email_verification_codes for update
  to authenticated
  using (false) with check (false);

create policy evc_no_delete
  on public.email_verification_codes for delete
  to authenticated
  using (false);
```

### 5.4 `resumes`

```sql
-- Members can read their own resume rows
create policy resumes_select_own
  on public.resumes for select
  to authenticated
  using (auth.uid() = user_id);

-- Members can insert their own resume rows
-- is_current MUST be false on direct inserts; set_current_resume() flips it.
create policy resumes_insert_own
  on public.resumes for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and is_current = false
    and mime_type = 'application/pdf'
    and file_size <= 10 * 1024 * 1024
  );

-- Members can delete their own non-current resumes (for cleanup of history)
create policy resumes_delete_own_noncurrent
  on public.resumes for delete
  to authenticated
  using (auth.uid() = user_id and is_current = false);

-- Admin can read all
create policy resumes_select_admin
  on public.resumes for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- No direct UPDATE by clients. is_current is flipped only by set_current_resume() SECURITY DEFINER fn.
create policy resumes_no_update_client
  on public.resumes for update
  to authenticated
  using (false) with check (false);
```

### 5.5 `consents`

Append-only. No UPDATE, no DELETE — ever.

```sql
create policy consents_select_own
  on public.consents for select
  to authenticated
  using (auth.uid() = user_id);

create policy consents_insert_own
  on public.consents for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy consents_select_admin
  on public.consents for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy consents_no_update
  on public.consents for update
  to authenticated
  using (false) with check (false);

create policy consents_no_delete
  on public.consents for delete
  to authenticated
  using (false);
```

### 5.6 `school_domains`

```sql
create policy school_domains_select_auth
  on public.school_domains for select
  to authenticated
  using (true);

create policy school_domains_write_admin
  on public.school_domains for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
```

### 5.7 `audit_log`

```sql
create policy audit_log_select_admin
  on public.audit_log for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- No direct client writes. Writes flow through SECURITY DEFINER fns.
create policy audit_log_no_insert_client
  on public.audit_log for insert
  to authenticated
  with check (false);
create policy audit_log_no_update
  on public.audit_log for update
  to authenticated using (false) with check (false);
create policy audit_log_no_delete
  on public.audit_log for delete
  to authenticated using (false);
```

---

## 6. Storage bucket plan

### 6.1 Bucket config

```sql
-- In Supabase Dashboard or via API: create the private bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

- **Private** (`public = false`): objects are never served without a signed URL.
- **Path convention**: `{user_id}/{resume_id}.pdf`.
  - Justification: user_id as the *first* path segment makes RLS trivial: `storage.foldername(name)[1] = auth.uid()::text`. Using `resume_id` for the filename guarantees uniqueness across re-uploads and lets us keep a permanent history even if the same original filename is re-used.
- **Size + MIME enforcement**: storage policy can restrict by prefix but *cannot* reliably verify MIME type at write time (browsers lie). We therefore enforce in three places:
  1. Client: `<input type="file" accept="application/pdf">` + `File.size` guard.
  2. Server action / edge function: parse the first bytes (`%PDF-` magic) and check `Content-Length`.
  3. DB: `resumes.mime_type = 'application/pdf'` and `file_size <= 10 MiB` CHECK constraints.
- **Bucket-level**: `allowed_mime_types` and `file_size_limit` on the bucket provide a last line of defense; Supabase rejects uploads violating them.

### 6.2 Storage RLS

```sql
-- Owners can insert objects under their own prefix
create policy resumes_storage_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners can read their own objects (signed-URL generation still requires this)
create policy resumes_storage_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners can delete their own objects (cascade when they remove a resume row)
create policy resumes_storage_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners may update metadata (e.g. overwrite by upsert). Path stays under their prefix.
create policy resumes_storage_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin read-all for preview + export
create policy resumes_storage_select_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and public.is_admin(auth.uid())
  );

-- No public read. We never return raw https://.../object/public/... URLs.
```

### 6.3 Signed URL policy

| Consumer | TTL | Where minted |
|---|---|---|
| Member dashboard ("Download current resume") | **5 minutes** | Server action, after re-checking `auth.uid() = resume.user_id`. |
| Admin preview ("View this applicant's PDF") | **15 minutes** | Server action, after `public.is_admin(auth.uid())` check + `audit_log` insert. |
| Admin ZIP export | **stream**, not signed URL | Server-side: fetch with service role into a streaming ZIP; never exposed to browser directly. |

Never return `getPublicUrl()` output for the `resumes` bucket. All public URL callsites should fail lint.

---

## 7. Triggers / SECURITY DEFINER functions

### 7.1 `set_updated_at()`

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

### 7.2 `handle_new_user()` — on auth.users insert

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, google_email, full_name, avatar_url)
  values (
    new.id,
    -- new.email is the Google identity email
    lower(new.email)::citext,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### 7.3 `set_current_resume(p_resume_id uuid)`

Atomically flips `is_current`. Runs under the authenticated user; does not require admin.

```sql
create or replace function public.set_current_resume(p_resume_id uuid)
returns public.resumes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     public.resumes;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Verify ownership before mutating
  select * into v_row from public.resumes
    where id = p_resume_id and user_id = v_user_id
    for update;

  if not found then
    raise exception 'resume_not_found_or_forbidden' using errcode = '42501';
  end if;

  update public.resumes
    set is_current = false
    where user_id = v_user_id and is_current = true;

  update public.resumes
    set is_current = true
    where id = p_resume_id
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_current_resume(uuid) from public;
grant  execute on function public.set_current_resume(uuid) to authenticated;
```

### 7.4 `verify_student_email(p_email citext, p_code text)` — consumes an OTP

Runs under the authenticated user. Validates, flips `profiles.student_email_verified`, inserts audit.

```sql
create or replace function public.verify_student_email(p_email citext, p_code text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_domain  citext;
  v_row     public.email_verification_codes;
  v_profile public.profiles;
  v_hash    text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_domain := split_part(p_email::text, '@', 2)::citext;

  if not exists (
    select 1 from public.school_domains
    where domain = v_domain and is_active
  ) then
    raise exception 'domain_not_allowed' using errcode = '22023';
  end if;

  select * into v_row
    from public.email_verification_codes
    where user_id = v_user_id
      and email   = p_email
      and consumed_at is null
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;

  if not found then
    raise exception 'no_active_code' using errcode = '22023';
  end if;

  if v_row.attempts >= v_row.max_attempts then
    raise exception 'too_many_attempts' using errcode = '22023';
  end if;

  -- Recompute hash using server-side salt (set via `ALTER DATABASE ... SET app.otp_salt = '...'`)
  v_hash := encode(digest(v_user_id::text || ':' || p_code || ':' || current_setting('app.otp_salt', true), 'sha256'), 'hex');

  if v_hash <> v_row.code_hash then
    update public.email_verification_codes
      set attempts = attempts + 1
      where id = v_row.id;
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  update public.email_verification_codes
    set consumed_at = now()
    where id = v_row.id;

  update public.profiles
    set student_email            = p_email,
        student_email_verified   = true,
        student_email_verified_at = now(),
        verification_method      = 'email_otp',
        updated_at               = now()
    where id = v_user_id
    returning * into v_profile;

  insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
  values (v_user_id, v_user_id, 'student_email_verified',
          jsonb_build_object('email', p_email, 'method', 'email_otp'));

  return v_profile;
end;
$$;

revoke all on function public.verify_student_email(citext, text) from public;
grant  execute on function public.verify_student_email(citext, text) to authenticated;
```

### 7.5 `admin_toggle_verification(p_target uuid, p_verified boolean, p_reason text)`

```sql
create or replace function public.admin_toggle_verification(
  p_target   uuid,
  p_verified boolean,
  p_reason   text
) returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row   public.profiles;
begin
  if not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.profiles
    set student_email_verified    = p_verified,
        student_email_verified_at = case when p_verified then now() else null end,
        verification_method       = case when p_verified then 'admin_manual'::verification_method_t else null end,
        updated_at                = now()
    where id = p_target
    returning * into v_row;

  insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
  values (v_actor, p_target, 'manual_verification_toggle',
          jsonb_build_object('verified', p_verified, 'reason', p_reason));

  return v_row;
end;
$$;

revoke all on function public.admin_toggle_verification(uuid, boolean, text) from public;
grant  execute on function public.admin_toggle_verification(uuid, boolean, text) to authenticated;
```

### 7.6 `admin_export_recruiter_safe(filters jsonb)`

Returns only profiles passing the recruiter gating criteria. Logs every call.

**Gating criteria (all must be true):**
1. `student_email_verified = true`
2. `open_to_recruiters = true`
3. A current resume exists (`exists (select 1 from resumes r where r.user_id = p.id and r.is_current)`)
4. Latest `consents` row of type `recruiter_resume_sharing` has `accepted = true` AND `version = current_recruiter_consent_version()`.

```sql
-- Helper: current required consent version (bump this in a migration when ToS changes)
create or replace function public.current_consent_version(p_type consent_type_t)
returns int
language sql
stable
as $$
  select case p_type
    when 'privacy_policy'            then 1
    when 'terms_of_service'          then 1
    when 'recruiter_resume_sharing'  then 1
    when 'email_marketing'           then 1
    when 'sms_marketing'             then 1
  end;
$$;

-- Latest consent decision per (user, type)
create or replace view public.v_latest_consents as
  select distinct on (user_id, consent_type)
    user_id, consent_type, accepted, version, accepted_at
  from public.consents
  order by user_id, consent_type, version desc, accepted_at desc;

create or replace function public.admin_export_recruiter_safe(p_filters jsonb default '{}'::jsonb)
returns table (
  user_id               uuid,
  full_name             text,
  student_email         citext,
  google_email          citext,
  class_standing        class_standing_t,
  major                 text,
  graduation_term       text,
  graduation_year       int,
  interested_roles      interested_role_t[],
  linkedin_url          text,
  github_url            text,
  current_resume_id     uuid,
  current_resume_path   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count int;
begin
  if not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with elig as (
    select p.*
    from public.profiles p
    where p.student_email_verified
      and p.open_to_recruiters
      and exists (
        select 1 from public.resumes r where r.user_id = p.id and r.is_current
      )
      and exists (
        select 1 from public.v_latest_consents c
        where c.user_id = p.id
          and c.consent_type = 'recruiter_resume_sharing'
          and c.accepted
          and c.version = public.current_consent_version('recruiter_resume_sharing')
      )
      -- Optional filters (jsonb-driven)
      and (p_filters ->> 'school_slug' is null
           or exists (
             select 1 from public.school_domains sd
             where sd.domain = p.student_email_domain
               and sd.school_slug = p_filters ->> 'school_slug'
           ))
      and (p_filters ->> 'graduation_year' is null
           or p.graduation_year = (p_filters ->> 'graduation_year')::int)
      and (p_filters ->> 'class_standing' is null
           or p.class_standing = (p_filters ->> 'class_standing')::class_standing_t)
      and (p_filters -> 'interested_roles' is null
           or p.interested_roles && (
             select array_agg(value::text::interested_role_t)
             from jsonb_array_elements_text(p_filters -> 'interested_roles')
           ))
  )
  select
    e.id, e.full_name, e.student_email, e.google_email,
    e.class_standing, e.major, e.graduation_term, e.graduation_year,
    e.interested_roles, e.linkedin_url, e.github_url,
    r.id, r.storage_path
  from elig e
  join public.resumes r on r.user_id = e.id and r.is_current;

  get diagnostics v_count = row_count;

  insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
  values (v_actor, null, 'admin_export_recruiter',
          jsonb_build_object('filters', p_filters, 'row_count', v_count));
end;
$$;

revoke all on function public.admin_export_recruiter_safe(jsonb) from public;
grant  execute on function public.admin_export_recruiter_safe(jsonb) to authenticated;
```

---

## 8. Seed data

Initial 6 `school_domains`. The Progsu chapter is GSU; the others are sister programs likely to onboard next.

```sql
insert into public.school_domains (domain, school_name, school_slug, is_active) values
  ('student.gsu.edu', 'Georgia State University', 'gsu', true),
  ('gsu.edu',         'Georgia State University (staff)', 'gsu-staff', true),
  ('gatech.edu',      'Georgia Institute of Technology', 'gatech', true),
  ('emory.edu',       'Emory University', 'emory', true),
  ('kennesaw.edu',    'Kennesaw State University', 'ksu', true),
  ('gcsu.edu',        'Georgia College & State University', 'gcsu', true)
on conflict (domain) do update
  set school_name = excluded.school_name,
      school_slug = excluded.school_slug,
      is_active   = excluded.is_active,
      updated_at  = now();
```

Initial consent version rows (not a table — just a reminder that `current_consent_version(type)` returns `1` for all types at launch). Bumping a version is a code change (edit the SQL fn) plus a re-consent campaign.

---

## 9. Migrations strategy

**Recommendation: Supabase SQL migrations in `supabase/migrations/` as the source of truth. Drizzle is used for type generation only — not for applying schema.**

Reasoning:
1. We rely heavily on Postgres features Drizzle does not first-class: RLS policies, `SECURITY DEFINER` functions, storage policies, enums with explicit ordering, partial unique indexes with `WHERE` clauses, generated columns, triggers on `auth.users`. All of these are trivial in raw SQL and awkward-to-impossible in Drizzle migration DSL.
2. Supabase CLI (`supabase db push`, `supabase db diff`) understands its own managed schemas (`auth`, `storage`, `realtime`) and will not clobber them. Drizzle migrations do not know about `auth.users` triggers and would either ignore or fight them.
3. Preview environments: `supabase start` + `supabase db reset` applies everything deterministically including seed data.

**Workflow:**
```
supabase/migrations/
  20260421_000001_init.sql            -- extensions, enums
  20260421_000002_profiles.sql        -- profiles table + trigger
  20260421_000003_verification.sql    -- email_verification_codes + RPCs
  20260421_000004_resumes.sql         -- resumes + RLS + storage policies
  20260421_000005_consents.sql        -- consents + v_latest_consents
  20260421_000006_school_domains.sql  -- table + seed
  20260421_000007_audit.sql           -- audit_log + helpers
  20260421_000008_exports.sql         -- admin_export_recruiter_safe

drizzle/
  schema.ts                            -- drizzle-zod types mirrored from DB; generated, not authored
```

Drizzle's role:
- `drizzle-kit introspect` against a local Supabase to regenerate `schema.ts`.
- App code uses `drizzle-orm` at runtime for type-safe queries — but DDL is never authored in Drizzle.
- CI check: `supabase db reset && drizzle-kit introspect && git diff --exit-code drizzle/schema.ts` to catch drift.

Required Postgres extensions (first migration):
```sql
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;     -- gen_random_uuid, digest()
create extension if not exists citext;
```

---

## 10. Risks / open issues

1. **RLS + joins (profiles × consents).** Client-side joins from `profiles` to `consents` work because both tables allow the authenticated user to read their own rows. Admin joins work because `is_admin()` grants read on both. The risk: a future feature that shows "how many members accepted version 2 of the ToS?" must run through a `SECURITY DEFINER` aggregate view or service-role query — a direct count from the browser would leak nothing but is defensively denied by RLS. Keep all cross-user aggregates server-side.

2. **Consent versioning & migrations.** `current_consent_version()` is a hard-coded SQL function. When ToS version bumps to 2, a migration changes the function and *also* triggers a UX re-consent sweep (banner on next login). Stale v1 consents stay in the table (append-only). Query gating uses `version = current_consent_version(...)`. Open issue: the re-consent UX needs a design doc — this layer only enforces "latest accepted version must equal currently required version".

3. **Email change after verification.** If a user's student email is revoked or changes (graduated, ID number recycled), we need a flow to invalidate verification. Proposal: add `admin_revoke_verification()` that sets `student_email_verified = false` and logs to `audit_log`. Not in V0 scope but the plumbing (audit + RPC pattern) is ready.

4. **GDPR/FERPA deletion flow.** `ON DELETE CASCADE` on FKs to `profiles.id` cascades `resumes`, `consents`, `email_verification_codes`. However:
   - `audit_log.actor_user_id` and `target_user_id` are `ON DELETE SET NULL` — intentional; audit records must survive a user deletion to meet retention requirements, but personally identifying `user_id` is nulled.
   - Storage objects in `resumes` bucket are *not* cascaded by DB FK. Deletion flow must:
     a. Delete `auth.users` row (triggers cascade on `profiles`).
     b. Delete all `storage.objects` where `(storage.foldername(name))[1] = <user_id>` via service role.
     c. Insert `audit_log` row `user_deleted` with a redacted metadata payload (no email, only user_id for forensic correlation).
   - FERPA requires 5-year retention of certain student records; a "hard delete" vs "anonymize" decision is open. V0 assumption: hard delete on request; we document this in the privacy policy.

5. **Admin self-lockout.** A single `is_admin = true` row is seeded manually. If that row is misupdated (e.g., admin accidentally sets their own `is_admin = false`), the `is_admin()` helper returns false for everyone, and no one can toggle it back via RLS. Mitigation: the `profiles_update_own` policy's `with check` blocks self-demotion (the `is_admin = (select ... where id = auth.uid())` clause). Admin-on-admin toggles flow through a future RPC we have not built yet — in V0 we lift via direct SQL (service role) if needed.

6. **OTP salt rotation.** `app.otp_salt` is a cluster-level setting. Rotating it invalidates all in-flight codes (acceptable; TTL is 10 min). Store in a secret manager, propagate via `ALTER DATABASE ... SET app.otp_salt = '...'` in deploy.

7. **Signed URL leakage.** 5 min TTL on member and 15 min on admin is a compromise between UX and exposure. An admin who copies the URL and forwards it gives a 15-minute bearer token. Mitigation path (not V0): proxy all PDF serving through a Next.js route handler that re-checks `is_admin()` and streams from storage. V0 accepts the risk.

8. **Generated column `student_email_domain`.** `GENERATED ALWAYS AS STORED` means updating `student_email` automatically updates the domain — cheap for filtering. Risk: if we change the normalization rule (lowercase? strip aliases?), we need a migration to re-materialize. Acceptable.

9. **Resume orphan storage objects.** A client could, in theory, INSERT into `resumes` and then have its upload fail, leaving a row without an object (or vice versa). Server action pattern must (a) upload to storage first, (b) INSERT `resumes` row, (c) on failure, attempt to delete the storage object. A weekly reconciliation job should log orphans to `audit_log` with action `orphan_resume_detected`.

10. **`citext` + unique indexes.** `citext` unique indexes correctly treat `Foo@GSU.edu` and `foo@gsu.edu` as duplicates. But if a legacy row has mixed case, a future ingest of normalized lowercase values will collide. V0 ships with citext from day one — no legacy data — so this is only a concern for data imports.
