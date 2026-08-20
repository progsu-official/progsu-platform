-- Backfill: list every existing member in the directory.
--
-- 20260820120000 flipped the default for new accounts and explicitly declined
-- to backfill existing ones, calling that "a separate decision that ships with
-- member notice". This is that decision. The directory launched opt-in and had
-- 38 of 209 members in it; waiting for the other 170 to each find
-- /profile/settings/visibility was never going to populate it.
--
-- Two groups stay out.
--
-- Test and developer accounts, because they are not people. The @example.com
-- accounts are dev-login, smoke and debug fixtures; the one legacy
-- "test testing" admin predates that convention. dev-member@example.com had
-- already toggled itself discoverable, so this forces those rows to false
-- rather than only skipping them.
--
-- Anyone who explicitly turned discoverability off. A row carrying
-- last_discoverability_change_at with discoverable = false is a member who
-- found the control and used it. Flipping a default nobody ever saw is not the
-- same act as reversing a choice somebody made, so the second group is
-- excluded by predicate rather than by name -- if more members opt out before
-- this ships, they are excluded too.
--
-- last_discoverability_change_at is written rather than left null, and that is
-- load-bearing rather than cosmetic. list_member_cards paginates on
-- (visible_since, user_id) where visible_since is this column, and its cursor
-- predicate is `mc.visible_since < p_cursor_ts`. That is NULL -- never true --
-- for a null visible_since, and the ordering is `desc nulls last`. Backfilled
-- rows with a null timestamp would sort to the very end and then be
-- unreachable on every page after the first: discoverable in the table, and
-- invisible in the product. now() is transaction-time, so all backfilled rows
-- share one timestamp and the user_id tiebreaker keeps the cursor
-- deterministic.
--
-- Not touched: share_attended_events and share_shared_event_counts. Those are
-- separate disclosures about event history, not directory listing, and nothing
-- here asked for them.

-- ---------------------------------------------------------------------------
-- Members with no visibility row at all -- never had a reason to create one.
-- ---------------------------------------------------------------------------
insert into public.profile_visibility_settings
  (user_id, discoverable, last_discoverability_change_at)
select p.id, true, now()
from public.profiles p
where p.is_archived = false
  and not (
    p.google_email::text ilike '%@example.com'
    or (
      btrim(lower(coalesce(p.first_name, ''))) = 'test'
      and btrim(lower(coalesce(p.last_name, ''))) = 'testing'
    )
  )
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Existing rows sitting at the old opt-in default, untouched by their owner.
-- ---------------------------------------------------------------------------
update public.profile_visibility_settings v
set discoverable                   = true,
    last_discoverability_change_at = now(),
    updated_at                     = now()
from public.profiles p
where p.id = v.user_id
  and p.is_archived = false
  and v.discoverable = false
  and v.last_discoverability_change_at is null
  and not (
    p.google_email::text ilike '%@example.com'
    or (
      btrim(lower(coalesce(p.first_name, ''))) = 'test'
      and btrim(lower(coalesce(p.last_name, ''))) = 'testing'
    )
  );

-- ---------------------------------------------------------------------------
-- Test and developer accounts are forced out, not merely skipped.
-- ---------------------------------------------------------------------------
update public.profile_visibility_settings v
set discoverable = false,
    updated_at   = now()
from public.profiles p
where p.id = v.user_id
  and v.discoverable = true
  and (
    p.google_email::text ilike '%@example.com'
    or (
      btrim(lower(coalesce(p.first_name, ''))) = 'test'
      and btrim(lower(coalesce(p.last_name, ''))) = 'testing'
    )
  );
