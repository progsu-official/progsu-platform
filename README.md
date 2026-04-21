# Progsu member platform

Member CRM for Progsu, the builders/programming community at GSU. Students log in
with Google, verify a school email via OTP, build a profile, upload a resume, and
grant fine-grained consents. Admins manage members and export a recruiter-safe
CSV for sponsors.

Full design in `docs/01-product-architect.md` through `docs/07-implementation-plan.md`.
The implementation plan (07) is the source of truth when design docs disagree.

## Stack

- Next.js 15 App Router + React 19 + TypeScript
- Tailwind 3.4 + shadcn/ui primitives
- Supabase (Postgres, Auth via Google OAuth, Storage)
- Drizzle (types only — Supabase SQL migrations are the schema source of truth)
- Resend for OTP + transactional email
- bcryptjs for OTP hashing
- Zod for every trust-boundary input

## Local setup

Requirements: Node 20+, pnpm 10+, Docker Desktop, Supabase CLI.

```bash
pnpm install
supabase start          # boots local Postgres + GoTrue + Studio + Storage
supabase db reset       # applies all migrations in supabase/migrations/ in order
cp .env.example .env.local
# then open .env.local and paste the anon + service-role keys printed by
# `supabase status`
pnpm dev
```

Studio: http://127.0.0.1:54323 · Mailpit: http://127.0.0.1:54324

### Adding a migration

Write SQL into `supabase/migrations/<timestamp>_<name>.sql` then
`supabase db reset`. Regenerate Drizzle types with:

```bash
pnpm db:pull
```

(This also runs `scripts/drizzle-patch.ts`, which handles three upstream
drizzle-kit quirks — see the script's header comment.)

## Smoke tests

Every surface has a runnable smoke script under `scripts/`. Each one boots the
dev server, seeds users/rows via the admin client, exercises the real action or
page, and asserts invariants. Run any of them directly:

```bash
pnpm tsx scripts/smoke-otp-flow.ts
pnpm tsx scripts/smoke-export.ts
pnpm tsx scripts/smoke-rls-self-elevate.ts
# …etc
```

Every script is idempotent: it cleans up the users + rows it seeds on exit.

## Key files

- `middleware.ts` — session refresh, route classification, unauthenticated redirects
- `lib/auth/onboarding.ts` — the canonical `loadOnboardingState()` helper
- `lib/actions/*.ts` — every server action. Schemas live in sibling `*-schemas.ts`
  because `"use server"` modules can only export async functions
- `lib/supabase/{browser,server,middleware,admin}.ts` — four Supabase clients
- `app/api/admin/export/route.ts` — recruiter CSV download
- `app/api/webhooks/resend/route.ts` — Resend bounce handler

## Deploy (not yet wired)

See `docs/07-implementation-plan.md §8`. Requires: a prod Supabase project, a
Google Cloud OAuth client, a verified Resend domain, and a Vercel project. Until
those are set up, everything lives locally.

## License

Internal — Progsu officers only until otherwise stated.
