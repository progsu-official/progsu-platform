-- Extend the claim-on-first-login copy to carry guest-RSVP answers
-- (docs/16-guest-conversion §5.4).
--
-- Supersedes 20260816000200_legacy_claim_backfill.sql's version. Same
-- structure, same never-overwrite discipline; it just copies more columns now
-- that legacy_members holds the /welcome answers as well as imported data.
--
-- Consents are still NOT written here. A guest's SMS opt-in is real consent
-- and is preserved on the staging row, but promoting it into the consents
-- ledger from staging is exactly what legacy_members' own header warns
-- against. The onboarding consent step pre-checks the box instead —
-- docs/16-guest-conversion §6.2.

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

revoke all on function public.handle_new_user() from public;
