-- Give the backfilled directory rows distinct cursor timestamps.
--
-- 20260820140000 stamped every backfilled row with now(), which is
-- transaction-time, so ~160 members ended up sharing one identical
-- last_discoverability_change_at. list_member_cards orders by
-- (visible_since desc, user_id asc) and its cursor carries both halves, so a
-- tie that large is *correct* -- the user_id tiebreaker walks it -- but only as
-- long as the timestamp survives the round trip at full precision.
--
-- It does today: supabase-js hands PostgREST's microsecond ISO string straight
-- back to the RPC. It stops being true the moment anything in that path parses
-- the cursor into a millisecond-precision type. A JS Date round trip truncates
-- microseconds, the truncated value then matches neither `visible_since < ts`
-- nor `visible_since = ts`, and every member in the tie below the first page
-- becomes unreachable -- discoverable in the table, absent from the product.
-- That failure mode was reproduced against this data before this migration.
--
-- One identical timestamp carries no information anyway. Spreading the group
-- one second per member, newest signup first, removes the tie outright and
-- makes the directory's default order mean something: members surface roughly
-- in reverse join order instead of by UUID.
--
-- Written to survive re-running: it only touches groups that still share a
-- timestamp, so a second application is a no-op.

with tied as (
  select
    v.user_id,
    row_number() over (
      partition by v.last_discoverability_change_at
      order by p.created_at desc nulls last, v.user_id
    ) as rn,
    count(*) over (
      partition by v.last_discoverability_change_at
    ) as group_size
  from public.profile_visibility_settings v
  join public.profiles p on p.id = v.user_id
  where v.discoverable = true
    and v.last_discoverability_change_at is not null
)
update public.profile_visibility_settings v
set last_discoverability_change_at =
      v.last_discoverability_change_at - ((tied.rn - 1) * interval '1 second'),
    updated_at = now()
from tied
where tied.user_id = v.user_id
  and tied.group_size > 1;
