-- Historical (pre-platform) event backfill — fold historical_event_attendances
-- into the three existing admin RPCs, additively. Every addition here is a
-- coalesce(sum(...), 0) or left join against historical_event_attendances,
-- which has zero rows for any live/platform-created event — so behavior for
-- every existing event is unchanged. See 20260821020000_historical_events_schema.sql
-- for why this is a separate table instead of rows in event_rsvps/event_attendances
-- (historical attendees have no profiles row to satisfy those tables' FKs).
--
-- Mapping (confirmed with John): Luma's approval_status = 'approved' is the
-- historical equivalent of a live "going" RSVP; checked_in_at is not null is
-- the equivalent of "attended". No self-service vs admin check-in distinction
-- exists in the Luma data, so historical check-ins fold into the admin_click
-- bucket.

-- ============================================================================
-- admin_event_analytics_for — add historical counts for one event.
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
  v_hist_going        int := 0;
  v_hist_attended     int := 0;
  v_hist_noshows      int := 0;
  v_hist_walkins      int := 0;
  v_hist_first_reg    timestamptz;
  v_hist_first_ci     timestamptz;
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

  v_going    := v_going + v_hist_going;
  v_attended := v_attended + v_hist_attended;
  v_admin_ci := v_admin_ci + v_hist_attended;
  v_walkins  := v_walkins + v_hist_walkins;
  v_noshows  := v_noshows + v_hist_noshows;
  v_first_rsvp    := least(v_first_rsvp, v_hist_first_reg);
  v_first_checkin := least(v_first_checkin, v_hist_first_ci);

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
-- admin_cross_event_analytics — add historical counts to the rollup.
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
  v_hist_going    int := 0;
  v_hist_checkin  int := 0;
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

  v_total_going   := v_total_going + v_hist_going;
  v_total_checkin := v_total_checkin + v_hist_checkin;

  select avg(rate)
    into v_avg_rate
  from (
    select
      coalesce(
        (
          (select count(*)::numeric from public.event_attendances a where a.event_id = e.id)
          + (select count(*)::numeric from public.historical_event_attendances hea
               where hea.event_id = e.id and hea.checked_in_at is not null)
        )
        / nullif(
          (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'going')
          + (select count(*) from public.historical_event_attendances hea2
               where hea2.event_id = e.id and lower(hea2.approval_status) = 'approved'),
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

revoke all on function public.admin_cross_event_analytics(int) from public;
grant  execute on function public.admin_cross_event_analytics(int)
  to authenticated, service_role;

-- ============================================================================
-- admin_event_roster_for — union in historical (legacy_members-identified)
-- attendees. Return type is changing (new OUT columns) — must drop first.
-- ============================================================================
drop function if exists public.admin_event_roster_for(uuid);

create function public.admin_event_roster_for(p_event_id uuid)
returns table (
  user_id            uuid,
  first_name         text,
  last_name          text,
  preferred_name     text,
  google_email       citext,
  student_email      citext,
  rsvp_status        public.rsvp_status_t,
  rsvp_comment       text,
  rsvp_changed_at    timestamptz,
  waitlisted_at      timestamptz,
  waitlist_position  int,
  attended           boolean,
  checked_in_at      timestamptz,
  checked_in_by      uuid,
  attendance_method  public.attendance_method_t,
  invited            boolean,
  invited_by         uuid,
  invited_at         timestamptz,
  fully_onboarded    boolean,
  is_historical      boolean,
  legacy_member_id   uuid,
  legacy_email       citext
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_roster_for: admin only' using errcode = 'P0001';
  end if;

  perform public.write_audit(
    'event.roster_view', v_uid, null,
    jsonb_build_object('event_id', p_event_id)
  );

  return query
  with waitlist_pos as (
    select r.user_id,
           row_number() over (order by r.waitlisted_at asc, r.user_id asc) as pos
    from public.event_rsvps r
    where r.event_id = p_event_id and r.status = 'waitlisted'
  ),
  roster_users as (
    select ru.user_id, null::uuid as legacy_member_id
      from public.event_rsvps       ru where ru.event_id = p_event_id
    union
    select ra.user_id, null::uuid as legacy_member_id
      from public.event_attendances ra where ra.event_id = p_event_id
    union
    select ri.user_id, null::uuid as legacy_member_id
      from public.event_invites     ri
      where ri.event_id = p_event_id and ri.revoked_at is null
    union
    select null::uuid as user_id, hea.legacy_member_id
      from public.historical_event_attendances hea
      where hea.event_id = p_event_id
  )
  select
    u.user_id,
    coalesce(p.first_name, lm.first_name),
    coalesce(p.last_name, lm.last_name),
    p.preferred_name,
    p.google_email,
    p.student_email,
    coalesce(
      r.status,
      case when lower(hea.approval_status) = 'approved' then 'going'::public.rsvp_status_t end
    ),
    r.comment,
    r.status_changed_at,
    r.waitlisted_at,
    wp.pos::int,
    case when u.legacy_member_id is not null then (hea.checked_in_at is not null)
         else (a.event_id is not null)
    end,
    coalesce(a.checked_in_at, hea.checked_in_at),
    a.checked_in_by,
    a.method,
    (ei.event_id is not null),
    ei.invited_by,
    ei.invited_at,
    case when u.user_id is not null then public.is_fully_onboarded(u.user_id) else null end,
    (u.legacy_member_id is not null),
    u.legacy_member_id,
    coalesce(lm.personal_email, lm.campus_email)
  from roster_users u
  left join public.profiles p on p.id = u.user_id
  left join public.legacy_members lm on lm.id = u.legacy_member_id
  left join public.event_rsvps       r  on r.event_id = p_event_id and r.user_id = u.user_id
  left join public.event_attendances a  on a.event_id = p_event_id and a.user_id = u.user_id
  left join public.event_invites     ei on ei.event_id = p_event_id and ei.user_id = u.user_id
  left join public.historical_event_attendances hea
    on hea.event_id = p_event_id and hea.legacy_member_id = u.legacy_member_id
  left join waitlist_pos             wp on wp.user_id = u.user_id
  order by
    case when coalesce(r.status, case when lower(hea.approval_status) = 'approved' then 'going'::public.rsvp_status_t end) = 'going' then 0
         when coalesce(r.status, case when lower(hea.approval_status) = 'approved' then 'going'::public.rsvp_status_t end) = 'waitlisted' then 1
         when coalesce(r.status, case when lower(hea.approval_status) = 'approved' then 'going'::public.rsvp_status_t end) = 'declined' then 2
         when coalesce(r.status, case when lower(hea.approval_status) = 'approved' then 'going'::public.rsvp_status_t end) = 'cancelled' then 3
         else 4
    end,
    wp.pos asc nulls last,
    coalesce(p.last_name, lm.last_name), coalesce(p.first_name, lm.first_name);
end;
$$;

revoke all on function public.admin_event_roster_for(uuid) from public;
grant  execute on function public.admin_event_roster_for(uuid)
  to authenticated, service_role;
