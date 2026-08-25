-- Campaign metrics for the Links tab.
--
-- 20260824150000 returned a flat list of links with four counters each, which
-- answers "how is this link doing" and not "which channel won" or "when did
-- they come". Both of those are the actual question behind running campaigns
-- in the first place, so this replaces the payload with three parts:
--
--   links   — unchanged, per-link counters
--   totals  — the funnel across every link on the event
--   daily   — a dense per-day series of clicks / visitors / rsvps / signups
--
-- The series is generated with generate_series and left-joined, not built from
-- the rows that happen to exist. A campaign chart that silently drops the days
-- nobody clicked shows steady interest where there were two spikes and a
-- week of nothing (DESIGN.md §10).
--
-- Still aggregate-only, and still no audit row — see the header of
-- 20260824150000 for why both of those are load-bearing rather than
-- incidental. Nothing here can name a person, because there is no column
-- anywhere in referral_link_hits that could.

create or replace function public.admin_referral_links_for(
  p_event_id uuid,
  p_days     int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_days   int  := greatest(1, least(coalesce(p_days, 30), 180));
  v_rows   jsonb;
  v_totals jsonb;
  v_daily  jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_referral_links_for: admin only' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      rl.id,
      rl.slug,
      rl.label,
      rl.created_at,
      rl.archived_at,
      coalesce(nullif(trim(p.preferred_name), ''), p.first_name) as created_by_name,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'click')::int as clicks,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'click' and h.is_new_visitor)::int as visitors,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'rsvp')::int as rsvps,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'signup')::int as signups,
      (select max(h.occurred_at) from public.referral_link_hits h
         where h.link_id = rl.id) as last_hit_at
    from public.referral_links rl
    left join public.profiles p on p.id = rl.created_by
    where rl.event_id = p_event_id
  ) r;

  select jsonb_build_object(
    'links',    count(distinct rl.id)::int,
    'active',   count(distinct rl.id) filter (where rl.archived_at is null)::int,
    'clicks',   count(h.id) filter (where h.kind = 'click')::int,
    'visitors', count(h.id) filter (where h.kind = 'click' and h.is_new_visitor)::int,
    'rsvps',    count(h.id) filter (where h.kind = 'rsvp')::int,
    'signups',  count(h.id) filter (where h.kind = 'signup')::int
  )
    into v_totals
  from public.referral_links rl
  left join public.referral_link_hits h on h.link_id = rl.id
  where rl.event_id = p_event_id;

  select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.day), '[]'::jsonb)
    into v_daily
  from (
    select
      g.day::date as day,
      count(h.id) filter (where h.kind = 'click')::int as clicks,
      count(h.id) filter (where h.kind = 'click' and h.is_new_visitor)::int as visitors,
      count(h.id) filter (where h.kind = 'rsvp')::int as rsvps,
      count(h.id) filter (where h.kind = 'signup')::int as signups
    from generate_series(
           (current_date - (v_days - 1))::timestamptz,
           current_date::timestamptz,
           interval '1 day'
         ) as g(day)
    left join public.referral_links rl
      on rl.event_id = p_event_id
    left join public.referral_link_hits h
      on h.link_id = rl.id
     and h.occurred_at >= g.day
     and h.occurred_at <  g.day + interval '1 day'
    group by g.day
  ) d;

  return jsonb_build_object(
    'links',  v_rows,
    'totals', v_totals,
    'daily',  v_daily,
    'days',   v_days
  );
end;
$$;

-- Re-grant: create or replace preserves grants on an existing signature, but
-- the added p_days default makes this a NEW signature, which arrives with
-- Supabase's default privileges attached. Same trap as 20260824160000 —
-- CLAUDE.md hard rule #10.
revoke all on function public.admin_referral_links_for(uuid, int) from public, anon;
grant execute on function public.admin_referral_links_for(uuid, int)
  to authenticated, service_role;

-- The old single-argument signature is now unreachable from the app and would
-- otherwise sit there still granted to anon.
drop function if exists public.admin_referral_links_for(uuid);

comment on function public.admin_referral_links_for(uuid, int) is
  'Admin-only campaign metrics for one event: per-link counters, the funnel across all links, and a dense daily series. Aggregate only — referral_link_hits cannot identify a person.';
