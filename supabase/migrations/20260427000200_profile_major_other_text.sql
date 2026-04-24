-- Phase 2 of the low-friction-signup refactor: add major_other_text.
-- When profiles.major = 'other', app + is_fully_onboarded() require this column
-- to be non-empty. Otherwise it stays null. No backfill — existing rows are
-- fine because they have real free-text majors, not 'other'.

alter table public.profiles
  add column if not exists major_other_text text
  check (
    major_other_text is null
    or length(btrim(major_other_text)) between 1 and 100
  );

comment on column public.profiles.major_other_text is
  'Free-text fallback when profiles.major = ''other''. Null otherwise. Cross-column rule (major=''other'' implies major_other_text non-empty) is enforced by app validation and is_fully_onboarded(), not a table constraint — keeps the column portable.';
