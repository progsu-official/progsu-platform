-- Same fold as 20260920120000, one page over. admin_cross_event_analytics
-- (the /admin/events/analytics rollup) counts event_rsvps + historical and
-- has never counted event_guest_rsvps, so every window total under-reports by
-- however many non-members showed up — which, on the 2026 fall events, is most
-- of the room: 352 of 464 going on the Fall Kickoff Carnival were guests.
--
-- Unchanged from the 20260821030000 definition except the guest folds.

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
  v_hist_going    int := 0;
  v_hist_checkin  int := 0;
  v_guest_going   int := 0;
  v_guest_checkin int := 0;
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

  select coalesce(count(*)::int, 0)
    into v_hist_going
  from public.historical_event_attendances hea
  join public.events e on e.id = hea.event_id
  where lower(hea.approval_status) = 'approved'
    and e.ends_at >= v_start
    and e.ends_at <  v_end;

  select coalesce(count(*)::int, 0)
    into v_hist_checkin
  from public.historical_event_attendances hea
  join public.events e on e.id = hea.event_id
  where hea.checked_in_at is not null
    and e.ends_at >= v_start
    and e.ends_at <  v_end;

  select coalesce(count(*)::int, 0)
    into v_guest_going
  from public.event_guest_rsvps g
  join public.events e on e.id = g.event_id
  where g.status = 'going'
    and e.ends_at >= v_start
    and e.ends_at <  v_end;

  select coalesce(count(*)::int, 0)
    into v_guest_checkin
  from public.event_guest_attendances ga
  join public.events e on e.id = ga.event_id
  where e.ends_at >= v_start
    and e.ends_at <  v_end;

  v_total_going   := v_total_going + v_hist_going + v_guest_going;
  v_total_checkin := v_total_checkin + v_hist_checkin + v_guest_checkin;

  select avg(rate)
    into v_avg_rate
  from (
    select
      coalesce(
        (
          (select count(*)::numeric from public.event_attendances a where a.event_id = e.id)
          + (select count(*)::numeric from public.historical_event_attendances hea
               where hea.event_id = e.id and hea.checked_in_at is not null)
          + (select count(*)::numeric from public.event_guest_attendances ga
               where ga.event_id = e.id)
        )
        / nullif(
          (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'going')
          + (select count(*) from public.historical_event_attendances hea2
               where hea2.event_id = e.id and lower(hea2.approval_status) = 'approved')
          + (select count(*) from public.event_guest_rsvps g2
               where g2.event_id = e.id and g2.status = 'going'),
          0
        ),
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

comment on function public.admin_cross_event_analytics(int) is
  'Cross-event rollup for a trailing window. Counts member RSVPs + guest RSVPs + approved historical registrations, matching the per-event blob — see 20260920120200. SECURITY DEFINER, admin-gated, volatile (writes audit).';

revoke all on function public.admin_cross_event_analytics(int) from public;
grant  execute on function public.admin_cross_event_analytics(int)
  to authenticated, service_role;
