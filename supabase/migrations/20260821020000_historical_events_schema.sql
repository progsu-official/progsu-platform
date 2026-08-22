-- Historical (pre-platform) event backfill — schema.
--
-- progsu ran events on Luma long before this platform existed. That data
-- lives in a Google Sheet ("Combined Attendance") we're importing so the
-- admin views show real numbers for past events instead of zero. Two things
-- keep this from being a plain insert:
--
-- 1. Identity must not duplicate legacy_members. The sheet is raw
--    (person, event) pairs; the same person can show up across many event
--    guest lists, and some are already in legacy_members from the master
--    membership sheet. Attendee identity stays in legacy_members, never
--    re-stored here.
-- 2. Historical attendees have no profiles row (they never signed into the
--    platform), but event_attendances.user_id is not null references
--    profiles(id), and admin_event_roster_for inner-joins profiles — so
--    historical people can't go in the live attendance tables at all. This
--    is a separate junction table keyed to legacy_members instead.
--
-- import_source on events is a nullable discriminator: every existing row
-- and every live-created event stays null, so this is a zero-behavior-change
-- addition for anything that isn't a historical import.

alter table public.events
  add column import_source text
  check (import_source is null or import_source in ('legacy_luma_import'));

comment on column public.events.import_source is
  'Null for live/platform-created events. Set for events backfilled from pre-platform data sources (see historical_event_attendances).';

-- ----------------------------------------------------------------------------
-- Table: historical_event_attendances
-- One row per (historical event, legacy_members identity). Mirrors what
-- event_rsvps + event_attendances together capture for live events, but the
-- old Luma export never separated "registered" from "checked in" the way the
-- platform now does — approval_status and checked_in_at come straight from
-- that export.
-- ----------------------------------------------------------------------------
create table public.historical_event_attendances (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  legacy_member_id  uuid not null references public.legacy_members(id) on delete cascade,
  registered_at     timestamptz,
  approval_status   text,
  checked_in_at     timestamptz,
  ticket_name       text,
  source_detail     text,
  created_at        timestamptz not null default now(),

  constraint historical_event_attendances_unique unique (event_id, legacy_member_id)
);

comment on table public.historical_event_attendances is
  'Historical attendance for pre-platform (Luma-era) events, keyed to legacy_members since these attendees never signed into the platform. Read by admin_event_analytics_for / admin_cross_event_analytics / admin_event_roster_for alongside the live event_rsvps/event_attendances tables.';

create index historical_event_attendances_event_idx
  on public.historical_event_attendances (event_id);

alter table public.historical_event_attendances enable row level security;

-- Admin-only, same pattern as legacy_members_admin_all.
create policy historical_event_attendances_admin_all
  on public.historical_event_attendances
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
