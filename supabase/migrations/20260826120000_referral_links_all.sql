-- Cross-event campaign dashboard, for /admin/links.
--
-- admin_referral_links_for(event) answers "how did this event's campaigns do".
-- It cannot answer "which channel works for us", because that question spans
-- every event we have ever promoted — and a channel comparison drawn from one
-- event is exactly the hunch this feature was built to replace
-- (docs/17-campaign-links.md §1, and §8's "not built" note, which this is).
--
-- Same three-part payload as its per-event sibling plus two additions:
--
--   links  — now carries the event it belongs to, since the page groups by it
--   events — the pick list for the create form, so the page is one round trip
--            rather than a select that has to guess at RLS on events
--
-- Still aggregate-only and still no audit row, for the reasons in the header
-- of 20260824150000: every number here is org-level, this runs on every
-- navigation to the tab, and there is no column in referral_link_hits that
-- could name a person even if someone wanted it to.

create or replace function public.admin_referral_links_all(
  p_days int default 30
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
  v_events jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_referral_links_all: admin only' using errcode = 'P0001';
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
      e.id      as event_id,
      e.title   as event_title,
      e.slug    as event_slug,
      e.starts_at as event_starts_at,
      e.status::text as event_status,
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
    join public.events e on e.id = rl.event_id
    left join public.profiles p on p.id = rl.created_by
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
  left join public.referral_link_hits h on h.link_id = rl.id;

  -- Dense series: generated days left-joined to hits, never built from the
  -- rows that happen to exist. A campaign chart that drops the quiet days
  -- shows steady interest where there were two spikes and a dead fortnight
  -- (DESIGN.md §10).
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
    left join public.referral_link_hits h
      on h.occurred_at >= g.day
     and h.occurred_at <  g.day + interval '1 day'
    group by g.day
  ) d;

  -- Pick list for the create form. Archived events are excluded because a
  -- campaign for one is not a thing anyone means to start; cancelled ones are
  -- kept, since a link made before a cancellation still needs to be findable.
  select coalesce(jsonb_agg(row_to_json(ev)::jsonb order by ev.starts_at desc), '[]'::jsonb)
    into v_events
  from (
    select e.id, e.title, e.slug, e.starts_at, e.status::text as status
    from public.events e
    where e.archived_at is null
    order by e.starts_at desc
    limit 200
  ) ev;

  return jsonb_build_object(
    'links',  v_rows,
    'totals', v_totals,
    'daily',  v_daily,
    'events', v_events,
    'days',   v_days
  );
end;
$$;

-- New signature, so it arrives with Supabase's default privileges attached
-- (alter default privileges ... grant all on functions to anon, authenticated,
-- service_role). Revoking from PUBLIC alone does not touch those per-role
-- grants — CLAUDE.md hard rule #10, and the hole 20260824160000 had to close.
revoke all on function public.admin_referral_links_all(int) from public, anon;
grant execute on function public.admin_referral_links_all(int)
  to authenticated, service_role;

comment on function public.admin_referral_links_all(int) is
  'Cross-event campaign dashboard for /admin/links: every link with its event, the funnel across all of them, a dense daily series, and the event pick list. Admin-gated, aggregate-only, no audit row (see 20260824150000).';
