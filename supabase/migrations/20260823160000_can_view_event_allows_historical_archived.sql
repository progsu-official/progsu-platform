-- Real bug surfaced by the Past tab quality filter (20260823140000): that
-- feed now lists archived historical (Luma-era) events as clickable links,
-- but can_view_event() unconditionally denies 'archived' status to anyone
-- but an admin. Every archived event in the feed 404s for a regular member
-- or anonymous visitor clicking through — same root function also gates the
-- event-covers storage policies, so cover images for those events silently
-- fail to sign for non-admins too (confirmed: a member's own historical
-- attendance card showed the event title but no image).
--
-- Precise fix, not a blanket one: archive_event() is also the normal
-- cancelled -> archived cleanup path for regular live-platform events (see
-- smoke-event-crud.ts), and those should stay hidden from members exactly
-- as before. Only archived events with import_source = 'legacy_luma_import'
-- (the real historical showcase imports) become visible — gated on the
-- column that already exists specifically to distinguish them
-- (20260821020000_historical_events_schema.sql), not on status alone.
--
-- Mirrors this same distinction into public_event_by_slug() (anon detail
-- read) so the event detail page itself, not just the list and the cover
-- image, is reachable for these events by anyone.

create or replace function public.can_view_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select id, status, visibility, import_source
    from public.events
    where id = p_event_id
  ),
  invited as (
    select exists (
      select 1 from public.event_invites ei
      where ei.event_id = p_event_id
        and ei.user_id  = p_user_id
        and ei.revoked_at is null
    ) as ok
  ),
  rsvp_or_attend as (
    select
      (
        exists (
          select 1 from public.event_rsvps r
          where r.event_id = p_event_id
            and r.user_id  = p_user_id
            and r.status in ('going', 'waitlisted')
        )
        or exists (
          select 1 from public.event_attendances a
          where a.event_id = p_event_id
            and a.user_id  = p_user_id
        )
      ) as ok
  )
  select
    case
      when public.is_admin(p_user_id) then true
      when (select id from e) is null then false
      when (select status from e) = 'draft' then false
      when (select status from e) = 'archived'
        and coalesce((select import_source from e), '') <> 'legacy_luma_import'
        then false
      when (select status from e) = 'cancelled' then (select ok from rsvp_or_attend)
      when (select visibility from e) = 'members' then true
      when (select visibility from e) = 'private_invite' then (select ok from invited)
      else false
    end;
$$;

comment on function public.can_view_event(uuid, uuid) is
  'Event visibility check. Draft and cancelled (without rsvp/attendance) stay hidden from non-admins. Archived stays hidden UNLESS import_source = legacy_luma_import (2026-08-23 fix) — a real historical showcase event, not an admin-cleanup archive.';

-- public_event_by_slug(): same distinction, so the detail page itself is
-- reachable (previously only status = published). Body otherwise unchanged
-- from 20260821010000 (guest-count fold).
create or replace function public.public_event_by_slug(p_slug text)
returns table (
  id                uuid,
  slug              text,
  title             text,
  description_md    text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  location_text     text,
  location_url      text,
  capacity          int,
  waitlist_enabled  boolean,
  cover_image_path  text,
  going_count       bigint,
  waitlisted_count  bigint,
  hosts             jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.slug,
    e.title,
    e.description_md,
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.location_url,
    e.capacity,
    e.waitlist_enabled,
    e.cover_image_path,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'going'
    ) + (select gc.going_count from public.event_guest_counts(e.id) gc) as going_count,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'waitlisted'
    ) + (select gc.waitlisted_count from public.event_guest_counts(e.id) gc) as waitlisted_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('display_name', h.display_name, 'sort_order', h.sort_order)
          order by h.sort_order
        )
        from public.event_hosts h
        where h.event_id = e.id
      ),
      '[]'::jsonb
    ) as hosts
  from public.events e
  where e.slug = p_slug
    and (
      e.status = 'published'
      or (e.status = 'archived' and e.import_source = 'legacy_luma_import')
    )
    and e.visibility = 'members';
$$;

comment on function public.public_event_by_slug(text) is
  'Anonymous-safe event detail projection. Published, or archived legacy-import historical events (2026-08-23 fix), + members-visibility only. going_count/waitlisted_count include guest RSVPs. Do not add columns here without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_event_by_slug(text) from public;
grant execute on function public.public_event_by_slug(text) to anon, authenticated, service_role;
