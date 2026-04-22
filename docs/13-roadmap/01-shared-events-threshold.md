# 01 — Shared-events threshold public-launch bump

**Status**: Ready. 5 min of work.
**Priority**: Required before R3 goes live to production members (Phase C per runbook).
**Deferred from**: the initial R3 migration intentionally shipped with threshold=2 for single-user dogfood testing. Threshold=10 was defined in `docs/11-r3-shared-events-spec.md` §5 as the public-launch number.

## Why

At threshold=2, a malicious user can infer individual attendance: if only 2 people attended an event and a shared-events query comes back non-empty, the adversary knows the target attended. At threshold=10, the anonymity set is wide enough that the result alone doesn't uniquely identify the target.

Threshold=10 also aligns with Progsu's historical event sizes (plan §15 baseline: 15–80 attendees).

## How

Ship a single migration that `create or replace`s `shared_events_for_viewer` with `c_min_attendees = 10` (everything else unchanged).

Filename: `supabase/migrations/20260425000400_shared_events_threshold_tighten.sql` (or next available timestamp after whatever was shipped most recently).

The body is identical to migration `20260425000100_shared_events.sql`'s function body except line `c_min_attendees constant int := 2` → `:= 10`.

## Smoke test adjustments

At threshold=10, `scripts/smoke-shared-events-visibility.ts` needs more attendee seeding. Scenarios currently expect 4 aggregate + 3 named based on events with 2–3 attendees each. All of those will drop to 0 with the new threshold.

Options:
- **Re-seed with 10 attendees per event**: more loop overhead, probably still fast enough
- **Parameterize the threshold** via an env var in the migration (overengineering for a privacy constant)
- **Skip the smoke for the bumped version** and rely on the fact that the helper body changed only in one constant (unsafe)

Recommend the first option. The smoke's structure supports it — just add more users to the per-event attendance loop.

## Verification

1. `supabase db reset` — migration applies
2. Update the smoke to seed 10+ users per event in `public-big` / `public-sensitive` / `public-small`
3. `pnpm tsx scripts/smoke-shared-events-visibility.ts` — green
4. Eyeball the helper: `docker exec supabase_db_<project> psql -U postgres -d postgres -c "\\df+ public.shared_events_for_viewer"` and confirm the function body shows `:= 10`
5. Push migration to prod: `supabase db push --linked`

## Rollback

Ship a new migration that sets `:= 2` back. Function is a `create or replace`, so reverting is one migration. No data changes — the constant only affects which rows the helper returns.

## Don't do this if

- You're still iterating on R3 visibility rules (wait until you're certain 10 is the right number)
- Phase A and Phase B aren't done yet (dogfood needs the lower threshold to surface any shared-events results at all)
