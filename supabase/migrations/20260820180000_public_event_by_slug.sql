-- Public (anonymous) event detail read, per the 2026-08-20 Joey/John Slack
-- decision: an event's page should be viewable with no session; only RSVPing
-- requires a Google-authenticated user (enforced in rsvp_to_event(), unchanged).
--
-- Base `events`/`event_hosts` RLS stays authenticated-only (see
-- 20260423000100_events_core.sql's events_select_member/event_hosts_select_member
-- policies) — deliberately not widened to `anon`. Instead this is a narrow,
-- SECURITY DEFINER projection: only published + members-visibility events, only
-- the columns a public visitor should ever see. A future column added to
-- `events` does not become anon-readable by accident. Mirrors this repo's
-- existing pattern for RLS-crossing reads (my_waitlist_position(),
-- admin_event_roster_for()).
--
-- Cancelled/draft/archived/private_invite events are excluded outright — an
-- anonymous caller can never satisfy can_view_event()'s rsvp/attendance/invite
-- branches, so there is no case where those should be publicly visible.

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
    ) as going_count,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'waitlisted'
    ) as waitlisted_count,
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
    and e.status = 'published'
    and e.visibility = 'members';
$$;

comment on function public.public_event_by_slug(text) is
  'Anonymous-safe event detail projection. Published + members-visibility events only — see 2026-08-20 RSVP-first decision. Do not add columns here without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_event_by_slug(text) from public;
grant execute on function public.public_event_by_slug(text) to anon, authenticated, service_role;
