-- Gap: member_card_attended_events_for_viewer() (the public "Events
-- attended" section on /members/[slug]) only ever read event_attendances,
-- the live platform's check-in table. Members whose only real attendance
-- record is historical (pre-platform Luma-era events, imported into
-- historical_event_attendances and keyed to legacy_members since those
-- attendees never signed into the platform, see
-- 20260821020000_historical_events_schema.sql) never showed anything under
-- "Events attended" even when they actually attended real events, because
-- their attendance lives in a different table joined through
-- legacy_members.claimed_profile_id rather than a direct user_id.
--
-- Fix: union in historical rows for the target's claimed legacy identity,
-- approved-only (same "approved = went" convention as
-- historical_attendance_counts() in 20260822030000), same visibility
-- exclusions (sensitive / private_invite) as the live branch. Column shape,
-- sharing gate (profile_visibility_settings.share_attended_events), and
-- can_view_member_card() check are all unchanged.

create or replace function public.member_card_attended_events_for_viewer(
  p_viewer_id uuid,
  p_target_id uuid
)
returns table (
  event_id         uuid,
  event_slug       text,
  event_title      text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  cover_image_path text,
  checked_in_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share boolean;
  v_rows  int;
begin
  if p_viewer_id is null or p_target_id is null then
    return;
  end if;
  if not public.can_view_member_card(p_viewer_id, p_target_id) then
    return;
  end if;

  select coalesce(pvs.share_attended_events, false)
    into v_share
  from public.profile_visibility_settings pvs
  where pvs.user_id = p_target_id;

  if not coalesce(v_share, false) then
    return;
  end if;

  return query
  select
    e.id          as event_id,
    e.slug        as event_slug,
    e.title       as event_title,
    e.starts_at,
    e.ends_at,
    e.cover_image_path,
    a.checked_in_at
  from public.event_attendances a
  join public.events e on e.id = a.event_id
  where a.user_id = p_target_id
    and e.status in ('published', 'cancelled', 'archived')
    and e.is_sensitive = false
    and e.visibility <> 'private_invite'
  union all
  select
    e.id          as event_id,
    e.slug        as event_slug,
    e.title       as event_title,
    e.starts_at,
    e.ends_at,
    e.cover_image_path,
    h.checked_in_at
  from public.historical_event_attendances h
  join public.legacy_members lm on lm.id = h.legacy_member_id
  join public.events e on e.id = h.event_id
  where lm.claimed_profile_id = p_target_id
    and lower(h.approval_status) = 'approved'
    and e.status in ('published', 'cancelled', 'archived')
    and e.is_sensitive = false
    and e.visibility <> 'private_invite'
  order by checked_in_at desc nulls last, starts_at desc;

  get diagnostics v_rows = row_count;

  if p_viewer_id <> p_target_id then
    perform public.write_audit(
      'member.card_attended_events_view',
      p_viewer_id,
      p_target_id,
      jsonb_build_object('event_count', v_rows)
    );
  end if;
end;
$$;

comment on function public.member_card_attended_events_for_viewer(uuid, uuid) is
  'Attended events the target opted to share (share_attended_events). Includes both live event_attendances and historical (pre-platform) attendance via the target''s claimed legacy_members identity (2026-08-23 fix) — a member with only historical attendance previously showed nothing here.';

revoke all on function public.member_card_attended_events_for_viewer(uuid, uuid) from public;
grant  execute on function public.member_card_attended_events_for_viewer(uuid, uuid)
  to authenticated, service_role;
