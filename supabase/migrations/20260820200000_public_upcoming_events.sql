-- Public (anonymous) events discovery feed, extending the 2026-08-20
-- RSVP-first decision from "one event page is public" to "anonymous visitors
-- can browse what's coming up at all" (the /events list's Upcoming tab).
--
-- Same posture as public_event_by_slug() in 20260820180000: base `events`
-- RLS stays authenticated-only, `member_visible_events` stays
-- authenticated/service_role-only. This is a narrow SECURITY DEFINER
-- projection mirroring member_visible_events' own filter (published +
-- members-visibility only — private_invite is correctly excluded outright,
-- since an anonymous caller can never be on an invite list) with only the
-- columns the Upcoming tab actually renders.

create or replace function public.public_upcoming_events(p_limit int default 50)
returns table (
  id                uuid,
  slug              text,
  title             text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  location_text     text,
  cover_image_path  text,
  capacity          int,
  waitlist_enabled  boolean,
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
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.cover_image_path,
    e.capacity,
    e.waitlist_enabled,
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
  where e.status = 'published'
    and e.visibility = 'members'
    and e.ends_at >= now()
  order by e.starts_at asc
  limit greatest(p_limit, 0);
$$;

comment on function public.public_upcoming_events(int) is
  'Anonymous-safe upcoming-events discovery feed. Published + members-visibility only — see 2026-08-20 RSVP-first decision. Do not add columns without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_upcoming_events(int) from public;
grant execute on function public.public_upcoming_events(int) to anon, authenticated, service_role;
