-- Bump privacy_policy to v8 (CLAUDE.md hard rule 8).
--
-- New data surfaces covered by the v8 policy text (app/privacy/page.tsx):
-- self-reported affiliation and the per-check-in affiliation snapshot, the
-- points ledger, per-event staff scanning by members (a staff member sees an
-- attendee's name at the door), the announcements feed, push notification
-- device tokens, Apple Wallet passes, the Hacklanta event guide and the link
-- between a Progsu account and a Hacklanta application, and in-app account
-- deletion. Also corrects v7 copy: phone number is required, and consent
-- records are deleted with the account.

update public.consent_versions
  set version = 'v8', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
