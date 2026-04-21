-- Migration 000001 — init: extensions, enums, profiles, school_domains, is_admin helper, RLS.
-- Source of truth: docs/02-data-security.md (design) + docs/07-implementation-plan.md §1.1 (canonical contract).

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists pgcrypto;     -- gen_random_uuid()
create extension if not exists citext;        -- case-insensitive email storage
create extension if not exists pg_trgm;       -- trigram indexes for name/email search

-- ============================================================================
-- Enums
-- ============================================================================

-- Consent categories. Never collapse. Additive changes only.
do $$ begin
  create type public.consent_type_t as enum (
    'privacy_policy',
    'terms_of_service',
    'recruiter_resume_sharing',
    'email_marketing',
    'sms_marketing'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.class_standing_t as enum (
    'freshman',
    'sophomore',
    'junior',
    'senior',
    'graduate',
    'phd',
    'alumni'
  );
exception when duplicate_object then null; end $$;

do $$ begin
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
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_method_t as enum (
    'email_otp',
    'admin_manual'
  );
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Shared helpers
-- ============================================================================

-- updated_at trigger fn. Used by multiple tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Table: school_domains
-- Configurable allowlist of student email domains. Admin-editable; authenticated read.
-- ============================================================================
create table public.school_domains (
  domain       citext primary key,
  school_name  text not null,
  school_slug  text not null unique
               check (school_slug ~ '^[a-z0-9\-]+$'),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.school_domains is
  'Allowlist for student email verification. Admin-only writes; authenticated read.';

create index school_domains_active_idx
  on public.school_domains (is_active)
  where is_active;

create trigger school_domains_set_updated_at
  before update on public.school_domains
  for each row execute function public.set_updated_at();

alter table public.school_domains enable row level security;

-- ============================================================================
-- Table: profiles
-- 1:1 with auth.users. Merged login identity + student verification + member profile.
-- Column names follow the canonical contract in 07 §1.1 (first_name/last_name/grad_year/...)
-- rather than the earlier 02 draft (full_name/graduation_year/...).
-- ============================================================================
create table public.profiles (
  id                         uuid primary key references auth.users(id) on delete cascade,

  -- Google OAuth identity (denormalized from auth.users for convenience)
  google_email               citext not null,
  first_name                 text,
  last_name                  text,
  preferred_name             text,
  avatar_url                 text,

  -- Student verification (separate from auth identity)
  student_email              citext,
  student_email_domain       citext generated always as (
    case
      when student_email is null then null
      else split_part(student_email::text, '@', 2)::citext
    end
  ) stored,
  student_email_verified     boolean not null default false,
  student_email_verified_at  timestamptz,
  verification_method        public.verification_method_t,

  -- Member profile fields (canonical V0 allow-list)
  school                     text,
  major                      text,
  minor                      text,
  class_standing             public.class_standing_t,
  grad_year                  int check (
    grad_year is null or (grad_year between 2000 and 2100)
  ),
  grad_term                  text check (
    grad_term is null or grad_term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'
  ),
  interested_roles           public.interested_role_t[] not null default '{}'::public.interested_role_t[],
  linkedin_url               text check (
    linkedin_url is null or linkedin_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/'
  ),
  github_url                 text check (
    github_url is null or github_url ~* '^https?://([a-z0-9-]+\.)*github\.com/'
  ),
  portfolio_url              text check (
    portfolio_url is null or portfolio_url ~* '^https?://'
  ),
  phone_number               text check (
    phone_number is null or phone_number ~ '^\+?[0-9\-\(\) ]{7,20}$'
  ),

  -- Flags
  is_admin                   boolean not null default false,
  profile_completed          boolean not null default false,
  open_to_recruiters         boolean not null default false,

  -- Archive (decision D5 — post-grad auto-archive 12 months after grad_year)
  is_archived                boolean not null default false,
  archived_at                timestamptz,

  -- Timestamps
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint profiles_interested_roles_max_six
    check (cardinality(interested_roles) <= 6)
);

comment on table  public.profiles is
  '1:1 with auth.users. Created by handle_new_user() trigger. Canonical schema per 07 §1.1.';
comment on column public.profiles.is_admin is
  'Seed manually via SQL. Drives public.is_admin(auth.uid()) helper.';
comment on column public.profiles.is_archived is
  'Set true by the post-grad auto-archive job (D5). User can un-archive by logging in.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- ----------------------------------------------------------------------------
-- Indexes (profiles)
-- ----------------------------------------------------------------------------
create unique index profiles_google_email_idx
  on public.profiles (google_email);

create unique index profiles_student_email_idx
  on public.profiles (student_email)
  where student_email is not null;

create index profiles_is_admin_idx
  on public.profiles (is_admin)
  where is_admin;

create index profiles_recruiter_export_idx
  on public.profiles (student_email_verified, open_to_recruiters)
  where student_email_verified and open_to_recruiters and not is_archived;

create index profiles_student_domain_idx
  on public.profiles (student_email_domain);

create index profiles_grad_year_idx
  on public.profiles (grad_year);

create index profiles_class_standing_idx
  on public.profiles (class_standing);

create index profiles_interested_roles_gin
  on public.profiles using gin (interested_roles);

-- Trigram indexes for case-insensitive ILIKE search on name + student email.
create index profiles_first_name_trgm
  on public.profiles using gin (first_name gin_trgm_ops);

create index profiles_last_name_trgm
  on public.profiles using gin (last_name gin_trgm_ops);

create index profiles_student_email_trgm
  on public.profiles using gin ((student_email::text) gin_trgm_ops);

create index profiles_archived_idx
  on public.profiles (is_archived, archived_at);

-- ============================================================================
-- is_admin(uuid) helper
-- Stable + SECURITY DEFINER so RLS policies can consult profiles.is_admin
-- without forcing each policy to grant SELECT on the row.
-- ============================================================================
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

-- ============================================================================
-- handle_new_user() — trigger on auth.users insert
-- Creates the matching profiles row with google_email + best-effort first/last split.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );
  v_first_name text := new.raw_user_meta_data ->> 'given_name';
  v_last_name  text := new.raw_user_meta_data ->> 'family_name';
begin
  -- Fall back to splitting full_name on the first space if given/family missing.
  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name, ' ', 1);
  end if;
  if v_last_name is null and v_full_name is not null and position(' ' in v_full_name) > 0 then
    v_last_name := substr(v_full_name, position(' ' in v_full_name) + 1);
  end if;

  insert into public.profiles (id, google_email, first_name, last_name, avatar_url)
  values (
    new.id,
    lower(new.email)::citext,
    v_first_name,
    v_last_name,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RLS policies
-- ============================================================================

-- -------- profiles --------
-- Read own row
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Update own row: cannot elevate is_admin, cannot flip verification flags, cannot self-archive.
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
    and student_email_verified = (
      select p.student_email_verified from public.profiles p where p.id = auth.uid()
    )
    and student_email_verified_at is not distinct from (
      select p.student_email_verified_at from public.profiles p where p.id = auth.uid()
    )
    and verification_method is not distinct from (
      select p.verification_method from public.profiles p where p.id = auth.uid()
    )
    and is_archived = (
      select p.is_archived from public.profiles p where p.id = auth.uid()
    )
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

-- No client INSERT/DELETE. Rows are created exclusively by handle_new_user() trigger
-- and deleted by auth.users cascade.

-- -------- school_domains --------
create policy school_domains_select_auth
  on public.school_domains for select
  to authenticated
  using (true);

create policy school_domains_write_admin
  on public.school_domains for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================================
-- Seed: initial 6 school domains (docs/02-data-security.md §8)
-- ============================================================================
insert into public.school_domains (domain, school_name, school_slug, is_active) values
  ('student.gsu.edu', 'Georgia State University',              'gsu',       true),
  ('gsu.edu',         'Georgia State University (staff)',       'gsu-staff', true),
  ('gatech.edu',      'Georgia Institute of Technology',        'gatech',    true),
  ('emory.edu',       'Emory University',                       'emory',     true),
  ('kennesaw.edu',    'Kennesaw State University',              'ksu',       true),
  ('gcsu.edu',        'Georgia College & State University',     'gcsu',      true)
on conflict (domain) do update
  set school_name = excluded.school_name,
      school_slug = excluded.school_slug,
      is_active   = excluded.is_active,
      updated_at  = now();
