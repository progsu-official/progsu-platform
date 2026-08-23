-- Two real gaps in the Past tab, on top of the quality bar John asked for:
--
-- 1. Most real historical (pre-platform, Luma-era) events are status =
--    'archived', not 'published' — the original public_past_events() only
--    allowed 'published', so the majority of real past events (many with
--    real attendance) never showed up here at all, regardless of anything
--    else. Archived events are past by definition (no live seats to worry
--    about), so they're safe to include outright.
-- 2. Several archived imports have no cover_image_path (never had one in
--    the Luma export) and/or a small approved-attendance count — a showcase
--    feed of low-attendance, imageless events reads as dead, not "look what
--    progsu has run". Requiring both keeps the feed to events actually
--    worth showing a prospective member.
--
-- going_count logic (live + guest + historical fold) and newest-first
-- ordering are unchanged from 20260823110000; only the WHERE clause and the
-- attendee-count filter (needs a CTE since going_count is itself computed)
-- change.
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
  with candidates as (
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
    where e.status in ('published', 'archived')
      and e.visibility = 'members'
      and e.ends_at < now()
      and e.cover_image_path is not null
  )
  select id, slug, title, starts_at, ends_at, location_text, cover_image_path, going_count, hosts
  from candidates
  where going_count >= 10
  order by starts_at desc
  limit greatest(p_limit, 0);
$$;

comment on function public.public_past_events(int) is
  'Anonymous-safe past-events feed for the /events Past tab. Published or archived + members-visibility, newest first. Requires a cover image and going_count >= 10 (live + guest + historical fold) so the feed only shows events worth showcasing. Do not add columns without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_past_events(int) from public;
grant  execute on function public.public_past_events(int)
  to anon, authenticated, service_role;
