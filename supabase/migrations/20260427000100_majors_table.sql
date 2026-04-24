-- Canonical majors lookup table for the profile dropdown.
-- Phase 1 of the low-friction-signup refactor (docs/14-low-friction-signup).
-- slug='other' is reserved — when selected, profiles.major_other_text must be
-- non-empty (enforced by app + is_fully_onboarded()).
-- Authenticated read (needed for the dropdown); admin-only write.

create table public.majors (
  slug        text primary key check (slug ~ '^[a-z0-9_]+$'),
  label       text not null check (length(label) between 1 and 100),
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.majors is
  'Canonical major list for profile dropdown. slug=''other'' is reserved; when picked, profiles.major_other_text is required.';

create trigger majors_set_updated_at
  before update on public.majors
  for each row execute function public.set_updated_at();

alter table public.majors enable row level security;

create policy majors_select_active
  on public.majors for select
  to authenticated
  using (is_active = true);

create policy majors_admin_write
  on public.majors for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

grant select on public.majors to authenticated;
grant all    on public.majors to service_role;

-- Seed ~22 common majors + 'other'. sort_order groups by college so the
-- dropdown reads naturally; gaps leave room for inserts without renumbering.
insert into public.majors (slug, label, sort_order) values
  -- STEM
  ('computer_science',              'Computer Science',                  10),
  ('computer_information_systems',  'Computer Information Systems',      15),
  ('software_engineering',          'Software Engineering',              20),
  ('data_science',                  'Data Science',                      25),
  ('mathematics',                   'Mathematics',                       30),
  ('statistics',                    'Statistics',                        35),
  ('physics',                       'Physics',                           40),
  ('biology',                       'Biology',                           45),
  ('chemistry',                     'Chemistry',                         50),
  ('mechanical_engineering',        'Mechanical Engineering',            55),
  ('electrical_engineering',        'Electrical Engineering',            60),
  ('civil_engineering',             'Civil Engineering',                 65),
  -- Business
  ('finance',                       'Finance',                          100),
  ('accounting',                    'Accounting',                       110),
  ('marketing',                     'Marketing',                        120),
  ('economics',                     'Economics',                        130),
  ('management',                    'Management / Entrepreneurship',    140),
  -- Arts + social sciences
  ('psychology',                    'Psychology',                       200),
  ('political_science',             'Political Science',                210),
  ('english',                       'English / Creative Writing',       220),
  ('communications',                'Communications',                   230),
  -- Health
  ('public_health',                 'Public Health',                    300),
  ('nursing',                       'Nursing',                          310),
  -- Escape hatch — keep last so it renders at the bottom of the dropdown.
  ('other',                         'Other (tell us below)',           9999)
on conflict (slug) do nothing;
