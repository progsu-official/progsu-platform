-- Migration 000800 — extend self_event_history with cover_image_path so
-- member-facing surfaces (dashboard upcoming card, /events lists) can render
-- thumbnails without a second events query. Cover image paths are already
-- member-visible via can_view_event; exposing them on the member's own
-- history view is no new disclosure.
--
-- member_visible_events already exposes cover_image_path per migration 4.

create or replace view public.self_event_history as
select
  e.id                as event_id,
  e.slug,
  e.title,
  e.starts_at,
  e.ends_at,
  e.status,
  e.visibility,
  e.location_text,
  r.status            as rsvp_status,
  r.status_changed_at as rsvp_changed_at,
  r.waitlisted_at,
  a.checked_in_at,
  a.method            as attendance_method,
  (a.checked_in_at is not null) as attended,
  e.cover_image_path
from public.events e
left join public.event_rsvps r
  on r.event_id = e.id and r.user_id = auth.uid()
left join public.event_attendances a
  on a.event_id = e.id and a.user_id = auth.uid()
where r.user_id is not null or a.user_id is not null;

comment on view public.self_event_history is
  'Self-scoped RSVP + attendance history. Includes cover_image_path for thumbnail rendering on member dashboards and list views.';

revoke all on public.self_event_history from public;
grant  select on public.self_event_history to authenticated, service_role;
