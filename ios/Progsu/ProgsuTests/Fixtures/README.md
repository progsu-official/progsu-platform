Every `*.json` here except `hacklanta-ii-schedule.json` is a REAL response captured from a local
stack by the backend smokes, using seeded smoke users and events (example.com emails, random UUIDs):

    MOBILE_SMOKE_BASE=http://localhost:3000 pnpm tsx scripts/smoke-mobile-api.ts --write-fixtures
    MOBILE_SMOKE_BASE=http://localhost:3000 pnpm tsx scripts/smoke-account-deletion.ts --write-fixtures

The smoke validates every response against lib/mobile/contracts.ts before writing it, so a file
here always parses against the current contract. Re-running overwrites them; names are stable.
Values (ids, counts, timestamps) change on every capture, so tests should assert shape and
semantics, not specific synthetic values.

`hacklanta.json` is the real Hacklanta II run of show (data/hacklanta-ii-schedule.json, still
tentative) imported by scripts/import-hacklanta-schedule.ts and served by GET /hacklanta.
`hacklanta_me.json` is the unlinked state (no Hacklanta project is reachable locally).
