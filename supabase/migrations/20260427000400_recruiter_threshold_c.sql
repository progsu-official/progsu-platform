-- Phase 5 of the low-friction-signup refactor: tighten recruiter export.
-- Adds four conjuncts to public.recruiter_eligible_members so a profile is
-- only visible to recruiters when it has the full complement of filterable
-- attributes (grad_year, class_standing, grad_term, at least one role).
--
-- Threshold C per docs/14-low-friction-signup/04-recruiter-visibility.md §2.
-- Removed conjuncts would be a roll-forward migration; no destructive DDL.

create or replace view public.recruiter_eligible_members as
with latest_consent as (
  select
    c.user_id,
    c.consent_type,
    (array_agg(c.accepted order by c.accepted_at desc, c.id desc))[1] as latest_accepted,
    (array_agg(c.version  order by c.accepted_at desc, c.id desc))[1] as latest_version
  from public.consents c
  where c.consent_type = 'recruiter_resume_sharing'
  group by c.user_id, c.consent_type
)
select
  p.id,
  p.first_name,
  p.last_name,
  p.preferred_name,
  p.google_email,
  p.student_email,
  p.phone_number,
  p.school,
  p.major,
  p.minor,
  p.class_standing,
  p.grad_year,
  p.grad_term,
  p.interested_roles,
  p.linkedin_url,
  p.github_url,
  p.portfolio_url,
  r.id        as current_resume_id,
  r.file_name as resume_file_name,
  r.storage_path as resume_storage_path,
  r.uploaded_at as resume_uploaded_at
from public.profiles p
join public.resumes r
  on r.user_id = p.id and r.is_current = true and r.status = 'active'
join latest_consent lc
  on lc.user_id = p.id
join public.consent_versions cv
  on cv.consent_type = 'recruiter_resume_sharing'
where p.student_email_verified = true
  and p.open_to_recruiters     = true
  and p.is_archived            = false
  and p.is_admin               = false
  and lc.latest_accepted       = true
  and lc.latest_version        = cv.version
  -- Threshold C: a recruiter-eligible profile must have the attributes that
  -- recruiters actually filter by. Drops ~2–5 members until they complete
  -- the profile-completion ring (docs/14-low-friction-signup/04 §4).
  and p.grad_year              is not null
  and p.class_standing         is not null
  and p.grad_term              is not null
  and cardinality(p.interested_roles) > 0;

comment on view public.recruiter_eligible_members is
  'Canonical set of members eligible for the recruiter CSV. Preview + download both read from here. As of 20260427000400 (threshold C): requires grad_year, class_standing, grad_term, at least one interested_role in addition to the existing prerequisites (verified student email, current resume, open_to_recruiters, latest recruiter_resume_sharing consent).';

-- Grants unchanged; view signature is the same.
revoke all on public.recruiter_eligible_members from public;
grant  select on public.recruiter_eligible_members to service_role;
