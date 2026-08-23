-- Correction: migration 20260823080000 (this branch) redefined
-- member_visible_events from its ORIGINAL (2026-04-23) base to fold in
-- historical_event_attendances, without knowing that
-- 20260823010000_event_lists_include_guest_counts.sql (a concurrent branch,
-- already applied to this same production database) had already redefined
-- the same view to fold in event_guest_counts(). Since both migrations do
-- `create or replace view`, whichever ran last wins outright — 20260823080000
-- ran after 20260823010000, so it silently reverted the guest-RSVP fold.
-- This re-applies the view with BOTH folds present: live event_rsvps,
-- event_guest_counts() (guest RSVPs), and approved historical_event_attendances
-- (legacy Luma import) all feed into one going_count/waitlisted_count.
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
    + (select gc.going_count from public.event_guest_counts(e.id) gc)
    + (select count(*) from public.historical_event_attendances ha
        where ha.event_id = e.id and ha.approval_status ilike 'approved') as going_count,
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
  'Member event discovery feed. Excludes draft/cancelled/archived (D6 — cancelled still viewable on direct detail via can_view_event). going_count/waitlisted_count fold in event_guest_counts() (2026-08-23 guest-RSVP fix) and approved historical_event_attendances (2026-08-23 legacy-import fix) alongside live RSVPs. SECURITY INVOKER so RLS on events applies.';

revoke all on public.member_visible_events from public;
grant  select on public.member_visible_events to authenticated, service_role;
