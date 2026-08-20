-- Bump privacy_policy consent version to v4.
--
-- 20260820130000 adds two new peer-visible surfaces: a short status note
-- rendered over the avatar, and an uploaded profile banner. Both are shown to
-- any member who can view the card, which is a wider audience than the fields
-- they sit next to were described against under v3.
--
-- Per CLAUDE.md rule 8 this is a version bump rather than a new consent_type:
-- additive enum values ossify forever. The requireConsentsCurrent cascade in
-- lib/auth/onboarding.ts routes members who accepted v3 to /onboarding/consent
-- on their next page load, which is the intended behaviour.

update public.consent_versions
  set version = 'v4', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
