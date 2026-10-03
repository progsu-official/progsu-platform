-- Bump terms_of_service to v2 (CLAUDE.md hard rule 8). Eligibility now
-- covers anyone 18+ (other-school students and non-students included) to
-- match the v8 affiliation model, and sign-in covers Apple as well as Google.

update public.consent_versions
  set version = 'v2', updated_at = now()
  where consent_type = 'terms_of_service'::public.consent_type_t;
