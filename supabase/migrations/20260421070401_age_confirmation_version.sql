-- Migration 000006 — seed v1 version for age_confirmation. Must be in its own migration
-- because ALTER TYPE ADD VALUE doesn't make the new label usable until the outer
-- transaction commits.

insert into public.consent_versions (consent_type, version) values
  ('age_confirmation', 'v1')
on conflict (consent_type) do nothing;
