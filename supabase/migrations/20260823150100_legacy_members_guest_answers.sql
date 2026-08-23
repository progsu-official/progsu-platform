-- legacy_members becomes the pre-signup identity table (docs/16-guest-conversion §4.1).
--
-- It was built for pre-launch data imported from Luma/Sheets/Tally, but it
-- already has everything the guest-conversion flow needs: a unique email key,
-- phone_number, claimed_at / claimed_profile_id, a `source` discriminator, an
-- admin surface, and — the reason we extend it rather than build a sibling —
-- automatic claim-on-first-login inside handle_new_user()
-- (20260816000200_legacy_claim_backfill.sql).
--
-- The merge behaviour is the point: a guest who was already in the Luma import
-- lands on their existing row via legacy_members_personal_email_idx instead of
-- forking a second pre-signup identity for the same human.
--
-- Accepted cost: the table name is now a misnomer. It means "pre-signup
-- identity, any provenance", not "imported legacy data". Renaming a shipped
-- table is churn; the comment below carries the correction instead.

alter table public.legacy_members
  add column if not exists major            text,
  add column if not exists major_other_text text,
  add column if not exists grad_year        integer,
  add column if not exists class_standing   public.class_standing_t,
  add column if not exists interested_roles public.interested_role_t[] not null default '{}',
  add column if not exists phone_e164       text,
  add column if not exists sms_consent_at   timestamptz,
  add column if not exists sms_consent_copy text,
  add column if not exists answered_at      timestamptz;

comment on table public.legacy_members is
  'Pre-signup identity staging, any provenance (see `source`): pre-launch Luma/Sheets imports and self-reported guest-RSVP answers alike. Matched to profiles by email at first Google login by handle_new_user(), never inserted into profiles directly. Named "legacy" for historical reasons; see docs/16-guest-conversion §4.1.';

comment on column public.legacy_members.sms_consent_at is
  'When this person ticked the SMS opt-in as a guest, with the exact copy shown preserved in sms_consent_copy. Evidence for carrier review. NOT auto-promoted into the consents ledger at claim time — see docs/16-guest-conversion §6.2.';

comment on column public.legacy_members.answered_at is
  'When the /welcome questions were completed. NULL = row exists from an import or an unanswered guest RSVP.';

comment on column public.legacy_members.phone_e164 is
  'Canonical form of phone_number for this staging row. Plain column, not generated: rows here are written by helpers that already normalize, and legacy imports carry numbers we would rather leave untouched in phone_number.';

-- Guest answers arrive one event at a time; the index keeps the upsert in
-- submit_guest_answers() cheap and supports the admin view's "who answered"
-- filtering without a seq scan.
create index if not exists legacy_members_answered_idx
  on public.legacy_members (answered_at desc)
  where answered_at is not null;

create index if not exists legacy_members_phone_e164_idx
  on public.legacy_members (phone_e164)
  where phone_e164 is not null;
