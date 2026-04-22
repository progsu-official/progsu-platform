-- Migration 000100 — R2 member-card projection.
--
-- Introduces opt-in peer-visible member cards layered on top of `profiles`.
-- Two independent switches gate every exposure:
--   1. FEATURE_MEMBER_DIRECTORY env flag (route-level kill switch).
--   2. profile_visibility_settings.discoverable (per-member opt-in).
-- Peers never read `profiles` directly — the `member_cards` SECURITY INVOKER
-- view exposes a strict allow-list, and peer access routes through
-- `member_card_for_viewer()` (SECURITY DEFINER) which enforces gates + audit.
--
-- Canon: docs/10-r2-member-card-spec.md.

-- ============================================================================
-- Table: profile_visibility_settings
-- One row per member, created lazily on first settings write.
-- Direct client writes are denied; set_profile_visibility / set_profile_slug
-- are the only mutation seams.
-- ============================================================================
create table public.profile_visibility_settings (
  user_id                        uuid primary key
                                 references public.profiles(id) on delete cascade,

  discoverable                   boolean not null default false,
  share_attended_events          boolean not null default false,
  share_shared_event_counts      boolean not null default false,  -- R3 reserved

  profile_slug                   text
                                 check (
                                   profile_slug is null
                                   or profile_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
                                 ),

  last_discoverability_change_at timestamptz,

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

comment on table public.profile_visibility_settings is
  'R2: per-member visibility controls for the member-card projection. Lazy-created on first settings write. Never modified directly by clients — use set_profile_visibility() and set_profile_slug().';

-- Global slug uniqueness only among discoverable rows. Non-discoverable rows
-- may retain their prior slug (so flipping off/on preserves the URL) without
-- colliding with a newly-discoverable member.
create unique index profile_visibility_settings_slug_discoverable_idx
  on public.profile_visibility_settings (profile_slug)
  where discoverable = true and profile_slug is not null;

-- Directory listing index: discoverable rows ordered by recency.
create index profile_visibility_settings_discoverable_idx
  on public.profile_visibility_settings (last_discoverability_change_at desc, user_id)
  where discoverable = true;

create trigger profile_visibility_settings_set_updated_at
  before update on public.profile_visibility_settings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS — self + admin SELECT; direct client writes denied.
-- ============================================================================
alter table public.profile_visibility_settings enable row level security;

create policy pvs_select_own
  on public.profile_visibility_settings for select
  to authenticated
  using (auth.uid() = user_id);

create policy pvs_select_admin
  on public.profile_visibility_settings for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy pvs_no_client_insert
  on public.profile_visibility_settings for insert
  to authenticated
  with check (false);

create policy pvs_no_client_update
  on public.profile_visibility_settings for update
  to authenticated
  using (false) with check (false);

create policy pvs_no_client_delete
  on public.profile_visibility_settings for delete
  to authenticated
  using (false);

-- ============================================================================
-- View: member_cards (SECURITY INVOKER)
-- Sanitized projection of the peer-visible allow-list. Peers must NOT query
-- this view directly — RLS on profiles is self+admin only, so direct peer
-- SELECT returns zero rows. Peer access uses member_card_for_viewer() which
-- runs SECURITY DEFINER to read past that RLS after enforcing its own gate.
-- ============================================================================
create or replace view public.member_cards
with (security_invoker = true)
as
select
  p.id                               as user_id,
  pvs.profile_slug                   as profile_slug,

  coalesce(nullif(trim(p.preferred_name), ''), p.first_name)
                                     as display_name,

  p.avatar_url                       as avatar_url,
  p.school                           as school,
  p.class_standing                   as class_standing,
  p.grad_term                        as grad_term,
  p.grad_year                        as grad_year,
  p.interested_roles                 as interested_roles,
  pvs.share_attended_events          as share_attended_events,
  pvs.last_discoverability_change_at as visible_since

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards. SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer().';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;

-- ============================================================================
-- Helpers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- can_view_member_card(viewer, target) — gate predicate.
-- Returns true iff viewer is fully onboarded AND target is discoverable AND
-- viewer is self / admin / any fully-onboarded peer. Self-view is allowed
-- even when target.discoverable is false (preview mode for the owner).
-- ----------------------------------------------------------------------------
create or replace function public.can_view_member_card(
  p_viewer_id uuid,
  p_target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_viewer_id is not null
    and p_target_id is not null
    and public.is_fully_onboarded(p_viewer_id)
    and (
      -- self preview: always allowed for the owner once onboarded
      p_viewer_id = p_target_id
      or
      -- admin bypass
      public.is_admin(p_viewer_id)
      or
      -- peer: target must be discoverable
      exists (
        select 1
        from public.profile_visibility_settings pvs
        where pvs.user_id = p_target_id
          and pvs.discoverable = true
      )
    );
$$;

revoke all on function public.can_view_member_card(uuid, uuid) from public;
grant  execute on function public.can_view_member_card(uuid, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- member_card_for_viewer(viewer, target_slug) — resolves a slug to a card row
-- if the viewer is allowed to see it. Returns empty set when not found or
-- blocked — the caller should render 404 for both cases so peers can't probe
-- slug existence. Writes audit on non-self calls.
-- ----------------------------------------------------------------------------
create or replace function public.member_card_for_viewer(
  p_viewer_id   uuid,
  p_target_slug text
)
returns setof public.member_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_is_admin  boolean;
begin
  if p_viewer_id is null or p_target_slug is null or length(trim(p_target_slug)) = 0 then
    return;
  end if;

  -- Resolve slug → user_id. Only consider discoverable rows (non-discoverable
  -- rows may retain a prior slug; we treat those as unresolvable).
  select pvs.user_id
    into v_target_id
  from public.profile_visibility_settings pvs
  where pvs.profile_slug = lower(trim(p_target_slug))
    and pvs.discoverable = true
  limit 1;

  if v_target_id is null then
    -- Slug not claimed by any discoverable member. Self-preview note: an
    -- opted-out owner reaching their old slug also gets nothing here —
    -- they should use /dashboard/settings to preview instead.
    return;
  end if;

  if not public.can_view_member_card(p_viewer_id, v_target_id) then
    return;
  end if;

  -- Audit non-self views. Self-views are preview-only and not logged.
  if p_viewer_id <> v_target_id then
    v_is_admin := public.is_admin(p_viewer_id);
    perform public.write_audit(
      'member.card_view',
      p_viewer_id,
      v_target_id,
      jsonb_build_object(
        'slug', p_target_slug,
        'is_admin', v_is_admin
      )
    );
  end if;

  return query
    select *
    from public.member_cards
    where user_id = v_target_id;
end;
$$;

revoke all on function public.member_card_for_viewer(uuid, text) from public;
grant  execute on function public.member_card_for_viewer(uuid, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- member_card_attended_events_for_viewer(viewer, target) — returns attended
-- events the target opted to share. Filters out sensitive + private-invite +
-- draft. Requires can_view_member_card(viewer, target) AND target has
-- share_attended_events = true. Audited on non-self calls.
-- ----------------------------------------------------------------------------
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
  order by a.checked_in_at desc nulls last, e.starts_at desc;

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

revoke all on function public.member_card_attended_events_for_viewer(uuid, uuid) from public;
grant  execute on function public.member_card_attended_events_for_viewer(uuid, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- list_member_cards(viewer, cursor_ts, cursor_user, limit, search) — paged
-- directory. No audit (would be one row per render and dominate the log).
-- Ordering: last_discoverability_change_at desc, user_id asc (tiebreaker).
-- Cursor caller passes the (ts, user_id) of the last row seen; we return
-- strictly newer rows.
-- Search: lowercase name prefix match against display_name — simple ILIKE.
-- ----------------------------------------------------------------------------
create or replace function public.list_member_cards(
  p_viewer_id   uuid,
  p_cursor_ts   timestamptz default null,
  p_cursor_user uuid        default null,
  p_limit       int         default 24,
  p_search      text        default null
)
returns setof public.member_cards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit  int := greatest(1, least(coalesce(p_limit, 24), 100));
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  if p_viewer_id is null then
    return;
  end if;
  if not public.is_fully_onboarded(p_viewer_id) then
    return;
  end if;

  return query
  select mc.*
  from public.member_cards mc
  where (
    p_cursor_ts is null
    or mc.visible_since < p_cursor_ts
    or (mc.visible_since = p_cursor_ts and mc.user_id > coalesce(p_cursor_user, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  and (
    v_search is null
    or lower(mc.display_name) like v_search || '%'
  )
  order by mc.visible_since desc nulls last, mc.user_id asc
  limit v_limit;
end;
$$;

revoke all on function public.list_member_cards(uuid, timestamptz, uuid, int, text) from public;
grant  execute on function public.list_member_cards(uuid, timestamptz, uuid, int, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- set_profile_slug(desired) — self-only slug claim/rename.
-- Returns the granted slug (may differ on first opt-in if collision forces a
-- suffix). Collision on rename raises instead of silently suffixing.
-- ----------------------------------------------------------------------------
create or replace function public.set_profile_slug(p_desired_slug text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_normalized   text;
  v_current      text;
  v_is_discoverable boolean;
  v_taken        boolean;
  v_candidate    text;
  v_attempt      int := 0;
  v_suffix       text;
begin
  if v_uid is null then
    raise exception 'set_profile_slug: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.is_fully_onboarded(v_uid) then
    raise exception 'set_profile_slug: not fully onboarded' using errcode = 'P0001';
  end if;

  v_normalized := lower(trim(coalesce(p_desired_slug, '')));

  if v_normalized !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'set_profile_slug: slug must be 3-40 chars, lowercase alphanumeric and dashes, not starting/ending with a dash'
      using errcode = 'P0001';
  end if;

  -- Ensure a row exists so the update below has a target.
  insert into public.profile_visibility_settings (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select profile_slug, discoverable
    into v_current, v_is_discoverable
  from public.profile_visibility_settings
  where user_id = v_uid;

  if v_current = v_normalized then
    return v_current;
  end if;

  -- Rename path: not-yet-discoverable users get suffix fallback; already
  -- discoverable users must pick a unique slug or the call fails explicitly.
  loop
    v_candidate := case
      when v_attempt = 0 then v_normalized
      else v_normalized || '-' || v_suffix
    end;

    select exists (
      select 1
      from public.profile_visibility_settings other
      where other.profile_slug = v_candidate
        and other.discoverable = true
        and other.user_id <> v_uid
    )
      into v_taken;

    if not v_taken then
      update public.profile_visibility_settings
        set profile_slug = v_candidate
        where user_id = v_uid;

      perform public.write_audit(
        'member.slug_set',
        v_uid,
        v_uid,
        jsonb_build_object(
          'slug', v_candidate,
          'previous_slug', v_current,
          'attempts', v_attempt + 1
        )
      );
      return v_candidate;
    end if;

    if v_is_discoverable then
      raise exception 'set_profile_slug: slug is taken'
        using errcode = 'P0001';
    end if;

    v_attempt := v_attempt + 1;
    if v_attempt > 5 then
      raise exception 'set_profile_slug: could not find an available slug, pick a different name'
        using errcode = 'P0001';
    end if;

    -- 4-char base36 suffix. Postgres doesn't have a stock base36 helper, so
    -- we take the tail of a uuid and keep only alphanumerics, then slice.
    v_suffix := substr(
      regexp_replace(gen_random_uuid()::text, '[^a-z0-9]', '', 'g'),
      1, 4
    );
  end loop;
end;
$$;

revoke all on function public.set_profile_slug(text) from public;
grant  execute on function public.set_profile_slug(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- set_profile_visibility(payload jsonb) — self-only settings upsert.
-- Payload keys: discoverable, share_attended_events, share_shared_event_counts.
-- Only keys present in the payload are updated (coalesce merge).
-- On transition discoverable=false → true, verifies the caller's latest
-- privacy_policy consent matches the current version; raises P0001 'REACCEPT_PRIVACY'
-- if stale so the UI can route through the re-acceptance flow.
-- Auto-generates a slug on first opt-in.
-- ----------------------------------------------------------------------------
create or replace function public.set_profile_visibility(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_current_version  text;
  v_latest_version   text;
  v_latest_accepted  boolean;
  v_before           record;
  v_new_discoverable boolean;
  v_new_share_att    boolean;
  v_new_share_counts boolean;
  v_was_disc         boolean;
  v_seed             text;
  v_initial_slug     text;
  v_granted_slug     text;
  v_after_snapshot   jsonb;
  v_before_snapshot  jsonb;
begin
  if v_uid is null then
    raise exception 'set_profile_visibility: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.is_fully_onboarded(v_uid) then
    raise exception 'set_profile_visibility: not fully onboarded' using errcode = 'P0001';
  end if;

  -- Ensure a row exists for clean before/after reads.
  insert into public.profile_visibility_settings (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select
    discoverable,
    share_attended_events,
    share_shared_event_counts,
    profile_slug
    into v_before
  from public.profile_visibility_settings
  where user_id = v_uid;

  v_was_disc := coalesce(v_before.discoverable, false);

  -- Merge: only keys present in payload are used; fallback is the current row.
  v_new_discoverable := coalesce(
    (p_payload->>'discoverable')::boolean,
    v_was_disc
  );
  v_new_share_att := coalesce(
    (p_payload->>'share_attended_events')::boolean,
    v_before.share_attended_events
  );
  v_new_share_counts := coalesce(
    (p_payload->>'share_shared_event_counts')::boolean,
    v_before.share_shared_event_counts
  );

  -- Re-acceptance gate on the false→true flip of discoverable.
  if v_new_discoverable and not v_was_disc then
    select version
      into v_current_version
    from public.consent_versions
    where consent_type = 'privacy_policy'::public.consent_type_t;

    select accepted, version
      into v_latest_accepted, v_latest_version
    from public.consents
    where user_id = v_uid
      and consent_type = 'privacy_policy'::public.consent_type_t
    order by accepted_at desc, id desc
    limit 1;

    if v_latest_version is distinct from v_current_version
       or coalesce(v_latest_accepted, false) = false then
      raise exception 'set_profile_visibility: REACCEPT_PRIVACY'
        using errcode = 'P0001';
    end if;
  end if;

  -- Auto-slug on first opt-in if none is set.
  if v_new_discoverable and v_before.profile_slug is null then
    select
      nullif(
        regexp_replace(
          lower(
            coalesce(nullif(trim(p.preferred_name), ''), p.first_name, '') ||
            '-' ||
            coalesce(p.last_name, '')
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-'
      )
      into v_seed
    from public.profiles p
    where p.id = v_uid;

    v_seed := trim(both '-' from coalesce(v_seed, ''));
    v_seed := left(v_seed, 40);

    -- Fallback when the name produces nothing legible.
    if v_seed is null or length(v_seed) < 3 then
      v_seed := 'member-' || substr(
        regexp_replace(v_uid::text, '[^a-z0-9]', '', 'g'),
        1, 8
      );
    end if;

    -- Claim via set_profile_slug's collision logic. We call it directly
    -- because it also writes the slug-set audit row. It handles the seed
    -- being already-taken by suffixing (since discoverable is still false
    -- during this write).
    v_initial_slug := v_seed;
    begin
      v_granted_slug := public.set_profile_slug(v_initial_slug);
    exception when others then
      -- Extremely unlikely (>5 collision retries), but fall back to uuid
      -- path to avoid blocking the opt-in.
      v_granted_slug := 'member-' || substr(
        regexp_replace(v_uid::text, '[^a-z0-9]', '', 'g'),
        1, 8
      );
      update public.profile_visibility_settings
        set profile_slug = v_granted_slug
        where user_id = v_uid;
    end;
  end if;

  update public.profile_visibility_settings
  set
    discoverable               = v_new_discoverable,
    share_attended_events      = v_new_share_att,
    share_shared_event_counts  = v_new_share_counts,
    last_discoverability_change_at = case
      when v_new_discoverable is distinct from v_was_disc then now()
      else last_discoverability_change_at
    end
  where user_id = v_uid;

  -- Audit with before/after + current privacy version for traceability.
  select coalesce(version, 'unknown') into v_current_version
  from public.consent_versions
  where consent_type = 'privacy_policy'::public.consent_type_t;

  v_before_snapshot := jsonb_build_object(
    'discoverable', v_was_disc,
    'share_attended_events', coalesce(v_before.share_attended_events, false),
    'share_shared_event_counts', coalesce(v_before.share_shared_event_counts, false),
    'profile_slug', v_before.profile_slug
  );
  v_after_snapshot := jsonb_build_object(
    'discoverable', v_new_discoverable,
    'share_attended_events', v_new_share_att,
    'share_shared_event_counts', v_new_share_counts
  );

  perform public.write_audit(
    'member.visibility_changed',
    v_uid,
    v_uid,
    jsonb_build_object(
      'before', v_before_snapshot,
      'after', v_after_snapshot,
      'privacy_version', v_current_version
    )
  );
end;
$$;

revoke all on function public.set_profile_visibility(jsonb) from public;
grant  execute on function public.set_profile_visibility(jsonb)
  to authenticated, service_role;
