-- Claim-backfill: extend handle_new_user() so a first Google login also
-- checks legacy_members for a matching email and pulls in what we already
-- know about that person (currently just phone_number, the one field
-- Google OAuth never provides). Only fills phone_number if still null,
-- never overwrites. Never touches consents, each person opts in fresh here,
-- staging data never implies consent.

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
