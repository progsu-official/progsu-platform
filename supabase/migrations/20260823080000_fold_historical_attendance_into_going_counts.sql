-- Root cause of "0 going" on legacy/imported events even after their
-- historical_event_attendances rows are fully backfilled: going_count on
-- every member/public-facing surface only ever counted live event_rsvps
-- (later widened to also fold in event_guest_rsvps, see the 2026-08-21
-- guest-RSVP migrations). historical_event_attendances (the pre-platform
-- Luma import) was only ever folded into the two ADMIN pages' going count,
-- computed ad hoc in JS (app/admin/events/page.tsx,
-- app/admin/events/[id]/page.tsx) — every member-facing view/RPC stayed
-- blind to it. Folding it in here, at the source, instead of teaching a
-- third caller to recompute it in JS.

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
  + (select count(*) from public.historical_event_attendances ha
      where ha.event_id = e.id and ha.approval_status ilike 'approved') as going_count,
  (select count(*) from public.event_rsvps r
    where r.event_id = e.id and r.status = 'waitlisted') as waitlisted_count
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
  'Member event discovery feed. Excludes draft/cancelled/archived (D6 — cancelled still viewable on direct detail via can_view_event). going_count includes approved historical_event_attendances (legacy Luma import) alongside live RSVPs — 2026-08-23 fix, see migration comment. SECURITY INVOKER so RLS on events applies.';

revoke all on public.member_visible_events from public;
grant  select on public.member_visible_events to authenticated, service_role;

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
    )
    + (select gc.going_count from public.event_guest_counts(e.id) gc)
    + (
      select count(*) from public.historical_event_attendances ha
      where ha.event_id = e.id and ha.approval_status ilike 'approved'
    ) as going_count,
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
    and e.status = 'published'
    and e.visibility = 'members';
$$;

comment on function public.public_event_by_slug(text) is
  'Anonymous-safe event detail projection. Published + members-visibility events only — see 2026-08-20 RSVP-first decision. going_count/waitlisted_count include guest RSVPs (2026-08-21 guest-RSVP decision) and approved historical_event_attendances (2026-08-23 legacy-import fix) since all three feed the same "going" number. Do not add columns here without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_event_by_slug(text) from public;
grant execute on function public.public_event_by_slug(text) to anon, authenticated, service_role;
