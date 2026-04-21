-- Migration 000007 — recruiter-eligible view + helper.
-- Single source of truth for which members belong in the recruiter CSV export.
-- Reconciliation #31 requires preview and download to query the same rows.

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
  and lc.latest_version        = cv.version;

comment on view public.recruiter_eligible_members is
  'Canonical set of members eligible for the recruiter CSV. Preview + download must both read from here (reconciliation #31). D2 column set: includes google_email, student_email, phone_number.';

-- Only service_role should query the view directly. Authenticated admins read it via
-- the RPC below so we can write an audit row.
revoke all on public.recruiter_eligible_members from public;
grant  select on public.recruiter_eligible_members to service_role;

-- Preview count helper — cheap to call; returns int. No audit row (view count
-- per admin view is noisy). Export download is the audited path.
create or replace function public.admin_recruiter_eligible_count()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin_recruiter_eligible_count: admins only' using errcode = 'P0001';
  end if;
  return (select count(*)::int from public.recruiter_eligible_members);
end;
$$;

revoke all on function public.admin_recruiter_eligible_count() from public;
grant  execute on function public.admin_recruiter_eligible_count() to authenticated, service_role;
