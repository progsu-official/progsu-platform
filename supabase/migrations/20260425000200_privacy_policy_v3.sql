-- Migration 000400 — bump privacy_policy consent version to v3 for R3.
--
-- R3 exposes shared-event history between mutually-opted-in peers. The
-- privacy implications are distinct from R2 (peer-visible profile) — R3
-- adds cross-user history inference, sensitive-event aggregate leakage,
-- and time-series polling risks. Users who accepted v2 must re-accept v3
-- before share_shared_event_counts=true takes effect.
--
-- The existing requireConsentsCurrent cascade in lib/auth/onboarding.ts
-- handles routing stale-version users to /onboarding/consent automatically.
-- set_profile_visibility() also checks at the flip boundary for the
-- share_shared_event_counts=true transition (see migration 000500).

update public.consent_versions
  set version = 'v3', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
