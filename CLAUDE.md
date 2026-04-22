# CLAUDE.md

Conventions for Claude Code agents working on this repo. Complements `README.md` (which is for humans). If you're Claude, read this once at the start of any substantive session.

## What this app is

Progsu member platform. Internal CRM + events operations tool for a student builders community at Georgia State University. Not a SaaS, not an Eventbrite clone, not multi-tenant.

## Canonical docs

Read these **in this order** when you need context:

1. `README.md` — stack, setup, how to run
2. `docs/07-implementation-plan.md` — the authoritative source when design docs disagree. Always check this.
3. `docs/09-events-platform-plan.md` — the program plan for R1/R2/R3 events layer. Sections §14 (rollout phases), §15 (risks), §16 (open decisions).
4. `docs/10-r2-member-card-spec.md` and `docs/11-r3-shared-events-spec.md` — detailed specs for the peer-visibility features
5. `docs/12-events-pilot-runbook.md` — step-by-step Phase A/B/C rollout
6. `docs/13-roadmap/` — post-R3 planned work

## Hard rules

These are not negotiable. Breaking them has caused real bugs or created real risk.

1. **SQL migrations are the schema source of truth.** Drizzle types are generated from them and are read-only. Never edit `drizzle/schema.ts` by hand.

2. **Migrations are append-only.** Never modify a migration file that has shipped to prod. If you need to change something, write a new migration that uses `create or replace` or `alter table`.

3. **Every privileged mutation goes through a SECURITY DEFINER helper.** Never let a server action do a direct `supabase.from('foo').update()` for sensitive tables. The helper enforces invariants, writes audit, returns clean errors.

4. **RLS is enabled on every new table.** Direct client writes must be denied unless the table is self-editable by design (e.g., the caller's own `event_rsvps` — but even that goes through `rsvp_to_event`). When in doubt, deny all client writes and mutate through a helper.

5. **`lib/auth/onboarding.ts` is the canonical onboarding state.** The DB helper `is_fully_onboarded()` mirrors it exactly. If you change one, change the other; `smoke-onboarding-parity.ts` is a hard merge gate.

6. **Feature flags are route-edge kill switches, not privacy boundaries.** `FEATURE_EVENTS`, `FEATURE_MEMBER_DIRECTORY`, `FEATURE_SHARED_EVENT_HISTORY`. Flag off = layout `notFound()` before auth work runs. Helpers don't check flags — opt-out columns do.

7. **Admin gate is `notFound()` not `redirect(/403)`.** Don't leak admin surface existence to non-admins.

8. **Privacy version bumps trigger re-acceptance** via the onboarding cascade. If you add a new peer-visible data surface, bump `privacy_policy` in `consent_versions` via a new migration and update `/privacy/page.tsx` copy. Don't create a new `consent_type_t` value — additive enums ossify forever.

9. **Service-role clients are server-only.** `createAdminClient()` in `lib/supabase/admin.ts` has a `server-only` import that throws if you import it from a client component. Respect this.

10. **Constant-time compare for secrets.** `CRON_SECRET`, OTP tokens. See `app/api/cron/event-notifications/route.ts` for the pattern.

## Architectural conventions

- **Server actions** in `lib/actions/*.ts` with `"use server"` + `"server-only"` imports. Return `ActionResult<T>` discriminated unions (`{ok:true, data}` / `{ok:false, error: {code, message, field?}}`). Never throw from a server action — map all DB errors to `err(code, message)`.

- **Zod schemas** in `lib/actions/*-schemas.ts` (no `"use server"` — client components import types from here). Validate at every trust boundary: user input, RPC arguments, webhook payloads.

- **Server components by default.** Only use `"use client"` when you need `useState`, `useEffect`, `useTransition`, event handlers, or browser APIs. Forms are server-rendered; their submit handlers are server actions passed as the `action` prop.

- **Dynamic rendering**: every page + layout under `/dashboard`, `/admin`, `/events`, `/members` is `export const dynamic = "force-dynamic"`. No caching for authenticated surfaces.

- **Tab navigation** via `?tab=X` search param. See `app/admin/events/[id]/page.tsx` + `tab-nav.tsx` for the pattern.

- **Cursor pagination**, not offset. Use `(timestamp, uuid)` composite cursors for deterministic ordering under mutation.

- **Audit log writes** via `public.write_audit(action, actor, target, metadata jsonb)`. Actor is the authenticated user. Target is who the action was performed on (null for admin actions without a specific target). Metadata captures before/after snapshots for mutations.

## Smoke tests

- Lives in `scripts/smoke-*.ts`. Run with `pnpm tsx scripts/<name>.ts`.
- **Dynamic consent versions**: always read `consent_versions` at startup, never hardcode `"v1"`. See `scripts/smoke-event-rsvp.ts` for the pattern.
- Seed users via `admin.auth.admin.createUser`, clean up in a `finally` block.
- Green-from-scratch expected: after `supabase db reset`, every smoke must pass on first run.

## Common tasks

### Add a new migration

1. Create `supabase/migrations/YYYYMMDDHHMMSS_name.sql`. Use current date + sequential HHMMSS.
2. `supabase db reset` to apply locally.
3. Update types: `pnpm db:pull`.
4. Run `pnpm typecheck && pnpm build`.
5. Run relevant smokes.
6. Commit schema + generated types together.

### Add a new server action

1. Add the zod schema to the appropriate `-schemas.ts`.
2. Add the action to the appropriate `.ts`. Use `requireAdminContext()` or `requireAuthenticatedContext()` helpers as applicable.
3. Wrap RPC calls in `try/catch` and map errors via `mapPgError`.
4. `revalidatePath` the affected routes after successful mutations.
5. Return `ok()` or `err()`. Never throw.

### Feature-flag a new surface

1. Add the flag to `lib/env.ts` using `parseBool`.
2. Add it to `.env.example` with `=false` default.
3. In the new route's `layout.tsx`, check the flag at the top before any auth work, `notFound()` if off.
4. Hide nav links to the new surface when flag is off (see `app/admin/layout.tsx` for the pattern).
5. Server actions that gate on the flag should return an empty result when off (don't throw — indistinguishable from "feature turned off" to end users).

### Change a privacy-visible data surface

1. New section in `/privacy/page.tsx` describing what changed.
2. New migration bumping `consent_versions.privacy_policy` to `vN+1`.
3. Update the version label at the top of `/privacy/page.tsx`.
4. Smoke tests need to use dynamic versions (they already should).
5. Existing users will be routed to `/onboarding/consent` on next page load — this is the desired behavior.

## Rollout discipline

Follow `docs/12-events-pilot-runbook.md`:
- Phase A: flag on, admin-only testing, no members told
- Phase B: one real low-stakes event
- Phase C: GA

Never skip Phase A. Email deliverability, cron timing, and Vercel env issues only show up in production.

## What to not do

- Don't write `CLAUDE.md` files in subdirectories. One at the root; specifics go in `docs/`.
- Don't create planning docs on the fly when a task is simple — write code, commit, move on.
- Don't add comments that restate what the code does. Comments explain non-obvious **why**.
- Don't generate emojis in code or prose unless the user asked.
- Don't add TODO comments to production code. Open a roadmap doc instead.
- Don't mock the database in tests. Integration tests hit real Supabase; unit tests are rare in this codebase.
- Don't refactor something unrelated to the task at hand. Scope creep is a bug.

## When you're stuck

- Check the canonical docs in the order above.
- Grep for similar patterns — this codebase has developed clear conventions; mimic them.
- Look at a recent commit on a similar feature (e.g., for events work, look at R1/R2/R3 commits in April 2026).
- If a spec contradicts the code, the code wins (it's what shipped). Update the spec.
- If two design docs contradict, `docs/07-implementation-plan.md` wins.
