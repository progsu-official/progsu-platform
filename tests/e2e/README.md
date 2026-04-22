# E2E tests

Playwright suite. Runs against local Supabase + `pnpm dev` at 127.0.0.1:3000.

## Quick reference

```bash
pnpm test:e2e                  # run all scenarios
pnpm test:e2e:ui               # interactive UI mode
pnpm test:e2e:headed           # headful Chromium
pnpm test:e2e tests/e2e/scenarios/03-private-invite-visibility.spec.ts  # single file
```

## Prereqs

Dev env must have:
- `supabase start` running
- `.env.local` populated (typecheck won't catch this — Playwright loads env at runtime)
- `FEATURE_EVENTS=true`, `FEATURE_MEMBER_DIRECTORY=true`, `FEATURE_SHARED_EVENT_HISTORY=true`
- No collisions on port 3000 (`pnpm dev` will be spawned if nothing's there)

## Status

MVP coverage (3 of 7 spec scenarios shipped). Catches the high-value flows. Remaining 4 are refinement + follow-up.

### Shipped

| # | File | What it catches |
|---|---|---|
| 01 | `01-admin-creates-and-member-checks-in.spec.ts` | Full happy path: form-create → publish → code rotate → RSVP → self check-in → admin roster |
| 02 | `02-capacity-waitlist.spec.ts` | Capacity, waitlist, cancel-then-promote |
| 03 | `03-private-invite-visibility.spec.ts` | 404 for non-invitees, detail page for invitees |

### Remaining (see `docs/13-roadmap/04-playwright-e2e.md` §6.4–§6.7)

- 04 cancel event fan-out (requires email-log tailing helper)
- 05 R2 member directory
- 06 R3 shared events
- 07 onboarding consent cascade (must be serial; mutates global `consent_versions`)

Add these when convenient. Scenario 4 needs `tests/e2e/helpers/email.ts` to tail the dev-server stdout for `[email:log]` lines.

## Bugs this suite has caught

The suite paid for itself on the first 3 scenarios alone:

1. **`GuestsTabServer` used service-role client** — `admin_event_roster_for()` requires `auth.uid()` to be admin; service-role has no auth.uid(). Every admin had seen "Couldn't load roster" since R1. Fixed by switching to user-context client in `app/admin/events/[id]/page.tsx`.
2. **`admin_event_roster_for` was declared `stable`** — but writes audit via `write_audit()`. PostgREST calls stable RPCs in read-only transactions, so the INSERT failed. Fixed in migration `20260425000400_admin_event_roster_volatile.sql`.

## Auth

No Google OAuth in tests. `tests/e2e/helpers/session.ts` uses Supabase admin API + password sign-in + `@supabase/ssr` cookie serialization to plant a valid session cookie directly. Matches how the real app reads sessions; bypasses Google's headless-detection heuristics.

## Selector policy

Semantic-first (`getByRole`, `getByLabel`). `data-testid` is a last resort. When a test breaks on a UI change, update the test to match — don't add a test ID to re-hide the change.
