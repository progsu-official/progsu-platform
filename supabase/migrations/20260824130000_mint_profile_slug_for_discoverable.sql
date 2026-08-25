-- ============================================================================
-- Every discoverable member gets an address.
--
-- set_profile_visibility() already mints a slug on first opt-in to
-- discoverable (20260425000300), seeded from first + last name. Nothing was
-- wrong with that path. The gap is that 20260820140000 -- the deliberate
-- "list every existing member in the directory" backfill -- flipped
-- discoverable straight in SQL for 164 members and never went through it.
--
-- So prod carries 202 discoverable members and 39 slugs. The other 164 are
-- listed in the directory and stacked onto every event they attended, and
-- nothing can link to them: list_member_cards() returns the row,
-- member_card_for_viewer() takes a slug, and they have no slug to take.
--
-- Symptom that surfaced it: the attendee wall on an event page renders a face
-- as <a> when it has a slug and <span> when it doesn't, so four fifths of the
-- crowd was inert with no visible reason.
--
-- The slug minted here is display_name + a 4-char base36 suffix, NOT the
-- first-last that set_profile_visibility() uses, and the difference is
-- deliberate. member_cards.display_name is coalesce(preferred_name,
-- first_name) with no last_name by design, so peers see first names only. A
-- member who opts in through settings performs an act and gets a slug derived
-- from their own full name. These 164 performed no act -- the backfill listed
-- them -- so minting 'abel-moges' would push 164 last names into peer-visible
-- URLs on the back of a decision nobody made. 'abel-7c2f' discloses exactly
-- what the card already shows. Anyone who wants their full name in the URL can
-- still claim it: set_profile_slug() is untouched, and the trigger below never
-- overwrites a slug that is already set.
--
-- The suffix also means a mint never has to fight the 39 hand-picked slugs for
-- a name; the retry loop below is a safety net, not the normal path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- mint_profile_slug(user_id) -> a slug that is free right now.
--
-- Pure with respect to profile_visibility_settings.profile_slug for the target
-- row: it reads profiles for the name and the unique-index domain for
-- collisions, so a BEFORE trigger can call it on a row that does not exist yet.
-- Does not write. Callers assign the result.
-- ----------------------------------------------------------------------------
create or replace function public.mint_profile_slug(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base      text;
  v_candidate text;
  v_suffix    text;
  v_attempt   int := 0;
begin
  select
    -- Same expression as member_cards.display_name. If that view's definition
    -- ever changes, this follows it, or slugs start describing a name peers
    -- cannot see.
    coalesce(nullif(trim(p.preferred_name), ''), p.first_name, '')
    into v_base
  from public.profiles p
  where p.id = p_user_id;

  v_base := trim(both '-' from regexp_replace(lower(coalesce(v_base, '')), '[^a-z0-9]+', '-', 'g'));
  -- 34 leaves room for '-' + 4 inside set_profile_slug()'s 40-char ceiling, so
  -- a minted slug is always something the member could have typed themselves.
  v_base := left(v_base, 34);
  v_base := trim(both '-' from v_base);
  -- Names that survive none of that: a single initial, or a handle written
  -- entirely in a non-Latin script.
  if v_base = '' then
    v_base := 'member';
  end if;

  loop
    v_suffix := substr(
      regexp_replace(gen_random_uuid()::text, '[^a-z0-9]', '', 'g'),
      1, 4
    );
    v_candidate := v_base || '-' || v_suffix;

    -- Mirrors profile_visibility_settings_slug_discoverable_idx exactly: the
    -- unique index only covers discoverable rows with a non-null slug, so a
    -- slug parked on a hidden profile is not a conflict.
    if not exists (
      select 1
      from public.profile_visibility_settings other
      where other.profile_slug = v_candidate
        and other.discoverable = true
        and other.user_id is distinct from p_user_id
    ) then
      return v_candidate;
    end if;

    v_attempt := v_attempt + 1;
    if v_attempt > 8 then
      raise exception 'mint_profile_slug: no free slug for % after % attempts', p_user_id, v_attempt
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

comment on function public.mint_profile_slug(uuid) is
  'Generates a free profile slug for a user from their card display name plus a random 4-char suffix. Read-only; the caller assigns it. Deliberately excludes last_name, which member_cards does not expose.';

revoke all on function public.mint_profile_slug(uuid) from public;
grant  execute on function public.mint_profile_slug(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Keep it true going forward.
--
-- BEFORE INSERT OR UPDATE rather than a backfill job: the gap opened because
-- becoming discoverable and having an address were separate events in time.
-- Closing it at the write is the only version that cannot drift again.
-- ----------------------------------------------------------------------------
create or replace function public.trg_mint_profile_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.discoverable is true and new.profile_slug is null then
    new.profile_slug := public.mint_profile_slug(new.user_id);
  end if;
  return new;
end;
$$;

comment on function public.trg_mint_profile_slug() is
  'BEFORE INSERT/UPDATE on profile_visibility_settings: a row that is discoverable always leaves with a slug. Never overwrites one that is already set, so set_profile_slug() renames pass through untouched.';

drop trigger if exists profile_visibility_settings_mint_slug on public.profile_visibility_settings;
create trigger profile_visibility_settings_mint_slug
  before insert or update on public.profile_visibility_settings
  for each row
  execute function public.trg_mint_profile_slug();

-- ----------------------------------------------------------------------------
-- Backfill the 164.
--
-- Row at a time, not one set-based UPDATE: mint_profile_slug() checks for
-- collisions by reading the table, and a single statement cannot see the rows
-- it is itself writing. Two members named the same thing would draw candidates
-- against identical snapshots and only the index would catch it.
-- ----------------------------------------------------------------------------
do $$
declare
  r       record;
  v_slug  text;
  v_count int := 0;
begin
  for r in
    select user_id
    from public.profile_visibility_settings
    where discoverable = true
      and profile_slug is null
    order by user_id
  loop
    v_slug := public.mint_profile_slug(r.user_id);
    update public.profile_visibility_settings
      set profile_slug = v_slug
      where user_id = r.user_id;
    v_count := v_count + 1;
  end loop;

  raise notice 'minted % profile slugs', v_count;
end;
$$;
