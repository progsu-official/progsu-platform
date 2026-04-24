-- Phase 4 of the low-friction-signup refactor: relax the onboarding gate.
-- Drops class_standing / grad_year / grad_term / interested_roles from the
-- hard-gate conjunct. New minimum bar:
--   first_name, last_name, school, major (+ major_other_text when 'other'),
--   phone_number, 3 consents (privacy_policy, terms_of_service,
--   age_confirmation) at current versions.
-- Everything else moves to the dashboard profile-completion ring.
--
-- Keeps CLAUDE.md rule #5 parity: lib/auth/onboarding.ts#REQUIRED_PROFILE_FIELDS
-- is updated in the same commit to match. smoke-onboarding-parity.ts is the
-- merge gate.

create or replace function public.is_fully_onboarded(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with
    p as (
      select
        first_name, last_name, school, major, major_other_text, phone_number
      from public.profiles
      where id = p_user_id
    ),
    profile_complete as (
      select
        coalesce(
          nullif(btrim(first_name),   '')   is not null
          and nullif(btrim(last_name),  '') is not null
          and nullif(btrim(school),     '') is not null
          and nullif(btrim(major),      '') is not null
          and nullif(btrim(phone_number), '') is not null
          and (
            lower(btrim(major)) <> 'other'
            or nullif(btrim(major_other_text), '') is not null
          ),
          false
        ) as ok
      from p
    ),
    required as (
      select unnest(array[
        'privacy_policy'::public.consent_type_t,
        'terms_of_service'::public.consent_type_t,
        'age_confirmation'::public.consent_type_t
      ]) as consent_type
    ),
    latest as (
      select distinct on (c.consent_type)
        c.consent_type,
        c.accepted,
        c.version
      from public.consents c
      join required r on r.consent_type = c.consent_type
      where c.user_id = p_user_id
      order by c.consent_type, c.accepted_at desc, c.id desc
    ),
    consents_ok as (
      select
        (select count(*) from required) =
        (select count(*)
           from latest l
           join public.consent_versions cv
             on cv.consent_type = l.consent_type
          where l.accepted = true
            and l.version  = cv.version
        ) as ok
    )
  select
    coalesce((select ok from profile_complete), false)
    and coalesce((select ok from consents_ok), false);
$$;

comment on function public.is_fully_onboarded(uuid) is
  'Mirror of lib/auth/onboarding.ts#loadOnboardingState. Minimum bar (as of 20260427000300): first_name, last_name, school, major, phone_number + 3 required consents at current versions. When major=''other'', major_other_text must be non-empty. Resume + grad_year + class_standing + grad_term + interested_roles are SOFT (profile-completion ring + recruiter view gate them separately).';

revoke all on function public.is_fully_onboarded(uuid) from public;
grant  execute on function public.is_fully_onboarded(uuid) to authenticated, service_role;
