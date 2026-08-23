-- legacy_members.claimed_profile_id blocked account deletion.
--
-- The FK was created with no delete rule (NO ACTION), which was harmless while
-- the only thing setting it was the pre-launch Luma import backfill — those
-- rows point at accounts nobody deletes. claim_guest_identity() now sets it on
-- every guest who converts, so the column went from rarely-populated to
-- routinely-populated, and deleting any such member started failing with an
-- opaque GoTrue 500 (`unexpected_failure`) rather than a readable constraint
-- error.
--
-- SET NULL rather than CASCADE: the staged identity is a record of a
-- registration that really happened, and it should outlive the account. Losing
-- the link is correct — the row simply becomes unclaimed again, which is what
-- it was before the person signed in, and it stays available to re-match if
-- they come back with the same address.
--
-- claimed_at is deliberately left as-is. A trigger could clear it alongside,
-- but a claimed_at with a null profile is a truthful record ("this was claimed
-- once, by an account that no longer exists") and the claim path already keys
-- off claimed_profile_id, not claimed_at.

alter table public.legacy_members
  drop constraint if exists legacy_members_claimed_profile_id_fkey;

alter table public.legacy_members
  add constraint legacy_members_claimed_profile_id_fkey
  foreign key (claimed_profile_id)
  references public.profiles(id)
  on delete set null;

comment on column public.legacy_members.claimed_profile_id is
  'Profile that claimed this pre-signup identity. ON DELETE SET NULL — the staged row outlives the account and becomes re-claimable. See 20260824010000.';
