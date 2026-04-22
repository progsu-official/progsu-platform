-- Migration 000500 — extend set_profile_visibility with an R3 re-acceptance
-- gate on the share_shared_event_counts=true transition.
--
-- R2 already gates discoverable=true on the current privacy_policy version
-- (which is now v3 after migration 000400). R3 adds an additional gate: the
-- share_shared_event_counts flip also requires v3. This prevents a user who
-- accepted v2 and turned discoverable on under R2 from later flipping the
-- shared-events toggle without acknowledging the new disclosure.
--
-- Since privacy_policy is already at v3, the R2 gate and the R3 gate are
-- functionally identical in their SQL check. The distinction matters only
-- across time: if privacy_policy bumps to v4 later, the gate still works
-- because it always pins to the CURRENT version.
--
-- Also adds the friendlier ERR_SHARED_EVENTS_REQUIRES_DISCOVERABLE message
-- when a caller tries to flip share_shared_event_counts=true with
-- discoverable=false. The CHECK constraint would surface this as a raw
-- 23514 violation; we catch it earlier for a cleaner error.

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
  v_was_counts       boolean;
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
  v_was_counts := coalesce(v_before.share_shared_event_counts, false);

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
    v_was_counts
  );

  -- Cross-column invariant: share_shared_event_counts=true requires
  -- discoverable=true. Catch early with a friendly message before the CHECK
  -- constraint fires with its raw 23514 violation.
  if v_new_share_counts and not v_new_discoverable then
    raise exception 'set_profile_visibility: ERR_SHARED_EVENTS_REQUIRES_DISCOVERABLE'
      using errcode = 'P0001';
  end if;

  -- Re-acceptance gate on either false→true flip of discoverable OR
  -- false→true flip of share_shared_event_counts. Both surface new peer
  -- disclosure categories that warrant a privacy-policy acknowledgement.
  if (v_new_discoverable and not v_was_disc)
     or (v_new_share_counts and not v_was_counts) then
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

  -- Auto-slug on first opt-in to discoverable.
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

    if v_seed is null or length(v_seed) < 3 then
      v_seed := 'member-' || substr(
        regexp_replace(v_uid::text, '[^a-z0-9]', '', 'g'),
        1, 8
      );
    end if;

    v_initial_slug := v_seed;
    begin
      v_granted_slug := public.set_profile_slug(v_initial_slug);
    exception when others then
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

  select coalesce(version, 'unknown') into v_current_version
  from public.consent_versions
  where consent_type = 'privacy_policy'::public.consent_type_t;

  v_before_snapshot := jsonb_build_object(
    'discoverable', v_was_disc,
    'share_attended_events', coalesce(v_before.share_attended_events, false),
    'share_shared_event_counts', v_was_counts,
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
