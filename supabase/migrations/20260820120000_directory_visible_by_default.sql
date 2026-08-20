-- Directory visibility defaults to on for new members.
--
-- The directory launched opt-in, which left it near-empty: a member had to
-- find /profile/settings/visibility on their own before anyone could see
-- them. New accounts now get a visibility row at signup with discoverable
-- already true, and /members carries a one-click control for anyone who is
-- still hidden.
--
-- Deliberately NOT backfilled, and deliberately seeded from the signup
-- trigger rather than by treating "no row" as visible. Every existing
-- `discoverable = false` row is someone who was shown an opt-in control and
-- left it off; every existing member with no row at all never saw a reason to
-- create one, under a privacy policy that described the directory as opt-in.
-- Flipping either group would publish their name, school, standing, and
-- interests to every member without asking. Migrating them is a separate
-- decision that ships with member notice, not a side effect of this default.

alter table public.profile_visibility_settings
  alter column discoverable set default true;

comment on column public.profile_visibility_settings.discoverable is
  'Listed in the member directory. Seeded true for accounts created on or after 2026-08-20; earlier accounts keep whatever they chose under the opt-in policy.';

-- Extends the trigger last replaced in 20260816000200_legacy_claim_backfill.
-- Body is carried forward verbatim; the only addition is the visibility row.
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

  -- New in this migration: opt the account into the directory up front. The
  -- column default carries the value, so this stays correct if the default
  -- changes again.
  insert into public.profile_visibility_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  update public.profiles p
  set phone_number = coalesce(p.phone_number, lm.phone_number)
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

revoke all on function public.handle_new_user() from public;
