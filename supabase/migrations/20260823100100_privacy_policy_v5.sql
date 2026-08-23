-- Bump privacy_policy consent version to v5.
--
-- 20260823100000 adds a peer-visible surface the v4 policy does not describe:
-- the attendee stack on an event page, which shows that a given member is
-- going to (or attended) a given event. v4 covers the member↔event link only
-- under the optional share_attended_events toggle, and only on the member's
-- own card — the reverse view, "who is coming to this event", is new, and it
-- is visible to anonymous visitors because event pages are public.
--
-- Only faces of members with discoverable = true appear, so no field becomes
-- visible that the directory did not already publish. The new disclosure is
-- the association, not the identity.
--
-- Per CLAUDE.md rule 8 this is a version bump rather than a new consent_type:
-- additive enum values ossify forever. The requireConsentsCurrent cascade in
-- lib/auth/onboarding.ts routes members who accepted v4 to /onboarding/consent
-- on their next page load, which is the intended behaviour. Incremental cost
-- is small in practice — v4 shipped 2026-08-20 and only 7 of 203 members had
-- accepted it when this landed, so the other 196 were already headed for that
-- screen.

update public.consent_versions
  set version = 'v5', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
