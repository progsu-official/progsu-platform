-- ============================================================================
-- Put the visibility row back in handle_new_user().
--
-- 20260820120000 flipped profile_visibility_settings.discoverable to default
-- true and added an insert to handle_new_user() so every new account gets the
-- row that default applies to. Its own comment flagged the hazard: "Body is
-- carried forward verbatim; the only addition is the visibility row."
--
-- 20260823150400_handle_new_user_guest_answers replaced the function three
-- days later and carried forward a body that predated that addition. The
-- insert went with it. Nothing failed, because a missing row is not an error
-- anywhere -- it just reads as "not discoverable" at every call site.
--
-- Cost on prod: 10 members who signed up on 2026-08-23 and 2026-08-24 are
-- absent from the directory, absent from every attendee wall, and have no
-- profile anyone can open. They are the newest cohort, which is the one most
-- likely to be looked up, and the entire RSVP list for the Fall Kickoff
-- Carnival sits inside that window.
--
-- Body below is the live definition read back out of prod with
-- pg_get_functiondef, plus the insert. Reading it back rather than reassembling
-- it from migration files is the only way to be sure the guest-answers work is
-- carried forward intact -- reassembling from files is how this broke.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );
  v_first_name text := new.raw_user_meta_data ->> 'given_name';
  v_last_name  text := new.raw_user_meta_data ->> 'family_name';
begin
  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name, ' ', 1);
  end if;
  if v_last_name is null and v_full_name is not null and position(' ' in v_full_name) > 0 then
    v_last_name := substr(v_full_name, position(' ' in v_full_name) + 1);
  end if;

  insert into public.profiles (id, google_email, first_name, last_name, avatar_url)
  values (
    new.id,
    lower(new.email)::citext,
    v_first_name,
    v_last_name,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  -- Restored. discoverable comes from the column default (true since
  -- 20260820120000); this insert exists so there is a row for that default to
  -- live on. profile_visibility_settings_mint_slug (20260824130000) fires on
  -- it and assigns the slug, so a new member is addressable from signup.
  insert into public.profile_visibility_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  update public.profiles p
  set phone_number     = coalesce(p.phone_number, lm.phone_number),
      major            = coalesce(p.major, lm.major),
      major_other_text = coalesce(p.major_other_text, lm.major_other_text),
      grad_year        = coalesce(p.grad_year, lm.grad_year),
      class_standing   = coalesce(p.class_standing, lm.class_standing),
      -- interested_roles is NOT NULL DEFAULT '{}', so "unset" is an empty
      -- array rather than NULL and coalesce would never fire.
      interested_roles = case
                           when coalesce(array_length(p.interested_roles, 1), 0) = 0
                             then coalesce(lm.interested_roles, p.interested_roles)
                           else p.interested_roles
                         end
  from public.legacy_members lm
  where p.id = new.id
    and lm.claimed_at is null
    and (lm.personal_email = lower(new.email)::citext
         or lm.campus_email = lower(new.email)::citext);

  update public.legacy_members lm
  set claimed_at = now(),
      claimed_profile_id = new.id
  where lm.claimed_at is null
    and (lm.personal_email = lower(new.email)::citext
         or lm.campus_email = lower(new.email)::citext);

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Give the regression window its rows back.
--
-- Scoped to accounts created on or after 2026-08-23 that have no row at all.
-- That is exactly the set the dropped insert would have created, and nothing
-- else: anyone who signed up before the regression already has a row, and
-- anyone holding discoverable = false chose it.
--
-- This is not the 20260820140000 question. That migration weighed publishing
-- members who joined under an opt-in policy and decided it needed member
-- notice. These 10 signed up after directory-by-default shipped, under the
-- policy that describes it, and would have been listed on the day they joined
-- if the function had been intact. Restoring that is not a new disclosure.
--
-- Same exclusion predicate as 20260820140000 so test and developer accounts
-- stay out, spelled the same way rather than by id.
-- ----------------------------------------------------------------------------
insert into public.profile_visibility_settings
  (user_id, discoverable, last_discoverability_change_at)
select p.id, true, now()
from public.profiles p
left join public.profile_visibility_settings v on v.user_id = p.id
where v.user_id is null
  and p.is_archived = false
  and p.created_at >= timestamptz '2026-08-23 00:00:00+00'
  and not (
    p.google_email::text ilike '%@example.com'
    or (
      btrim(lower(coalesce(p.first_name, ''))) = 'test'
      and btrim(lower(coalesce(p.last_name, ''))) = 'testing'
    )
  )
on conflict (user_id) do nothing;
