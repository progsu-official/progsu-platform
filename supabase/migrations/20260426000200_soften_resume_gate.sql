-- Migration: soften the resume step in is_fully_onboarded().
-- Historically resume was a hard gate, same tier as profile and consents.
-- Product decision 2026-04-24: resume becomes a soft requirement so users
-- can finish onboarding with "Skip for now" and upload later. Recruiter
-- exports still exclude resume-less users (recruiter_eligible_members
-- inner-joins on resumes), so the commercial guarantee is preserved — the
-- product surface just doesn't force the upload before letting them in.
--
-- Keeps hard rule #5 (CLAUDE.md): lib/auth/onboarding.ts#loadOnboardingState
-- has been updated to drop hasCurrentResume from the fullyOnboarded conjunct
-- in the same commit. smoke-onboarding-parity.ts is the merge gate.

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
        first_name, last_name, school, major, class_standing,
        grad_year, grad_term, interested_roles
      from public.profiles
      where id = p_user_id
    ),
    profile_complete as (
      select
        coalesce(
          nullif(btrim(first_name), '') is not null
          and nullif(btrim(last_name), '') is not null
          and nullif(btrim(school), '')   is not null
          and nullif(btrim(major), '')    is not null
          and class_standing is not null
          and grad_year is not null
          and nullif(btrim(grad_term), '') is not null
          and coalesce(cardinality(interested_roles), 0) > 0,
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
  'Mirror of lib/auth/onboarding.ts#loadOnboardingState. Profile fields + required consents (privacy_policy, terms_of_service, age_confirmation) at current versions. Resume is a soft requirement (skippable); recruiter_eligible_members handles the recruiter-visibility gate separately.';

revoke all on function public.is_fully_onboarded(uuid) from public;
grant  execute on function public.is_fully_onboarded(uuid) to authenticated, service_role;
