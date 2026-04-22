-- Migration 000008 — support "verify later" for any email + track requested schools.
--
-- Product change: a user can type ANY email during onboarding. If the domain is in
-- public.school_domains we treat it as a claim (must still verify via OTP before
-- it counts for recruiter eligibility). If the domain is NOT in the allowlist, we
-- still record the email on the profile so the user doesn't lose what they typed,
-- and we log the domain in domain_requests so admins can see which schools to add
-- next.
--
-- Changes:
-- 1. Relax profiles_student_email_idx to enforce uniqueness only among verified
--    users. Unverified claims can coexist until one user actually verifies.
-- 2. Add profiles.pending_domain_name for UI hints ("your school is coming soon").
-- 3. New public.domain_requests table (append-only, admin-readable).

-- 1. Relax uniqueness.
drop index if exists public.profiles_student_email_idx;
create unique index profiles_student_email_verified_idx
  on public.profiles (student_email)
  where student_email is not null and student_email_verified = true;

-- 2. Nullable column for "we don't support your school yet" UI state. Null when
--    the domain IS in the allowlist (or no email set).
alter table public.profiles
  add column if not exists pending_domain_name text;

comment on column public.profiles.pending_domain_name is
  'Set when a user reserves an email whose domain is not in school_domains. UI uses this to show a "coming soon" state. Cleared when a domain is added to the allowlist or the user switches to an allowlisted email.';

-- 3. domain_requests: one row per (domain, user_id) so we can see requester count.
create table public.domain_requests (
  id            uuid primary key default gen_random_uuid(),
  domain        citext not null,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  example_email citext,
  requested_at  timestamptz not null default now(),
  constraint domain_requests_unique_per_user unique (domain, user_id)
);

comment on table public.domain_requests is
  'One row per (user, requested-but-not-yet-supported domain). Admins use this to prioritize which schools to add to school_domains next.';

create index domain_requests_domain_idx
  on public.domain_requests (domain, requested_at desc);

alter table public.domain_requests enable row level security;

-- Users can see their own requests; admins can see all; client writes go through
-- the reserveStudentEmail server action which inserts under the user's auth.
create policy domain_requests_select_own
  on public.domain_requests for select
  to authenticated
  using (auth.uid() = user_id);

create policy domain_requests_select_admin
  on public.domain_requests for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy domain_requests_insert_own
  on public.domain_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Append-only: no updates or deletes from clients.
create policy domain_requests_no_update
  on public.domain_requests for update
  to authenticated
  using (false) with check (false);

create policy domain_requests_no_delete
  on public.domain_requests for delete
  to authenticated
  using (false);

-- Helper: when a domain is added to school_domains later, clear the
-- pending_domain_name on every profile that was waiting for it. Not called
-- automatically yet — admin settings page can invoke when adding a new domain.
create or replace function public.clear_pending_domain(p_domain citext)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin(auth.uid()) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'clear_pending_domain: admin only' using errcode = 'P0001';
  end if;
  with updated as (
    update public.profiles
       set pending_domain_name = null
     where pending_domain_name is not null
       and lower(pending_domain_name) = lower(p_domain::text)
    returning 1
  )
  select count(*)::int into v_count from updated;
  return v_count;
end;
$$;

revoke all on function public.clear_pending_domain(citext) from public;
grant execute on function public.clear_pending_domain(citext)
  to authenticated, service_role;
