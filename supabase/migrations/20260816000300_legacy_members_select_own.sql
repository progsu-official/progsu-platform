-- Let a member see their own already-claimed legacy_members row, so the
-- onboarding UI can tell them "we found your old info." Still can't see
-- anyone else's row, and can't see unclaimed rows at all (claimed_profile_id
-- is null until the claim trigger sets it), only their own once claimed.
create policy legacy_members_select_own_claimed
  on public.legacy_members
  for select
  to authenticated
  using (claimed_profile_id = auth.uid());
