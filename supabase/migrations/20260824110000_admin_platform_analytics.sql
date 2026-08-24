-- admin_platform_analytics() — the numbers behind /admin Overview.
--
-- The Overview page has been six counts from six head-only queries since it
-- shipped. It answers "how many members" and nothing else: not whether that
-- number is growing, not whether people who sign up actually finish
-- onboarding, not whether we are running events people show up to. Those are
-- the questions officers ask, and answering them today means opening the
-- Supabase SQL editor.
--
-- One RPC instead of ~15 round-trips from the page. Everything here is an
-- org-level aggregate — no row identifies a member — which is also why this
-- one does NOT write an audit row, unlike admin_event_roster_for() and
-- admin_event_analytics_for(). Those expose per-member detail and Overview
-- is the admin landing page, so an audit row per call would be one row per
-- admin navigation, logging that someone looked at a member count.
-- docs/13-roadmap/03-admin-analytics.md §4 draws that line at per-member data.
--
-- SCALE. The onboarding funnel calls is_fully_onboarded() once per profile
-- rather than reimplementing its rules here — CLAUDE.md hard rule #5 keeps
-- exactly two copies of that contract (the helper and lib/auth/onboarding.ts)
-- and a third would rot. That is a few index lookups per member; fine into
-- the low thousands. Past that, snapshot it into a nightly rollup table
-- rather than widening this function.

create or replace function public.admin_platform_analytics(
  p_weeks  int default 26,
  p_months int default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_weeks  int  := greatest(4, least(coalesce(p_weeks, 26), 104));
  v_months int  := greatest(3, least(coalesce(p_months, 12), 36));
  v_out    jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_platform_analytics: admin only' using errcode = 'P0001';
  end if;

  with
  -- Active roster. Archived profiles are excluded everywhere below: they are
  -- deactivated accounts, and counting them would inflate every ratio.
  member as (
    select p.* from public.profiles p where p.is_archived = false
  ),
  member_stats as (
    select
      count(*)::int                                                as total,
      count(*) filter (where m.student_email_verified)::int        as verified,
      count(*) filter (where not m.student_email_verified)::int    as unverified,
      count(*) filter (where m.is_admin)::int                      as admins,
      count(*) filter (where m.open_to_recruiters)::int            as open_to_recruiters,
      count(*) filter (where public.is_fully_onboarded(m.id))::int as onboarded,
      count(*) filter (where m.created_at >= now() - interval  '7 days')::int as new_7d,
      count(*) filter (where m.created_at >= now() - interval '30 days')::int as new_30d,
      count(*) filter (where m.created_at >= now() - interval '90 days')::int as new_90d
    from member m
  ),
  -- Dense weekly series: a week nobody joined has to render as a zero-height
  -- bar, not vanish. A bar chart with the empty weeks dropped reads as
  -- steady growth when it was actually two spikes and a flat summer.
  signup_weeks as (
    select
      to_char(w.wk, 'YYYY-MM-DD') as week,
      (select count(*) from member m
        where m.created_at >= w.wk
          and m.created_at <  w.wk + interval '1 week')::int as n
    from generate_series(
      date_trunc('week', now()) - make_interval(weeks => v_weeks - 1),
      date_trunc('week', now()),
      interval '1 week'
    ) as w(wk)
  ),
  -- Per-event headcount, folded the same way every member-facing surface
  -- folds it: live RSVPs + guest RSVPs + approved historical attendance.
  event_head as (
    select
      e.id,
      e.title,
      e.starts_at,
      e.status,
      (
        (select count(*) from public.event_rsvps r
          where r.event_id = e.id and r.status = 'going')
      + (select count(*) from public.event_guest_rsvps g
          where g.event_id = e.id and g.status = 'going')
      + (select count(*) from public.historical_event_attendances h
          where h.event_id = e.id and lower(h.approval_status) = 'approved')
      )::int as head
    from public.events e
    where e.status in ('published', 'archived')
  ),
  event_stats as (
    select
      count(*)::int                                              as total,
      count(*) filter (where eh.starts_at >= now())::int          as upcoming,
      count(*) filter (where eh.starts_at <  now())::int          as past,
      count(*) filter (
        where eh.starts_at >= now() - interval '365 days'
          and eh.starts_at <  now()
      )::int                                                     as past_year,
      coalesce(sum(eh.head), 0)::int                             as attendance,
      coalesce(
        round(avg(eh.head) filter (where eh.starts_at < now()))::int,
        0
      )                                                          as avg_head
    from event_head eh
  ),
  event_months as (
    select
      to_char(mo.m, 'YYYY-MM') as month,
      (select count(*) from event_head eh
        where eh.starts_at >= mo.m
          and eh.starts_at <  mo.m + interval '1 month')::int as events,
      (select coalesce(sum(eh.head), 0) from event_head eh
        where eh.starts_at >= mo.m
          and eh.starts_at <  mo.m + interval '1 month')::int as attendance
    from generate_series(
      date_trunc('month', now()) - make_interval(months => v_months - 1),
      date_trunc('month', now()),
      interval '1 month'
    ) as mo(m)
  ),
  top_events as (
    select eh.title, eh.starts_at, eh.head
    from event_head eh
    where eh.starts_at < now()
    order by eh.head desc, eh.starts_at desc
    limit 6
  ),
  standing as (
    select
      coalesce(m.class_standing::text, 'unknown') as key,
      count(*)::int                               as n
    from member m
    group by 1
  ),
  roles as (
    select r.key::text as key, count(*)::int as n
    from member m, unnest(m.interested_roles) as r(key)
    group by 1
    order by n desc
    limit 8
  ),
  schools as (
    select
      coalesce(nullif(btrim(m.school), ''), 'Not given') as key,
      count(*)::int                                      as n
    from member m
    group by 1
    order by n desc
    limit 6
  ),
  extras as (
    select
      (select count(*) from public.profile_visibility_settings pvs
        join member m on m.id = pvs.user_id
        where pvs.discoverable)::int                                as discoverable,
      (select count(distinct rz.user_id) from public.resumes rz
        join member m on m.id = rz.user_id
        where rz.is_current and rz.deleted_at is null)::int          as with_resume,
      (select count(*) from public.profiles p where p.is_archived)::int as archived,
      (select count(*) from public.legacy_members)::int              as legacy_total,
      (select count(*) from public.legacy_members lm
        where lm.claimed_profile_id is not null)::int                as legacy_claimed,
      (select count(*) from public.domain_requests)::int             as domain_requests
  )
  select jsonb_build_object(
    'members', (
      select to_jsonb(ms) || jsonb_build_object(
        'discoverable',       ex.discoverable,
        'with_resume',        ex.with_resume,
        'archived',           ex.archived
      )
      from member_stats ms, extras ex
    ),
    'signups_weekly', (
      select coalesce(jsonb_agg(to_jsonb(sw) order by sw.week), '[]'::jsonb)
      from signup_weeks sw
    ),
    'events', (select to_jsonb(es) from event_stats es),
    'events_monthly', (
      select coalesce(jsonb_agg(to_jsonb(em) order by em.month), '[]'::jsonb)
      from event_months em
    ),
    'top_events', (
      select coalesce(jsonb_agg(to_jsonb(te)), '[]'::jsonb)
      from (select * from top_events) te
    ),
    'class_standing', (
      select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from standing st
    ),
    'roles', (
      select coalesce(jsonb_agg(to_jsonb(rl)), '[]'::jsonb)
      from (select * from roles) rl
    ),
    'schools', (
      select coalesce(jsonb_agg(to_jsonb(sc)), '[]'::jsonb)
      from (select * from schools) sc
    ),
    'legacy', (
      select jsonb_build_object('total', ex.legacy_total, 'claimed', ex.legacy_claimed)
      from extras ex
    ),
    'domain_requests', (select ex.domain_requests from extras ex),
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  into v_out;

  return v_out;
end;
$$;

comment on function public.admin_platform_analytics(int, int) is
  'Org-level platform aggregates for /admin Overview: member counts, the onboarding funnel, a dense weekly signup series, event volume and attendance by month, and roster composition. Admin-only, read-only, no per-member rows and therefore no audit write (see docs/13-roadmap/03-admin-analytics.md §4).';

revoke all on function public.admin_platform_analytics(int, int) from public;
grant  execute on function public.admin_platform_analytics(int, int)
  to authenticated, service_role;
