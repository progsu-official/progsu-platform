-- Gap: self_event_history (the view /profile's own "Attended" count and,
-- from this migration on, its "Events attended" list read) only ever
-- joined live event_rsvps/event_attendances on auth.uid(). A member whose
-- only real attendance is historical (pre-platform Luma-era, keyed to
-- legacy_members since those attendees never signed into the platform —
-- see 20260821020000_historical_events_schema.sql) showed "0 Attended" on
-- their own dashboard even after their legacy identity was correctly
-- claimed (2026-08-23 claim-backfill fix). Unions in approved historical
-- rows via the caller's claimed legacy_members identity.
--
-- Deliberately NOT reusing member_card_attended_events_for_viewer here: that
-- function gates on profile_visibility_settings.share_attended_events, a
-- peer-visibility toggle — it should never hide a member's own history from
-- themselves. self_event_history is self-scoped by auth.uid() already, no
-- separate gate needed.
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
where r.user_id is not null or a.user_id is not null
union all
select
  e.id                as event_id,
  e.slug,
  e.title,
  e.starts_at,
  e.ends_at,
  e.status,
  e.visibility,
  e.location_text,
  null                as rsvp_status,
  null                as rsvp_changed_at,
  null                as waitlisted_at,
  h.checked_in_at,
  null::public.attendance_method_t as attendance_method,
  true                as attended,
  e.cover_image_path
from public.historical_event_attendances h
join public.legacy_members lm on lm.id = h.legacy_member_id
join public.events e on e.id = h.event_id
where lm.claimed_profile_id = auth.uid()
  and lower(h.approval_status) = 'approved';

comment on view public.self_event_history is
  'Self-scoped RSVP + attendance history. Includes cover_image_path for thumbnail rendering. Also includes approved historical (pre-platform) attendance via the caller''s claimed legacy_members identity (2026-08-23 fix) — no share_attended_events gate, this is your own history.';

revoke all on public.self_event_history from public;
grant  select on public.self_event_history to authenticated, service_role;
