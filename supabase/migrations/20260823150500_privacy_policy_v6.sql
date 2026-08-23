-- Bump privacy_policy consent version to v6.
--
-- Two changes in docs/16-guest-conversion that v5 does not describe:
--
--   1. We now collect academic data (major, graduation, role interests) from
--      people who have no account, via /welcome, and carry it onto their
--      profile if they later sign in with the same address. v5 describes the
--      profile form as something a signed-up member fills in; it does not
--      cover self-reported data arriving before signup.
--
--   2. SMS. v5 lists sms_marketing among the consent choices but says nothing
--      about frequency, rates, STOP/HELP, or — the operative one — that we do
--      not share or sell mobile opt-in data. That last line is both a real
--      commitment and a prerequisite for carrier campaign review.
--
-- Strictly, CLAUDE.md rule 8 ties bumps to new peer-visible surfaces and
-- neither of these is peer-visible: guest rows are admin-only and never appear
-- in the attendee stack. Bumping anyway. Collecting academic data from
-- non-members and opening a second contact channel is a large enough change in
-- posture that re-acceptance is the right default, and the cascade in
-- lib/auth/onboarding.ts already handles it.

update public.consent_versions
  set version = 'v6', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
