-- Migration 000200 — bump privacy_policy consent version to v2 for R2.
--
-- R2 introduces the opt-in member directory, which adds peer-visible fields
-- to an otherwise self+admin-only privacy model. Per plan §8.4 every user
-- must re-accept before any card becomes discoverable. The existing
-- onboarding cascade (requireConsentsCurrent in lib/auth/onboarding.ts)
-- already detects stale versions and routes through /onboarding/consent, so
-- bumping the version here is the whole mechanism — no new UI required.
--
-- set_profile_visibility() (migration 000100) also enforces v2 at the flip
-- boundary: flipping discoverable=true with a stale version raises
-- REACCEPT_PRIVACY.

update public.consent_versions
  set version = 'v2', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
