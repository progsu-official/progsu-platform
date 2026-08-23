-- Public (anonymous) past-events feed.
--
-- The /events Past tab has always read self_event_history, which joins on
-- auth.uid() and keeps only rows where the viewer personally has an RSVP or a
-- check-in. That is "events I went to", not "events progsu ran" — so
-- publishing the six backfilled Luma-era events in 20260823 made them
-- reachable by direct URL and listed them nowhere. With three live RSVPs and
-- no attendance rows on the platform, every member's Past tab is empty and
-- the 417-person kickoff is invisible.
--
-- This is the past-tense twin of public_upcoming_events (20260820200000) and
-- keeps the same posture: base `events` RLS stays authenticated-only and this
-- is a narrow SECURITY DEFINER projection over published + members-visibility
-- rows only. private_invite is excluded outright — an anonymous caller can
-- never be on an invite list, and a past private event should not become
-- discoverable just because it ended.
--
-- going_count folds live RSVPs, guest RSVPs, and approved historical
-- attendance, matching event_attendee_faces() and public_event_by_slug()
-- (20260823100000). On a backfilled event the historical term is the entire
-- count, which is the number worth showing.

create or replace function public.public_past_events(p_limit int default 50)
returns table (
  id                uuid,
  slug              text,
  title             text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  location_text     text,
  cover_image_path  text,
  going_count       bigint,
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
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.cover_image_path,
    (
      (select count(*) from public.event_rsvps r
        where r.event_id = e.id and r.status = 'going')
    + (select count(*) from public.event_guest_rsvps g
        where g.event_id = e.id and g.status = 'going')
    + (select count(*) from public.historical_event_attendances h
        where h.event_id = e.id and lower(h.approval_status) = 'approved')
    ) as going_count,
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
  where e.status = 'published'
    and e.visibility = 'members'
    and e.ends_at < now()
  order by e.starts_at desc
  limit greatest(p_limit, 0);
$$;

comment on function public.public_past_events(int) is
  'Anonymous-safe past-events feed for the /events Past tab. Published + members-visibility only, newest first. going_count folds live + guest + historical attendance. Do not add columns without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_past_events(int) from public;
grant  execute on function public.public_past_events(int)
  to anon, authenticated, service_role;
