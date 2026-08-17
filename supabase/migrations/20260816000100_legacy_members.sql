-- Migration: legacy_members staging table for pre-launch member data migration.
-- No FK to auth.users on purpose: these people haven't signed in yet, so no
-- auth.users row exists for them. profiles.id *requires* a matching
-- auth.users row (see 20260421070000_init.sql), so this data can't live in
-- profiles until each person's first Google sign-in creates that row.
-- Claim flow: on first login, match google_email against personal_email or
-- campus_email here, copy matched fields into the fresh profiles row, set
-- claimed_at. Consent columns in profiles are never defaulted true from this
-- table, each person opts in explicitly at claim time.

create table public.legacy_members (
  id              uuid primary key default gen_random_uuid(),

  full_name       text,
  first_name      text,
  last_name       text,
  personal_email  citext,
  campus_email    citext,
  phone_number    text,

  -- Historical signal only, not consent. Real consent is captured fresh at
  -- claim time; this just tells us who to prioritize checking with.
  sms_interest    boolean,

  source          text not null,   -- e.g. 'luma_export', 'master_sheet_membership'
  source_detail   text,            -- e.g. event name or sheet tab name

  imported_at     timestamptz not null default now(),
  claimed_at      timestamptz,
  claimed_profile_id uuid references public.profiles(id),

  constraint legacy_members_has_email
    check (personal_email is not null or campus_email is not null)
);

comment on table public.legacy_members is
  'Pre-signup staging data ported from Luma/Sheets/Tally. Matched to profiles by email at first Google login, never inserted directly.';

create unique index legacy_members_personal_email_idx
  on public.legacy_members (personal_email)
  where personal_email is not null;

create unique index legacy_members_campus_email_idx
  on public.legacy_members (campus_email)
  where campus_email is not null;

create index legacy_members_unclaimed_idx
  on public.legacy_members (claimed_at)
  where claimed_at is null;

alter table public.legacy_members enable row level security;

-- Admin-only. This table holds pre-consent PII; no member-facing access.
create policy legacy_members_admin_all
  on public.legacy_members
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
