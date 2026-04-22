-- Migration 000900 — R1 admin analytics layer.
--
-- Per docs/13-roadmap/03-admin-analytics.md:
--  1. events_ends_at_idx so the cross-event rollup can window-filter on
--     e.ends_at without seq-scanning.
--  2. admin_event_analytics_for(event_id) — all tile numbers + timing +
--     notifications breakdown for one event. Audited.
--  3. admin_cross_event_analytics(window_days) — rollup aggregates per
--     time window. Audited.
--
-- Both functions are SECURITY DEFINER + volatile (they write audit rows).
-- Volatility matters: if declared `stable`, PostgREST wraps them in a
-- read-only transaction and the audit INSERT fails — this is the same bug
-- we already hit in admin_event_roster_for (see migration 000400).

-- ============================================================================
-- events_ends_at_idx — supports rollup window filters.
-- ============================================================================
create index if not exists events_ends_at_idx
  on public.events (ends_at)
  where status in ('published', 'cancelled', 'archived');

-- ============================================================================
-- admin_event_analytics_for(p_event_id uuid) returns jsonb
-- ============================================================================
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
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_analytics_for: admin only' using errcode = 'P0001';
  end if;

  select
    e.id, e.title, e.slug, e.status, e.visibility,
    e.starts_at, e.ends_at, e.capacity, e.waitlist_enabled,
    e.is_sensitive, e.created_at, e.published_at, e.cancelled_at,
    e.cancellation_reason, e.reminder_sent_at, e.archived_at
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
    coalesce(sum(case when method = 'self_code'   then 1 else 0 end), 0),
    coalesce(sum(case when method = 'admin_click' then 1 else 0 end), 0)
    into v_attended, v_self_ci, v_admin_ci
  from public.event_attendances
  where event_id = p_event_id;

  select count(*)::int
    into v_walkins
  from public.event_attendances a
  where a.event_id = p_event_id
    and a.method = 'admin_click'
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
      'archived_at', v_event.archived_at
    ),
    'rsvp', jsonb_build_object(
      'going', v_going,
      'waitlisted', v_waitlist,
      'declined', v_declined,
      'cancelled', v_cancelled
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

revoke all on function public.admin_event_analytics_for(uuid) from public;
grant  execute on function public.admin_event_analytics_for(uuid)
  to authenticated, service_role;

-- ============================================================================
-- admin_cross_event_analytics(p_window_days int) returns jsonb
-- ============================================================================
create or replace function public.admin_cross_event_analytics(p_window_days int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_start         timestamptz;
  v_end           timestamptz := now();
  v_events_run    int := 0;
  v_total_going   int := 0;
  v_total_checkin int := 0;
  v_avg_rate      numeric;
  v_vis_members   int := 0;
  v_vis_private   int := 0;
  v_notif_rows    jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_cross_event_analytics: admin only' using errcode = 'P0001';
  end if;
  if p_window_days is null or p_window_days <= 0 then
    raise exception 'admin_cross_event_analytics: window_days must be > 0'
      using errcode = 'P0001';
  end if;

  v_start := v_end - make_interval(days => p_window_days);

  select count(*)::int
    into v_events_run
  from public.events e
  where e.status in ('published', 'cancelled', 'archived')
    and e.ends_at >= v_start
    and e.ends_at <  v_end;

  select count(*)::int
    into v_total_going
  from public.event_rsvps r
  join public.events e on e.id = r.event_id
  where r.status = 'going'
    and e.ends_at >= v_start
    and e.ends_at <  v_end;

  select count(*)::int
    into v_total_checkin
  from public.event_attendances a
  join public.events e on e.id = a.event_id
  where e.ends_at >= v_start
    and e.ends_at <  v_end;

  select avg(rate)
    into v_avg_rate
  from (
    select
      coalesce(
        (select count(*)::numeric from public.event_attendances a where a.event_id = e.id)
        / nullif((select count(*) from public.event_rsvps r
                   where r.event_id = e.id and r.status = 'going'), 0),
        0
      ) as rate
    from public.events e
    where e.ends_at >= v_start
      and e.ends_at <  v_end
      and e.status <> 'draft'
  ) sub;

  select
    coalesce(sum(case when visibility = 'members' then 1 else 0 end), 0),
    coalesce(sum(case when visibility = 'private_invite' then 1 else 0 end), 0)
    into v_vis_members, v_vis_private
  from public.events
  where ends_at >= v_start
    and ends_at <  v_end
    and status in ('published', 'cancelled', 'archived');

  select coalesce(
    jsonb_object_agg(kind_status, cnt),
    '{}'::jsonb
  )
    into v_notif_rows
  from (
    select (j.kind::text || ':' || j.status::text) as kind_status, count(*)::int as cnt
    from public.event_notification_jobs j
    join public.events e on e.id = j.event_id
    where e.ends_at >= v_start
      and e.ends_at <  v_end
    group by j.kind, j.status
  ) t;

  perform public.write_audit(
    'event.cross_event_analytics_view', v_uid, null,
    jsonb_build_object('window_days', p_window_days)
  );

  return jsonb_build_object(
    'window_days', p_window_days,
    'events_run', v_events_run,
    'total_going', v_total_going,
    'total_checkin', v_total_checkin,
    'avg_attendance_rate', v_avg_rate,
    'visibility', jsonb_build_object(
      'members', v_vis_members,
      'private_invite', v_vis_private
    ),
    'notifications', v_notif_rows
  );
end;
$$;

revoke all on function public.admin_cross_event_analytics(int) from public;
grant  execute on function public.admin_cross_event_analytics(int)
  to authenticated, service_role;
