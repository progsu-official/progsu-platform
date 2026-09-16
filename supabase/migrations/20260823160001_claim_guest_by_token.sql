-- Tie a guest registration to the Google account made right after it, by
-- token rather than by matching email addresses (docs/16-guest-conversion).
--
-- The guest form now asks for a SCHOOL email; Google sign-in supplies a
-- personal one. That is the point — two complementary addresses on one
-- profile — but it breaks the existing claim mechanism, which compares the
-- Google address against legacy_members.personal_email / campus_email. Give us
-- a .edu on the form and a gmail from OAuth and nothing matches, so the
-- account gets created with none of the data we just collected and the whole
-- "we already filled this in for you" pitch quietly fails.
--
-- Fixed by carrying the guest's claim_token across the OAuth round trip in a
-- short-lived cookie and linking explicitly on the way back. Email matching in
-- handle_new_user() stays as the fallback for everyone who signs in with the
-- same address they registered with, and for the pre-launch Luma imports it
-- was written for.

-- ============================================================================
-- upsert_guest_identity — route the address to the column that fits it.
--
-- Rewritten away from ON CONFLICT: which unique index applies now depends on
-- whether the address is an allowlisted school domain, and a conditional
-- conflict target is worse to read than an explicit lookup.
-- ============================================================================
create or replace function public.upsert_guest_identity(
  p_name             text,
  p_email            citext,
  p_phone            text,
  p_source_detail    text,
  p_sms_opt_in       boolean default false,
  p_sms_consent_copy text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first     text := split_part(trim(p_name), ' ', 1);
  v_last      text := case
                        when position(' ' in trim(p_name)) > 0
                          then substr(trim(p_name), position(' ' in trim(p_name)) + 1)
                        else null
                      end;
  v_e164      text := public.normalize_phone_e164(p_phone);
  v_domain    citext := split_part(p_email::text, '@', 2);
  v_is_campus boolean := exists (
    select 1 from public.school_domains d
    where d.domain = v_domain and d.is_active
  );
  v_consent_at timestamptz := case when p_sms_opt_in then now() else null end;
  v_consent    text := case when p_sms_opt_in then p_sms_consent_copy else null end;
  v_id        uuid;
begin
  select id into v_id
  from public.legacy_members
  where personal_email = p_email or campus_email = p_email
  limit 1;

  if v_id is null then
    insert into public.legacy_members
      (full_name, first_name, last_name,
       personal_email, campus_email,
       phone_number, phone_e164, source, source_detail,
       sms_consent_at, sms_consent_copy)
    values
      (trim(p_name), v_first, v_last,
       case when v_is_campus then null else p_email end,
       case when v_is_campus then p_email else null end,
       p_phone, v_e164, 'guest_rsvp', p_source_detail,
       v_consent_at, v_consent)
    returning id into v_id;
    return v_id;
  end if;

  -- Never clobber richer data already on file: a Luma import row's real full
  -- name beats a guest form's typing, and an SMS consent already given is
  -- never downgraded to NULL (withdrawal is STOP, which lands in
  -- sms_suppressions).
  update public.legacy_members lm
  set full_name        = coalesce(lm.full_name, trim(p_name)),
      first_name       = coalesce(lm.first_name, v_first),
      last_name        = coalesce(lm.last_name, v_last),
      personal_email   = case when v_is_campus then lm.personal_email
                              else coalesce(lm.personal_email, p_email) end,
      campus_email     = case when v_is_campus then coalesce(lm.campus_email, p_email)
                              else lm.campus_email end,
      phone_number     = coalesce(lm.phone_number, p_phone),
      phone_e164       = coalesce(lm.phone_e164, v_e164),
      sms_consent_at   = coalesce(lm.sms_consent_at, v_consent_at),
      sms_consent_copy = coalesce(lm.sms_consent_copy, v_consent)
  where lm.id = v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_guest_identity(text, citext, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.upsert_guest_identity(text, citext, text, text, boolean, text)
  to service_role;

-- ============================================================================
-- claim_guest_identity — called once, by the authenticated user, immediately
-- after OAuth returns. Idempotent: a replayed cookie is a no-op.
-- ============================================================================
create or replace function public.claim_guest_identity(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     citext;
  v_name      text;
  v_phone     text;
  v_slug      text;
  v_lm        record;
  v_domain    citext;
  v_school    text;
  v_taken     boolean;
begin
  if v_uid is null then
    raise exception 'claim_guest_identity: unauthenticated' using errcode = 'P0001';
  end if;

  select g.email, g.name, g.phone, e.slug
    into v_email, v_name, v_phone, v_slug
  from public.event_guest_rsvps g
  join public.events e on e.id = g.event_id
  where g.claim_token = p_token;

  if v_email is null then
    return false;
  end if;

  perform public.upsert_guest_identity(v_name, v_email, v_phone, v_slug);

  select * into v_lm
  from public.legacy_members
  where personal_email = v_email or campus_email = v_email
  limit 1;

  if v_lm is null then
    return false;
  end if;

  -- Already linked to somebody. Do not re-point it: the first claim wins, and
  -- silently moving an identity between accounts is how one person ends up
  -- with another's phone number.
  if v_lm.claimed_at is not null and v_lm.claimed_profile_id is distinct from v_uid then
    return false;
  end if;

  v_domain := split_part(v_email::text, '@', 2);
  select d.school_name into v_school
  from public.school_domains d
  where d.domain = v_domain and d.is_active;

  -- Only carry the school address over if nobody has already VERIFIED it.
  -- Unverified duplicates are permitted by profiles_student_email_verified_idx,
  -- but seeding one that can never pass OTP just leaves a confusing dead end.
  select exists (
    select 1 from public.profiles p
    where p.student_email = v_email and p.student_email_verified and p.id <> v_uid
  ) into v_taken;

  update public.profiles p
  set first_name    = coalesce(p.first_name, v_lm.first_name),
      last_name     = coalesce(p.last_name, v_lm.last_name),
      phone_number  = coalesce(p.phone_number, v_lm.phone_number),
      -- Unverified on purpose. This pre-fills /onboarding/verify-email so the
      -- person only has to enter the code, never the address.
      student_email = case
                        when v_school is not null and not v_taken
                          then coalesce(p.student_email, v_email)
                        else p.student_email
                      end,
      school        = case
                        when v_school is not null and not v_taken
                          then coalesce(p.school, v_school)
                        else p.school
                      end,
      major            = coalesce(p.major, v_lm.major),
      major_other_text = coalesce(p.major_other_text, v_lm.major_other_text),
      grad_year        = coalesce(p.grad_year, v_lm.grad_year),
      class_standing   = coalesce(p.class_standing, v_lm.class_standing),
      interested_roles = case
                           when coalesce(array_length(p.interested_roles, 1), 0) = 0
                             then coalesce(v_lm.interested_roles, p.interested_roles)
                           else p.interested_roles
                         end
  where p.id = v_uid;

  update public.legacy_members
  set claimed_at = coalesce(claimed_at, now()),
      claimed_profile_id = v_uid
  where id = v_lm.id;

  perform public.write_audit(
    'guest.identity_claimed', v_uid, v_uid,
    jsonb_build_object('event_slug', v_slug, 'school_email_linked', v_school is not null and not v_taken)
  );

  return true;
end;
$$;

revoke all on function public.claim_guest_identity(uuid) from public, anon;
grant execute on function public.claim_guest_identity(uuid) to authenticated, service_role;

-- ============================================================================
-- submit_guest_answers is retired. The three questions it backed are gone from
-- /welcome — they duplicated the profile completion ring, which is where they
-- belong and where they already existed. The legacy_members columns stay: the
-- master-sheet importer writes them, and claim_guest_identity above still
-- carries them onto a profile.
-- ============================================================================
drop function if exists public.submit_guest_answers(
  uuid, text, text, integer, public.class_standing_t, public.interested_role_t[], boolean, text
);
