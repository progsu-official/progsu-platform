-- handle_new_user()'s plain email-match fallback copies phone/major/grad_year/
-- class_standing/interested_roles from a matched legacy_members row, but never
-- copied campus_email -> student_email/school, even when it's sitting right on
-- the same matched row. Only claim_guest_identity() (the token-bridge path,
-- 20260823160000_claim_guest_by_token.sql) did that. Not a deliberate split —
-- the school-linking logic was added later and only wired into the newer
-- function. This brings the plain fallback up to the same behavior, with the
-- same "don't seed an email someone else already verified" safety check.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name  text := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );
  v_first_name text := new.raw_user_meta_data ->> 'given_name';
  v_last_name  text := new.raw_user_meta_data ->> 'family_name';
  v_email      citext := lower(new.email)::citext;
  v_lm         record;
  v_domain     citext;
  v_school     text;
  v_taken      boolean := false;
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
    v_email,
    v_first_name,
    v_last_name,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  select * into v_lm
  from public.legacy_members lm
  where lm.claimed_at is null
    and (lm.personal_email = v_email or lm.campus_email = v_email)
  limit 1;

  if v_lm.id is not null then
    if v_lm.campus_email is not null then
      v_domain := split_part(v_lm.campus_email::text, '@', 2);
      select d.school_name into v_school
        from public.school_domains d
       where d.domain = v_domain and d.is_active;
      select exists (
        select 1 from public.profiles p
        where p.student_email = v_lm.campus_email and p.student_email_verified
      ) into v_taken;
    end if;

    update public.profiles p
    set phone_number     = coalesce(p.phone_number, v_lm.phone_number),
        major            = coalesce(p.major, v_lm.major),
        major_other_text = coalesce(p.major_other_text, v_lm.major_other_text),
        grad_year        = coalesce(p.grad_year, v_lm.grad_year),
        class_standing   = coalesce(p.class_standing, v_lm.class_standing),
        interested_roles = case
                             when coalesce(array_length(p.interested_roles, 1), 0) = 0
                               then coalesce(v_lm.interested_roles, p.interested_roles)
                             else p.interested_roles
                           end,
        -- Unverified on purpose: pre-fills /onboarding/verify-email so the
        -- person only has to enter the OTP code, never the address.
        student_email    = case
                              when v_school is not null and not v_taken
                                then coalesce(p.student_email, v_lm.campus_email)
                              else p.student_email
                            end,
        school           = case
                              when v_school is not null and not v_taken
                                then coalesce(p.school, v_school)
                              else p.school
                            end
    where p.id = new.id;

    update public.legacy_members
    set claimed_at = now(),
        claimed_profile_id = new.id
    where id = v_lm.id;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
