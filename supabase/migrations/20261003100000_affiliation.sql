-- Affiliation (self-reported) + per-attendance affiliation snapshot.
--
-- profiles.affiliation is what the member tells us. It is never evidence of
-- GSU enrollment: "verified GSU" is derived only from a verified student_email
-- on student.gsu.edu (public.is_verified_gsu below), and the snapshot stores
-- both side by side so reports can tell the two apart.
--
-- Onboarding: affiliation is now a hard gate (must not be 'unknown'), and
-- school/major are required only for students (gsu_student, other_student).
-- lib/auth/onboarding.ts changes in the same commit; smoke-onboarding-parity.ts
-- is the merge gate (CLAUDE.md hard rule 5).

do $$ begin
  create type public.affiliation_t as enum (
    'gsu_student',
    'other_student',
    'nonstudent',
    'unknown'
  );
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists affiliation public.affiliation_t not null default 'unknown',
  add column if not exists institution_name text
    check (institution_name is null or length(institution_name) <= 150);

comment on column public.profiles.affiliation is
  'Self-reported affiliation. Not proof of enrollment; see public.is_verified_gsu().';
comment on column public.profiles.institution_name is
  'Self-reported school/employer name. Free text, optional.';

-- Backfill so the new gate does not bounce every existing member back into
-- onboarding. Everyone who finished onboarding before this migration was
-- required to name a school, so they self-reported as a student; the school
-- they named decides GSU vs other. Profiles with no school stay 'unknown' and
-- will be asked on their next visit.
update public.profiles
   set affiliation = case
         when school ilike 'Georgia State University%' then 'gsu_student'::public.affiliation_t
         else 'other_student'::public.affiliation_t
       end
 where affiliation = 'unknown'
   and nullif(btrim(school), '') is not null;

-- ============================================================================
-- is_verified_gsu — the only definition of "verified GSU" in the system.
-- ============================================================================
create or replace function public.is_verified_gsu(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.student_email_verified
       and lower(p.student_email_domain::text) = 'student.gsu.edu'
      from public.profiles p
     where p.id = p_user_id
  ), false);
$$;

revoke all on function public.is_verified_gsu(uuid) from public, anon, authenticated;
grant  execute on function public.is_verified_gsu(uuid) to authenticated, service_role;

-- ============================================================================
-- is_fully_onboarded — mirror of lib/auth/onboarding.ts (as of 20261003100000)
-- ============================================================================
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
        first_name, last_name, school, major, major_other_text, phone_number,
        affiliation
      from public.profiles
      where id = p_user_id
    ),
    profile_complete as (
      select
        coalesce(
          nullif(btrim(first_name),   '')   is not null
          and nullif(btrim(last_name),  '') is not null
          and nullif(btrim(phone_number), '') is not null
          and affiliation <> 'unknown'
          and (
            affiliation = 'nonstudent'
            or (
              nullif(btrim(school), '') is not null
              and nullif(btrim(major), '') is not null
              and (
                lower(btrim(major)) <> 'other'
                or nullif(btrim(major_other_text), '') is not null
              )
            )
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
  'Mirror of lib/auth/onboarding.ts#loadOnboardingState. As of 20261003100000: first_name, last_name, phone_number, affiliation <> unknown; school + major (+ major_other_text when major=other) only for students (affiliation gsu_student|other_student); + privacy_policy, terms_of_service, age_confirmation at current versions.';

revoke all on function public.is_fully_onboarded(uuid) from public, anon;
grant  execute on function public.is_fully_onboarded(uuid) to authenticated, service_role;

-- ============================================================================
-- event_attendance_affiliations — what we knew about a member at check-in.
-- One row per attendance; goes away with the attendance (FK cascade) so a
-- re-check-in takes a fresh snapshot.
-- ============================================================================
create table public.event_attendance_affiliations (
  event_id           uuid not null,
  user_id            uuid not null,
  category           public.affiliation_t not null,
  verified_gsu       boolean not null,
  institution        text,
  snapshot_at        timestamptz not null default now(),
  source             text not null check (source in ('checkin_trigger', 'officer_correction')),
  corrected_by       uuid references public.profiles(id) on delete set null,
  correction_reason  text check (correction_reason is null or length(correction_reason) between 3 and 500),
  updated_at         timestamptz not null default now(),

  constraint event_attendance_affiliations_pk primary key (event_id, user_id),
  constraint event_attendance_affiliations_attendance_fk
    foreign key (event_id, user_id)
    references public.event_attendances (event_id, user_id)
    on delete cascade,
  constraint event_attendance_affiliations_correction_pair check (
    (source = 'checkin_trigger' and correction_reason is null)
    or (source = 'officer_correction' and correction_reason is not null)
  )
);

comment on table public.event_attendance_affiliations is
  'Affiliation snapshot taken when an attendance row is inserted. category is self-reported; verified_gsu comes from is_verified_gsu(). Corrections only via admin_correct_attendance_affiliation().';

create index event_attendance_affiliations_event_idx
  on public.event_attendance_affiliations (event_id, category);

alter table public.event_attendance_affiliations enable row level security;

create policy event_attendance_affiliations_select_own
  on public.event_attendance_affiliations for select
  to authenticated
  using (auth.uid() = user_id);

create policy event_attendance_affiliations_select_admin
  on public.event_attendance_affiliations for select
  to authenticated
  using (public.is_admin(auth.uid()));

revoke insert, update, delete, truncate on public.event_attendance_affiliations
  from anon, authenticated;

create or replace function public.snapshot_attendance_affiliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_attendance_affiliations (
    event_id, user_id, category, verified_gsu, institution, source
  )
  select
    new.event_id,
    new.user_id,
    p.affiliation,
    public.is_verified_gsu(p.id),
    coalesce(nullif(btrim(p.institution_name), ''), nullif(btrim(p.school), '')),
    'checkin_trigger'
  from public.profiles p
  where p.id = new.user_id
  on conflict (event_id, user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.snapshot_attendance_affiliation() from public, anon, authenticated;

create trigger event_attendances_snapshot_affiliation
  after insert on public.event_attendances
  for each row execute function public.snapshot_attendance_affiliation();

-- Existing attendances get a snapshot of today's profile, clearly marked as
-- a backfill in the audit log rather than pretending it was taken at check-in.
insert into public.event_attendance_affiliations (
  event_id, user_id, category, verified_gsu, institution, source, snapshot_at
)
select
  a.event_id, a.user_id, p.affiliation, public.is_verified_gsu(p.id),
  coalesce(nullif(btrim(p.institution_name), ''), nullif(btrim(p.school), '')),
  'checkin_trigger', now()
from public.event_attendances a
join public.profiles p on p.id = a.user_id
on conflict do nothing;

insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
values (null, null, 'attendance_affiliation.backfill',
        jsonb_build_object('migration', '20261003100000', 'note', 'snapshot_at is backfill time, not check-in time'));

-- ============================================================================
-- admin_correct_attendance_affiliation — the only write path after insert.
-- ============================================================================
create or replace function public.admin_correct_attendance_affiliation(
  p_event_id    uuid,
  p_user_id     uuid,
  p_category    public.affiliation_t,
  p_institution text,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_before jsonb;
  v_after  jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_correct_attendance_affiliation: admin only' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'admin_correct_attendance_affiliation: reason required' using errcode = 'P0001';
  end if;

  select to_jsonb(s.*) into v_before
    from public.event_attendance_affiliations s
   where s.event_id = p_event_id and s.user_id = p_user_id
   for update;
  if v_before is null then
    raise exception 'admin_correct_attendance_affiliation: snapshot not found' using errcode = 'P0002';
  end if;

  update public.event_attendance_affiliations
     set category          = p_category,
         institution       = nullif(btrim(p_institution), ''),
         source            = 'officer_correction',
         corrected_by      = v_uid,
         correction_reason = btrim(p_reason),
         updated_at        = now()
   where event_id = p_event_id and user_id = p_user_id
  returning to_jsonb(event_attendance_affiliations.*) into v_after;

  perform public.write_audit(
    'attendance_affiliation.correct', v_uid, p_user_id,
    jsonb_build_object('event_id', p_event_id, 'before', v_before, 'after', v_after, 'reason', btrim(p_reason))
  );
end;
$$;

revoke all on function public.admin_correct_attendance_affiliation(uuid, uuid, public.affiliation_t, text, text)
  from public, anon, authenticated;
grant  execute on function public.admin_correct_attendance_affiliation(uuid, uuid, public.affiliation_t, text, text)
  to authenticated, service_role;

-- Explicit grants: do not rely on the platform's default table privileges,
-- which differ between hosted projects and newer local images.
grant select on public.event_attendance_affiliations to authenticated;
grant all    on public.event_attendance_affiliations to service_role;
