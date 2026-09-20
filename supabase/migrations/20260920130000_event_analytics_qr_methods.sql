-- admin_event_analytics_for still only knows the two check-in methods that
-- existed when it shipped. attendance_method_t has since gained qr_token
-- (20260816000400, staff scans the attendee's QR) and self_qr (20260915160000,
-- attendee scans the event QR), and the QR paths are now how nearly everyone
-- gets in: on the $1000 Fall Kickoff Carnival 94 of 97 check-ins were
-- qr_token. Two tiles were wrong because of it:
--
--   CHECK-IN METHOD read 0 / 3 — the split only summed self_code and
--   admin_click, so 94 check-ins belonged to neither side.
--
--   WALK-INS read 4 instead of 46 — a member walk-in was "admin_click with no
--   RSVP row", which predates staff being able to scan a member's personal
--   QR. 42 members were scanned in with no RSVP and counted as nothing.
--
-- Fix: the split is by who performed the check-in, not by one literal each.
--   self  = self_code, self_qr     (the attendee did it)
--   admin = admin_click, qr_token  (staff did it)
-- and a member walk-in is any attendance with no RSVP row, whatever the
-- method. The jsonb keys stay self_code / admin_click so the tab and its
-- types need no change.
--
-- Otherwise identical to 20260920120000.

create or replace function public.admin_event_analytics_for(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_going     int  := 0;
  v_waitlist  int  := 0;
  v_declined  int  := 0;
  v_cancelled int  := 0;
  v_attended  int  := 0;
  v_walkins   int  := 0;
  v_self_ci   int  := 0;
  v_admin_ci  int  := 0;
  v_noshows   int  := 0;
  v_first_rsvp       timestamptz;
  v_first_checkin    timestamptz;
  v_event            record;
  v_promoted_count   int := 0;
  v_notif_rows       jsonb;
  v_hist_going        int := 0;
  v_hist_attended     int := 0;
  v_hist_noshows      int := 0;
  v_hist_walkins      int := 0;
  v_hist_first_reg    timestamptz;
  v_hist_first_ci     timestamptz;
  v_guest_going       int := 0;
  v_guest_waitlist    int := 0;
  v_guest_cancelled   int := 0;
  v_guest_attended    int := 0;
  v_guest_self_ci     int := 0;
  v_guest_admin_ci    int := 0;
  v_guest_walkins     int := 0;
  v_guest_noshows     int := 0;
  v_guest_first_rsvp  timestamptz;
  v_guest_first_ci    timestamptz;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_analytics_for: admin only' using errcode = 'P0001';
  end if;

  select
    e.id, e.title, e.slug, e.status, e.visibility,
    e.starts_at, e.ends_at, e.capacity, e.waitlist_enabled,
    e.is_sensitive, e.created_at, e.published_at, e.cancelled_at,
    e.cancellation_reason, e.reminder_sent_at, e.archived_at, e.import_source
    into v_event
  from public.events e
  where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'admin_event_analytics_for: event not found' using errcode = 'P0002';
  end if;

  select
    coalesce(sum(case when status = 'going'      then 1 else 0 end), 0),
    coalesce(sum(case when status = 'waitlisted' then 1 else 0 end), 0),
    coalesce(sum(case when status = 'declined'   then 1 else 0 end), 0),
    coalesce(sum(case when status = 'cancelled'  then 1 else 0 end), 0)
    into v_going, v_waitlist, v_declined, v_cancelled
  from public.event_rsvps
  where event_id = p_event_id;

  select
    count(*)::int,
    coalesce(sum(case when method in ('self_code', 'self_qr')     then 1 else 0 end), 0),
    coalesce(sum(case when method in ('admin_click', 'qr_token') then 1 else 0 end), 0)
    into v_attended, v_self_ci, v_admin_ci
  from public.event_attendances
  where event_id = p_event_id;

  select count(*)::int
    into v_walkins
  from public.event_attendances a
  where a.event_id = p_event_id
    and not exists (
      select 1 from public.event_rsvps r
      where r.event_id = a.event_id and r.user_id = a.user_id
    );

  select count(*)::int
    into v_noshows
  from public.event_rsvps r
  where r.event_id = p_event_id
    and r.status = 'going'
    and not exists (
      select 1 from public.event_attendances a
      where a.event_id = r.event_id and a.user_id = r.user_id
    );

  select min(rsvp_at)
    into v_first_rsvp
  from public.event_rsvps
  where event_id = p_event_id
    and status in ('going', 'waitlisted');

  select min(checked_in_at)
    into v_first_checkin
  from public.event_attendances
  where event_id = p_event_id;

  -- Historical (Luma-era) additions — all zero for a live event.
  select
    coalesce(sum(case when lower(approval_status) = 'approved' then 1 else 0 end), 0),
    coalesce(sum(case when checked_in_at is not null then 1 else 0 end), 0),
    coalesce(sum(case when lower(approval_status) = 'approved' and checked_in_at is null then 1 else 0 end), 0),
    coalesce(sum(case when checked_in_at is not null and coalesce(lower(approval_status), '') <> 'approved' then 1 else 0 end), 0),
    min(registered_at),
    min(checked_in_at)
    into v_hist_going, v_hist_attended, v_hist_noshows, v_hist_walkins, v_hist_first_reg, v_hist_first_ci
  from public.historical_event_attendances
  where event_id = p_event_id;

  -- Guest (non-member) RSVPs — the fold this migration exists for.
  -- event_guest_rsvps has no 'declined' status (see its status check
  -- constraint), so v_declined stays member-only.
  select
    coalesce(sum(case when status = 'going'      then 1 else 0 end), 0),
    coalesce(sum(case when status = 'waitlisted' then 1 else 0 end), 0),
    coalesce(sum(case when status = 'cancelled'  then 1 else 0 end), 0),
    min(case when status in ('going', 'waitlisted') then created_at end)
    into v_guest_going, v_guest_waitlist, v_guest_cancelled, v_guest_first_rsvp
  from public.event_guest_rsvps
  where event_id = p_event_id;

  select
    count(*)::int,
    coalesce(sum(case when method in ('self_code', 'self_qr')     then 1 else 0 end), 0),
    coalesce(sum(case when method in ('admin_click', 'qr_token') then 1 else 0 end), 0),
    min(checked_in_at)
    into v_guest_attended, v_guest_self_ci, v_guest_admin_ci, v_guest_first_ci
  from public.event_guest_attendances
  where event_id = p_event_id;

  select count(*)::int
    into v_guest_walkins
  from public.event_guest_attendances a
  join public.event_guest_rsvps g on g.id = a.guest_rsvp_id
  where a.event_id = p_event_id
    and g.created_at >= v_event.starts_at;

  select count(*)::int
    into v_guest_noshows
  from public.event_guest_rsvps g
  where g.event_id = p_event_id
    and g.status = 'going'
    and not exists (
      select 1 from public.event_guest_attendances a
      where a.event_id = g.event_id and a.guest_rsvp_id = g.id
    );

  v_going     := v_going + v_hist_going + v_guest_going;
  v_waitlist  := v_waitlist + v_guest_waitlist;
  v_cancelled := v_cancelled + v_guest_cancelled;
  v_attended  := v_attended + v_hist_attended + v_guest_attended;
  v_self_ci   := v_self_ci + v_guest_self_ci;
  v_admin_ci  := v_admin_ci + v_hist_attended + v_guest_admin_ci;
  v_walkins   := v_walkins + v_hist_walkins + v_guest_walkins;
  v_noshows   := v_noshows + v_hist_noshows + v_guest_noshows;
  -- least() is strict: a null operand makes the whole result null, which would
  -- blank First RSVP on any event that has guest rows but no member rows.
  v_first_rsvp    := least(
    coalesce(v_first_rsvp, 'infinity'::timestamptz),
    coalesce(v_hist_first_reg, 'infinity'::timestamptz),
    coalesce(v_guest_first_rsvp, 'infinity'::timestamptz)
  );
  if v_first_rsvp = 'infinity'::timestamptz then v_first_rsvp := null; end if;

  v_first_checkin := least(
    coalesce(v_first_checkin, 'infinity'::timestamptz),
    coalesce(v_hist_first_ci, 'infinity'::timestamptz),
    coalesce(v_guest_first_ci, 'infinity'::timestamptz)
  );
  if v_first_checkin = 'infinity'::timestamptz then v_first_checkin := null; end if;

  select count(distinct coalesce(target_user_id, actor_user_id))::int
    into v_promoted_count
  from public.audit_log
  where action in ('event.promote_waitlist', 'event.rsvp')
    and metadata @> jsonb_build_object('event_id', p_event_id::text)
    and (
      action = 'event.promote_waitlist'
      or (metadata @> '{"previous":"waitlisted","effective":"going"}'::jsonb)
    );

  select coalesce(
    jsonb_object_agg(kind_status, cnt),
    '{}'::jsonb
  )
    into v_notif_rows
  from (
    select (kind::text || ':' || status::text) as kind_status, count(*)::int as cnt
    from public.event_notification_jobs
    where event_id = p_event_id
    group by kind, status
  ) t;

  perform public.write_audit(
    'event.analytics_view', v_uid, null,
    jsonb_build_object('event_id', p_event_id)
  );

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', v_event.title,
      'slug', v_event.slug,
      'status', v_event.status,
      'visibility', v_event.visibility,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'capacity', v_event.capacity,
      'waitlist_enabled', v_event.waitlist_enabled,
      'is_sensitive', v_event.is_sensitive,
      'created_at', v_event.created_at,
      'published_at', v_event.published_at,
      'cancelled_at', v_event.cancelled_at,
      'cancellation_reason', v_event.cancellation_reason,
      'reminder_sent_at', v_event.reminder_sent_at,
      'archived_at', v_event.archived_at,
      'import_source', v_event.import_source
    ),
    'rsvp', jsonb_build_object(
      'going', v_going,
      'waitlisted', v_waitlist,
      'declined', v_declined,
      'cancelled', v_cancelled,
      -- Split so the tab can show "of which N guests" without a second query.
      'members', v_going - v_hist_going - v_guest_going,
      'guests', v_guest_going,
      'historical', v_hist_going
    ),
    'attendance', jsonb_build_object(
      'total', v_attended,
      'self_code', v_self_ci,
      'admin_click', v_admin_ci,
      'walk_ins', v_walkins,
      'no_shows', v_noshows,
      'promoted_from_waitlist', v_promoted_count
    ),
    'timing', jsonb_build_object(
      'first_rsvp_at', v_first_rsvp,
      'first_checkin_at', v_first_checkin
    ),
    'notifications', v_notif_rows
  );
end;
$$;

comment on function public.admin_event_analytics_for(uuid) is
  'Per-event admin analytics blob. Counts member RSVPs + guest RSVPs + approved historical (Luma) registrations, matching the going count the admin event header computes — see 20260920120000 for why they diverged. Check-in method split and walk-ins cover the QR methods too (20260920130000). SECURITY DEFINER, admin-gated, volatile (writes audit).';

revoke all on function public.admin_event_analytics_for(uuid) from public;
grant  execute on function public.admin_event_analytics_for(uuid)
  to authenticated, service_role;
