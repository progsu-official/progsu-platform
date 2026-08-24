# Roadmap — Post-R3 Work

Things we haven't done yet, sorted by what's ready to ship vs. what's still planning. Each item has its own doc with step-by-step implementation.

Created: 2026-04-22, after R3 code-complete and migration-pushed to prod.

## Status legend

- **Ready** — spec is complete, implementation is straightforward, can start immediately
- **Planned** — has a detailed plan doc, awaits engineer attention
- **Stub** — noted here but no detailed plan yet
- **Partially shipped** — some of the plan is live; the doc records what and what is left

## Items

| # | Title | Status | Dep | Doc |
|---|---|---|---|---|
| 01 | Shared-events threshold public-launch bump | Ready | None | [01-shared-events-threshold.md](./01-shared-events-threshold.md) |
| 02 | Member-facing UX polish | Planned | None | [02-member-polish.md](./02-member-polish.md) |
| 03 | Admin event analytics | Partially shipped | None | [03-admin-analytics.md](./03-admin-analytics.md) |
| 04 | Playwright E2E testing | Planned | None | [04-playwright-e2e.md](./04-playwright-e2e.md) |
| 05 | QR check-in v2: wallet passes + scan modes | Stub | v1 QR check-in (D12) shipped | [05-qr-checkin-v2.md](./05-qr-checkin-v2.md) |

## Other ideas floated but not planned

These came up in discussion but haven't been spec'd. If any become priorities, make a new roadmap doc.

- Recurring events engine (excluded from R1 per plan §4 non-goal #11)
- Admin audit filter by event ID at `/admin/audit`
- Move `SHARED_EVENT_MIN_ATTENDEES` to an admin-configurable settings table
- Smoke-script utility library to dedupe user seeding
- Scale beyond Progsu to other student orgs (requires multi-tenancy rethink)

## Execution notes

These aren't blocking each other — pick by priority + available time. Rough guidance:
- **Before Phase A**: nothing is strictly required. Current state is production-safe (all flags off).
- **Before Phase B**: item 02 (polish) is worth doing — real members will see rough edges.
- **Before Phase C (GA)**: item 01 (threshold bump) is required per R3 spec.
- **Ongoing**: item 04 doesn't block anything. Ship when you have bandwidth. Item 03's remaining backlog is in its own doc.
