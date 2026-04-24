# 14.01 — Schema Changes

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning. All migrations below are append-only per CLAUDE.md rule #2; no migration predating `20260426000200_soften_resume_gate.sql` is modified.

---

## 0. Plan-order overview

| Step | Migration | Purpose |
|---|---|---|
| A | `YYYYMMDDHHMMSS_majors_table.sql` | Lookup table + seed + RLS. |
| B | `YYYYMMDDHHMMSS_profile_major_other_text.sql` | Add `profiles.major_other_text` nullable column and check constraint. |
| C | `YYYYMMDDHHMMSS_verify_email_writes_school.sql` | RPC `verify_student_email_with_school()` or update inside existing `verifyStudentEmailCode` transaction — see §3 for the chosen path. |
| D | `YYYYMMDDHHMMSS_relax_is_fully_onboarded.sql` | New `is_fully_onboarded()` definition per new minimum bar. |
| E | `YYYYMMDDHHMMSS_recruiter_eligible_tighten.sql` | Update `recruiter_eligible_members` view to require `grad_year`, `class_standing`, `grad_term`, non-empty `interested_roles` (threshold C). |

Order rationale: A/B are independent; C depends on neither; D must come after B (because it references the new `major` shape); E can run last.

---

## 1. School auto-population on verify-email (Step C)

**Recommendation: no new migration, do this as an app-layer change inside the existing transaction in `lib/actions/verification.ts#verifyStudentEmailCode`.**

Rationale:
- The verify transaction already flips `student_email_verified`, `student_email_verified_at`, clears `pending_domain_name`, writes the audit row. Adding `school = (lookup result)` to the same UPDATE is a one-line change and keeps the atomic-writes posture.
- No trigger because triggers don't have easy access to a computed lookup without a subquery, and adding one just to avoid a one-line app change is over-engineering.
- The lookup (`student_email_domain` → `school_domains.school_name`) is already resolved server-side during `reserveStudentEmail` in `lib/actions/verification.ts`. We piggy-back on that.

SQL shape (inside the existing sql template, not a new migration — shown here for the app PR):

```sql
update public.profiles
   set student_email              = ${studentEmail},
       student_email_verified     = true,
       student_email_verified_at  = ${now},
       verification_method        = 'email_otp',
       pending_domain_name        = null,
       school                     = coalesce(
         (select sd.school_name
            from public.school_domains sd
           where sd.domain = ${domain}
             and sd.is_active = true
          limit 1),
         school
       ),
       updated_at                 = ${now}
 where id = ${user.id}
```

`coalesce(..., school)` means: if the domain isn't in the allowlist (bad data / race with admin removing a school) we leave the existing `school` alone rather than null it out. Users can still manually edit `school` in settings.

Tradeoff: this couples school-name to whatever string is in `school_domains.school_name` at verify time. If an admin later renames "Georgia State University" to "GSU" in `school_domains`, existing verified users keep the old string until they re-verify. This is fine — school name strings are display, not an identity claim.

---

## 2. `majors` lookup table (Step A)

**Recommendation: create a lookup table rather than an enum.**

Tradeoff: an enum ossifies the list (CLAUDE.md rule #8 is about `consent_type_t` specifically, but the principle applies to any enum we can't easily remove values from). A lookup table with an `is_active` flag lets us add/deprecate majors without a migration. Cost: one join in the recruiter view and a zod array built from a runtime query.

```sql
-- Migration: majors lookup + seed.
create table public.majors (
  slug        text primary key check (slug ~ '^[a-z0-9_]+$'),
  label       text not null check (length(label) between 1 and 100),
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.majors is
  'Canonical major list for profile dropdown. slug=''other'' is reserved; when picked, profiles.major_other_text is required. Admin-writable via direct update (admin-only RLS).';

create trigger majors_set_updated_at
  before update on public.majors
  for each row execute function public.set_updated_at();

alter table public.majors enable row level security;

-- RLS: authenticated read (we need it for the dropdown); only admins/service_role write.
create policy majors_select_all
  on public.majors for select
  to authenticated
  using (is_active = true);

create policy majors_admin_write
  on public.majors for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Seed (~20 common majors + 'other'). sort_order groups by college.
insert into public.majors (slug, label, sort_order) values
  -- STEM (0-99)
  ('computer_science',       'Computer Science',                        10),
  ('computer_information_systems', 'Computer Information Systems',      15),
  ('software_engineering',   'Software Engineering',                    20),
  ('data_science',           'Data Science',                            25),
  ('mathematics',             'Mathematics',                            30),
  ('physics',                'Physics',                                 35),
  ('biology',                'Biology',                                 40),
  ('chemistry',              'Chemistry',                               45),
  ('mechanical_engineering',  'Mechanical Engineering',                 50),
  ('electrical_engineering',  'Electrical Engineering',                 55),
  -- Business (100-199)
  ('finance',                'Finance',                                 100),
  ('accounting',             'Accounting',                              110),
  ('marketing',              'Marketing',                               120),
  ('economics',              'Economics',                               130),
  ('management',             'Management / Entrepreneurship',           140),
  -- Arts + social sciences (200-299)
  ('psychology',             'Psychology',                              200),
  ('political_science',      'Political Science',                       210),
  ('english',                'English / Creative Writing',              220),
  ('communications',         'Communications',                          230),
  -- Health (300-399)
  ('public_health',          'Public Health',                           300),
  ('nursing',                'Nursing',                                 310),
  -- Escape hatch
  ('other',                  'Other (tell us below)',                  9999)
on conflict (slug) do nothing;
```

---

## 3. `profiles.major` shape change (Step B)

**Recommendation: keep `profiles.major` as `text`, do NOT add an FK to `majors.slug`.**

Tradeoff: an FK gives referential integrity and cleaner typing, but requires a two-phase migration for existing data (currently 40+ rows of free-text "Computer Science" strings need to be mapped to slugs before the FK can be added), and breaks the existing recruiter export contract which ships the human-readable major string in the CSV. Keeping `major` as text means existing rows keep their current string, new users write the slug, and the app layer resolves slug → label using `majors.label`.

Practical rule going forward:
- New writes via `updateProfile` MUST set `major` to a value in `majors.slug` (validated by zod against a runtime fetch of active major slugs). "Other" → `major = 'other'` AND `major_other_text` non-null.
- Reads display `majors.label` via a left join when the value matches a slug, fall back to raw `major` string otherwise.
- Existing rows with legacy free-text strings continue to render as-is until the user touches their profile. No bulk migration.

The `major_other_text` column:

```sql
-- Migration: add major_other_text.
alter table public.profiles
  add column if not exists major_other_text text
  check (major_other_text is null or length(btrim(major_other_text)) between 1 and 100);

comment on column public.profiles.major_other_text is
  'Free-text fallback when profiles.major = ''other''. Null otherwise. Enforced by app-layer validation; no cross-column check to keep the column simple.';

-- Optional: backfill is skipped. New writes via updateProfile will normalize.
```

---

## 4. New `is_fully_onboarded()` (Step D)

Replace the function defined in `20260426000200_soften_resume_gate.sql`.

Required profile fields shrink to: `first_name`, `last_name`, `school`, `major`, `phone_number`. Remove: `class_standing`, `grad_year`, `grad_term`, `interested_roles`. Consents conjunct is unchanged (3 required types at current versions).

Special handling for `major`: if `major = 'other'` then `major_other_text` must also be non-empty. Otherwise `major` non-empty is sufficient.

```sql
create or replace function public.is_fully_onboarded(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with
    p as (
      select first_name, last_name, school, major, major_other_text, phone_number
      from public.profiles
      where id = p_user_id
    ),
    profile_complete as (
      select
        coalesce(
          nullif(btrim(first_name),   '') is not null
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
        c.consent_type, c.accepted, c.version
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
           join public.consent_versions cv on cv.consent_type = l.consent_type
          where l.accepted = true and l.version = cv.version) as ok
    )
  select
    coalesce((select ok from profile_complete), false)
    and coalesce((select ok from consents_ok), false);
$$;
```

`lib/auth/onboarding.ts` mirror change: `REQUIRED_PROFILE_FIELDS` shrinks to `["first_name", "last_name", "school", "major", "phone_number"]`. The `(p.interested_roles ?? []).length > 0` conjunct is removed. Selected columns list in the profile query shrinks accordingly. Added: when `major === 'other'`, also require `major_other_text` to be truthy (mirror the SQL special case).

`smoke-onboarding-parity.ts` scenarios must be updated in the same commit — see `06-smoke-and-e2e.md`.

---

## 5. `recruiter_eligible_members` view update (Step E)

Current join conditions (from `20260421070500_recruiter_export.sql`):
- `student_email_verified = true`
- `open_to_recruiters = true`
- `is_archived = false`
- `is_admin = false`
- active resume
- latest `recruiter_resume_sharing` consent accepted at current version

Add (threshold C):
- `grad_year is not null`
- `class_standing is not null`
- `grad_term is not null`
- `cardinality(interested_roles) > 0`
- If we have cycles to spare: also require `major` to be in `majors.slug` (non-null alone isn't enough if we want clean filtering). Recommendation: skip for now, major is already required to finish signup and filtering happens on recruiter UI not in-view.

```sql
create or replace view public.recruiter_eligible_members as
with latest_consent as (
  /* unchanged */
)
select
  /* unchanged column list */
from public.profiles p
join public.resumes r
  on r.user_id = p.id and r.is_current = true and r.status = 'active'
join latest_consent lc on lc.user_id = p.id
join public.consent_versions cv on cv.consent_type = 'recruiter_resume_sharing'
where p.student_email_verified = true
  and p.open_to_recruiters     = true
  and p.is_archived            = false
  and p.is_admin               = false
  and lc.latest_accepted       = true
  and lc.latest_version        = cv.version
  -- new threshold-C conditions:
  and p.grad_year              is not null
  and p.class_standing         is not null
  and p.grad_term              is not null
  and cardinality(p.interested_roles) > 0;
```

Grants + the `admin_recruiter_eligible_count()` helper are unchanged because the view signature doesn't change.

---

## 6. Rollback plan

No destructive operations; all five migrations are `create or replace` or additive `alter table add column`. If the refactor is reverted post-deploy:

- **Step A (majors table)**: safe to keep even if unused; drop only if/when it's clear we're not going back.
- **Step B (major_other_text column)**: safe to keep; column is nullable.
- **Step C (app-layer school write)**: revert the app code only; no schema change to roll back.
- **Step D (is_fully_onboarded)**: replay `20260426000200_soften_resume_gate.sql`'s function body in a new `create or replace` migration. App-side: revert `lib/auth/onboarding.ts`.
- **Step E (recruiter view)**: same — new migration that re-issues the view without the four threshold-C conjuncts.

Each revert is one forward migration. No `supabase db reset` needed in prod.
