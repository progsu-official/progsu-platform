-- Bump privacy_policy consent version to v7.
--
-- Why: docs/18-discord-rsvp-alerts.md ships an announcement that posts into a
-- channel the entire Progsu Discord can read. When a member RSVPs, the channel
-- sees their first name, their last initial, and which event they are going
-- to — and, when they arrived through a campaign link, which flyer or post
-- brought them.
--
-- That is CLAUDE.md hard rule #8 twice over:
--
--   1. It is a new peer-visible surface. v5 covers the attendee stack on an
--      event page and ties it to the directory-visibility toggle; nothing in
--      v6 covers a name being announced somewhere the member never navigated
--      to and cannot see a setting for.
--
--   2. It crosses the line docs/17-campaign-links.md §3 draws around campaign
--      attribution. referral_link_hits still has no user column and still
--      never will — but the announcement puts a person and a campaign in the
--      same sentence, which is exactly the join that table refuses to store.
--      Structural refusal in the database does not cover a message we compose
--      in application code, so this is the consent that has to cover it.
--
-- FEATURE_DISCORD_RSVP_ALERTS ships false. It must stay false until this
-- cascade has actually run and members have re-accepted — the flag is the
-- kill switch, this row is the permission.

update public.consent_versions
  set version = 'v7', updated_at = now()
  where consent_type = 'privacy_policy'::public.consent_type_t;
