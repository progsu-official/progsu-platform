-- Migration 000300 — R3 shared event discovery.
--
-- Layers on R2's profile_visibility_settings + member-card helpers. Introduces
-- one DB check constraint, one helper (shared_events_for_viewer), and
-- extends set_profile_visibility with an R3 privacy-version gate.
--
-- Canon: docs/11-r3-shared-events-spec.md.
--
-- TUNING NOTE: SHARED_EVENT_MIN_ATTENDEES is intentionally set to 2 for
-- dogfooding. The spec recommends 10 for public launch. To tighten before
-- wider rollout, ship a new migration that re-creates shared_events_for_viewer
-- with the higher constant. Kept inline rather than in a config table: the
-- setting is load-bearing for privacy; infrequent changes should be visible
-- in migration history.

-- ============================================================================
-- Cross-column invariant: share_shared_event_counts requires discoverable.
-- ============================================================================
alter table public.profile_visibility_settings
  add constraint pvs_share_counts_requires_discoverable
  check (
    share_shared_event_counts = false
    or discoverable = true
  );

-- ============================================================================
-- shared_events_for_viewer(viewer, target) returns (event_count int, named_events jsonb)
-- Single-row return. All gates fail silently to return (0, '[]') so opt-out
-- and flag-off paths are indistinguishable from "no shared events". Raising
-- only on null/self inputs which represent bugs, not privacy boundaries.
-- ============================================================================
create or replace function public.shared_events_for_viewer(
  p_viewer_id uuid,
  p_target_id uuid
)
returns table (
  event_count  int,
  named_events jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Attendee threshold. Dogfood = 2. Public launch should raise to 10 via
  -- a follow-up migration.
  c_min_attendees constant int := 2;

  v_rate             record;
  v_viewer_share     boolean;
  v_target_share     boolean;
  v_aggregate_count  int := 0;
  v_named_events     jsonb := '[]'::jsonb;
begin
  -- Gate 1: null viewer / target is a bug — raise.
  if p_viewer_id is null or p_target_id is null then
    raise exception 'shared_events_for_viewer: viewer and target required'
      using errcode = 'P0001';
  end if;

  -- Gate 2: self-view short-circuits to empty, no raise, no audit.
  if p_viewer_id = p_target_id then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  -- Gates 3-7: fail silently → return (0, '[]').

  -- Gate 3: viewer must be fully onboarded.
  if not public.is_fully_onboarded(p_viewer_id) then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  -- Gate 4: target must be viewable by viewer (discoverable + onboarding check
  -- already folded into can_view_member_card).
  if not public.can_view_member_card(p_viewer_id, p_target_id) then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  -- Gates 5-6: mutual opt-in.
  select coalesce(share_shared_event_counts, false)
    into v_viewer_share
  from public.profile_visibility_settings
  where user_id = p_viewer_id;
  if not coalesce(v_viewer_share, false) then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  select coalesce(share_shared_event_counts, false)
    into v_target_share
  from public.profile_visibility_settings
  where user_id = p_target_id;
  if not coalesce(v_target_share, false) then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  -- Gate 7: rate limit. Not-allowed → return empty, no audit, no raise.
  select allowed
    into v_rate
  from public.consume_rate_limit('shared_events_view', p_viewer_id::text, 30, 60);
  if not coalesce(v_rate.allowed, false) then
    return query select 0, '[]'::jsonb;
    return;
  end if;

  -- Compute per-event intersection. An event contributes to:
  --   - aggregate: >=min_attendees attendees, not draft/archived, not private_invite
  --   - named: above AND is_sensitive = false
  with intersection as (
    select
      e.id          as event_id,
      e.slug        as event_slug,
      e.title       as event_title,
      e.starts_at,
      e.is_sensitive,
      (
        select count(*)::int
        from public.event_attendances aa
        where aa.event_id = e.id
      ) as attendee_count
    from public.event_attendances a_viewer
    join public.event_attendances a_target
      on a_target.event_id = a_viewer.event_id
     and a_target.user_id = p_target_id
    join public.events e
      on e.id = a_viewer.event_id
    where a_viewer.user_id = p_viewer_id
      and e.status not in ('draft', 'archived')
      and e.visibility <> 'private_invite'
  ),
  eligible as (
    select *
    from intersection
    where attendee_count >= c_min_attendees
  )
  select
    (select count(*)::int from eligible),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'event_id', event_id,
            'event_slug', event_slug,
            'event_title', event_title,
            'starts_at', starts_at
          )
          order by starts_at desc
        )
        from (
          select event_id, event_slug, event_title, starts_at
          from eligible
          where is_sensitive = false
          order by starts_at desc
          limit 50
        ) named_rows
      ),
      '[]'::jsonb
    )
    into v_aggregate_count, v_named_events;

  perform public.write_audit(
    'member.shared_events_view',
    p_viewer_id,
    p_target_id,
    jsonb_build_object(
      'aggregate_count', v_aggregate_count,
      'named_event_count', jsonb_array_length(v_named_events)
    )
  );

  return query select v_aggregate_count, v_named_events;
end;
$$;

revoke all on function public.shared_events_for_viewer(uuid, uuid) from public;
grant  execute on function public.shared_events_for_viewer(uuid, uuid)
  to authenticated, service_role;

comment on function public.shared_events_for_viewer(uuid, uuid) is
  'R3: returns (aggregate_count, named_events jsonb) of events both users attended. All gates fail silently to empty to prevent probing. Min attendees constant is dogfood-tuned; tighten via follow-up migration before public launch.';
