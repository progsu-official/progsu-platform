-- Migration 000002 — core tables: EVC, resumes (+ storage), consents (+ versions), audit_log,
-- account_deletion_requests. Follows canonical contract in docs/07-implementation-plan.md §1.1
-- and reconciliations #10 (consent version = text vN[.M]), #11 (bcrypt hash, app-layer), #28
-- (multi-row per (user,type,version) allowed, latest defined by accepted_at desc), #30
-- (account_deletion_requests table).

-- ============================================================================
-- consent_versions — lookup table for current version per consent type.
-- Seeded with v1 for all five types at launch. Bumping = insert a new row.
-- ============================================================================
create table public.consent_versions (
  consent_type public.consent_type_t primary key,
  version      text not null check (version ~ '^v[0-9]+(\.[0-9]+)?$'),
  updated_at   timestamptz not null default now()
);

comment on table public.consent_versions is
  'Current consent-doc version per type. Format vN or vN.M. Major bump forces re-consent.';

alter table public.consent_versions enable row level security;

create trigger consent_versions_set_updated_at
  before update on public.consent_versions
  for each row execute function public.set_updated_at();

insert into public.consent_versions (consent_type, version) values
  ('privacy_policy',           'v1'),
  ('terms_of_service',         'v1'),
  ('recruiter_resume_sharing', 'v1'),
  ('email_marketing',          'v1'),
  ('sms_marketing',            'v1')
on conflict (consent_type) do nothing;

create policy consent_versions_select_auth
  on public.consent_versions for select
  to authenticated
  using (true);

create policy consent_versions_write_admin
  on public.consent_versions for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================================
-- Table: email_verification_codes
-- Server-only OTP ledger. code_hash is bcrypt (reconciliation #11); DB stores opaque text.
-- ============================================================================
create table public.email_verification_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  email         citext not null,
  code_hash     text   not null,
  expires_at    timestamptz not null,
  attempts      int    not null default 0,
  max_attempts  int    not null default 5,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),

  constraint evc_email_has_at check (position('@' in email::text) > 0),
  constraint evc_attempts_range
    check (attempts >= 0 and attempts <= max_attempts + 1)
);

comment on table public.email_verification_codes is
  'OTP codes for student email verification. code_hash is bcrypt (app-layer). Server-only.';
comment on column public.email_verification_codes.code_hash is
  'bcrypt hash of the raw 6-digit code. Never store plaintext OTP.';

create index email_verification_codes_user_email_idx
  on public.email_verification_codes (user_id, email)
  where consumed_at is null;

create index email_verification_codes_expires_idx
  on public.email_verification_codes (expires_at)
  where consumed_at is null;

alter table public.email_verification_codes enable row level security;

-- Explicit deny for authenticated role. Service role bypasses RLS.
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

-- ============================================================================
-- Table: resumes
-- Canonical resume contract (07 §1.1): adds status + deleted_at for soft-delete.
-- ============================================================================
do $$ begin
  create type public.resume_status_t as enum ('pending', 'active', 'deleted');
exception when duplicate_object then null; end $$;

create table public.resumes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null check (length(file_name) between 1 and 255),
  file_size     bigint not null check (file_size > 0 and file_size <= 10 * 1024 * 1024),
  mime_type     text   not null check (mime_type = 'application/pdf'),
  status        public.resume_status_t not null default 'pending',
  is_current    boolean not null default false,
  uploaded_at   timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint resumes_storage_path_unique unique (storage_path),
  constraint resumes_current_requires_active
    check (not is_current or status = 'active'),
  constraint resumes_deleted_not_current
    check (deleted_at is null or not is_current)
);

comment on table public.resumes is
  'PDF resumes. Lifecycle: pending (row created, awaiting PUT finalize) -> active -> deleted.';

-- Exactly zero or one current resume per user.
create unique index resumes_one_current_per_user
  on public.resumes (user_id)
  where is_current;

create index resumes_user_uploaded_idx
  on public.resumes (user_id, uploaded_at desc);

create index resumes_user_status_idx
  on public.resumes (user_id, status);

alter table public.resumes enable row level security;

create policy resumes_select_own
  on public.resumes for select
  to authenticated
  using (auth.uid() = user_id);

-- is_current must be false on direct insert; set_current_resume() flips it later.
create policy resumes_insert_own
  on public.resumes for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and is_current = false
    and status = 'pending'
    and mime_type = 'application/pdf'
    and file_size <= 10 * 1024 * 1024
  );

create policy resumes_select_admin
  on public.resumes for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- No direct UPDATE by clients. Status transitions / is_current flips go through
-- SECURITY DEFINER functions added in a later migration.
create policy resumes_no_update_client
  on public.resumes for update
  to authenticated
  using (false) with check (false);

-- Non-current row cleanup is allowed (history pruning); current row cannot be deleted directly.
create policy resumes_delete_own_noncurrent
  on public.resumes for delete
  to authenticated
  using (auth.uid() = user_id and is_current = false);

-- ============================================================================
-- Table: consents
-- Append-only. version is TEXT vN[.M] (reconciliation #10).
-- Multi-row per (user, consent_type, version) allowed (reconciliation #28); latest =
-- accepted_at desc, id desc so toggle/withdraw flows are possible.
-- ============================================================================
create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  consent_type  public.consent_type_t not null,
  accepted      boolean not null,
  version       text not null check (version ~ '^v[0-9]+(\.[0-9]+)?$'),
  accepted_at   timestamptz not null default now(),
  ip_address    inet,
  user_agent    text
);

comment on table public.consents is
  'Append-only consent ledger. Multi-row per (user, consent_type, version) is allowed; latest = accepted_at desc.';

create index consents_user_type_version_idx
  on public.consents (user_id, consent_type, accepted_at desc, id desc);

create index consents_type_accepted_idx
  on public.consents (consent_type, accepted)
  where accepted;

alter table public.consents enable row level security;

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

-- ============================================================================
-- Table: audit_log
-- Append-only admin-visible log. Writes only via SECURITY DEFINER functions (later migration).
-- ============================================================================
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references public.profiles(id) on delete set null,
  target_user_id  uuid references public.profiles(id) on delete set null,
  action          text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only audit log. Writes via SECURITY DEFINER. Admin read-only.';

create index audit_log_actor_idx    on public.audit_log (actor_user_id, created_at desc);
create index audit_log_target_idx   on public.audit_log (target_user_id, created_at desc);
create index audit_log_action_idx   on public.audit_log (action, created_at desc);
create index audit_log_metadata_gin on public.audit_log using gin (metadata);

alter table public.audit_log enable row level security;

create policy audit_log_select_admin
  on public.audit_log for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy audit_log_no_client_write
  on public.audit_log for all
  to authenticated
  using (false) with check (false);

-- ============================================================================
-- Table: account_deletion_requests (reconciliation #30)
-- User-initiated deletion is flagged + manually processed within 30 days.
-- ============================================================================
do $$ begin
  create type public.deletion_request_status_t as enum ('pending', 'processing', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

create table public.account_deletion_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  reason          text check (reason is null or length(reason) <= 2000),
  status          public.deletion_request_status_t not null default 'pending',
  requested_at    timestamptz not null default now(),
  processed_at    timestamptz,
  processed_by    uuid references public.profiles(id) on delete set null
);

comment on table public.account_deletion_requests is
  'User deletion requests. Manual review + hard delete within 30 days; consent rows retained and redacted.';

create index account_deletion_requests_status_idx
  on public.account_deletion_requests (status, requested_at desc);

create unique index account_deletion_requests_one_pending_per_user
  on public.account_deletion_requests (user_id)
  where status in ('pending', 'processing');

alter table public.account_deletion_requests enable row level security;

create policy account_deletion_select_own
  on public.account_deletion_requests for select
  to authenticated
  using (auth.uid() = user_id);

create policy account_deletion_insert_own
  on public.account_deletion_requests for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending');

create policy account_deletion_select_admin
  on public.account_deletion_requests for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy account_deletion_update_admin
  on public.account_deletion_requests for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy account_deletion_no_client_delete
  on public.account_deletion_requests for delete
  to authenticated
  using (false);

-- ============================================================================
-- Storage: 'resumes' bucket + policies (private, PDF only, 10 MB cap)
-- Path convention: {user_id}/{resume_id}.pdf
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10 * 1024 * 1024,
  array['application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owners can insert objects under their own prefix.
drop policy if exists resumes_storage_insert_own on storage.objects;
create policy resumes_storage_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists resumes_storage_select_own on storage.objects;
create policy resumes_storage_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists resumes_storage_update_own on storage.objects;
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

drop policy if exists resumes_storage_delete_own on storage.objects;
create policy resumes_storage_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists resumes_storage_select_admin on storage.objects;
create policy resumes_storage_select_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and public.is_admin(auth.uid())
  );
