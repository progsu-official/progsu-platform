-- Root cause of "detail page says 4 going, list page says 2 going" for the
-- same event: the 2026-08-21 guest-RSVP migration (20260821010000) only
-- updated public_event_by_slug() to fold event_guest_rsvps into
-- going_count/waitlisted_count (capacity is one shared pool across members
-- + guests). public_upcoming_events() (anon /events list) and
-- member_visible_events (signed-in /events list) were never updated, so
-- every list surface undercounts by exactly the number of guest RSVPs on an
-- event. Same fix as public_event_by_slug(): fold in event_guest_counts().

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
  where e.status = 'published'
    and e.visibility = 'members'
    and e.ends_at >= now()
  order by e.starts_at asc
  limit greatest(p_limit, 0);
$$;

comment on function public.public_upcoming_events(int) is
  'Anonymous-safe upcoming-events discovery feed. Published + members-visibility only — see 2026-08-20 RSVP-first decision. going_count/waitlisted_count include guest RSVPs (2026-08-21 guest-RSVP decision) since capacity is one shared pool. Do not add columns without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_upcoming_events(int) from public;
grant execute on function public.public_upcoming_events(int) to anon, authenticated, service_role;

-- member_visible_events (signed-in /events list) — same fix, same reasoning.
-- Only going_count/waitlisted_count change; every other column and the WHERE
-- clause are unchanged from 20260423000400.
create or replace view public.member_visible_events as
select
  e.id,
  e.slug,
  e.title,
  e.description_md,
  e.status,
  e.visibility,
  e.starts_at,
  e.ends_at,
  e.location_text,
  e.location_url,
  e.capacity,
  e.waitlist_enabled,
  e.cover_image_path,
  e.is_sensitive,
  e.cancelled_at,
  e.cancellation_reason,
  coalesce(
    (select jsonb_agg(
       jsonb_build_object('display_name', h.display_name, 'sort_order', h.sort_order)
       order by h.sort_order, h.display_name
     )
     from public.event_hosts h
     where h.event_id = e.id),
    '[]'::jsonb
  ) as hosts,
  (select count(*) from public.event_rsvps r
    where r.event_id = e.id and r.status = 'going')
    + (select gc.going_count from public.event_guest_counts(e.id) gc) as going_count,
  (select count(*) from public.event_rsvps r
    where r.event_id = e.id and r.status = 'waitlisted')
    + (select gc.waitlisted_count from public.event_guest_counts(e.id) gc) as waitlisted_count
from public.events e
where e.status = 'published'
  and (
    e.visibility = 'members'
    or (
      e.visibility = 'private_invite'
      and exists (
        select 1 from public.event_invites ei
        where ei.event_id  = e.id
          and ei.user_id   = auth.uid()
          and ei.revoked_at is null
      )
    )
  );

comment on view public.member_visible_events is
  'Member event discovery feed. Excludes draft/cancelled/archived (D6 — cancelled still viewable on direct detail via can_view_event). SECURITY INVOKER so RLS on events applies. going_count/waitlisted_count include guest RSVPs (2026-08-21 guest-RSVP decision) since capacity is one shared pool.';

revoke all on public.member_visible_events from public;
grant  select on public.member_visible_events to authenticated, service_role;
