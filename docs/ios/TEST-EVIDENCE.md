# Test evidence

Fill the Result column with date + commit when each is run. "Local" = `supabase db reset` + local dev server.

## Commits on this branch (`git log main..HEAD`)
| Commit | Scope |
|---|---|
| 125d400 | docs(ios): mobile API v1 contract |
| 454b2f1 | data(hacklanta): Hacklanta II schedule |
| a23b09a | feat(ios): native SwiftUI app |
| d4f163c | feat(db): affiliation, points, staff, Hacklanta guide, announcements, push, deletion schema |
| 6b46b4f | feat(api): mobile API + shared domain services |
| 94f002e | feat(admin): operator controls; privacy v8 copy |
| 0a0e7e3 | test(smoke): mobile API, staff scan concurrency, points, affiliation, deletion; schedule importer |
| (uncommitted) | /support, AASA route, `smoke-support-aasa.ts`, docs/ios release docs |

## Server smokes (`pnpm tsx scripts/<name>.ts`)
| Script | Covers | Result |
|---|---|---|
| smoke-mobile-api.ts | every `/api/mobile/v1` route parsed against zod contracts; fixtures | `<pending>` |
| smoke-mobile-staff-points.ts | staff scan, concurrent double-scan → one award, reversals, manual check-in | `<pending>` |
| smoke-affiliation-snapshot.ts | snapshot on attendance, admin correction | `<pending>` |
| smoke-account-deletion.ts | deletion cascade, bearer 401 after | `<pending>` |
| smoke-onboarding-parity.ts | `lib/auth/onboarding.ts` ↔ `is_fully_onboarded()` (merge gate) | `<pending>` |
| smoke-consent.ts | v8 re-acceptance | `<pending>` |
| smoke-middleware.ts, smoke-legal-pages.ts | route classification, /privacy /terms | `<pending>` |
| smoke-support-aasa.ts | /support + /privacy signed out; AASA 404 without team id, JSON with it | **pass, local, 2026-10-03** |

## iOS
| Suite | Covers | Result |
|---|---|---|
| ProgsuTests (`LogicTests`, `ModelDecodingTests`) | fixtures, nonce, theme window/DST, schedule grouping, QR, debounce, deep links, retry | `<pending>` |
| ProgsuUITests (`SmokeUITests`) | logged-out tab walk | `<pending>` |

## Web gates (2026-10-03, uncommitted tree)
- `tsc --noEmit`: pass. `eslint`: 0 errors, 8 pre-existing warnings. `next build`: pass (after clearing a stale `.next`).

## Device / production (not yet done)
TestFlight install; Apple + Google sign-in against prod; push delivery; Wallet pass add + scan; universal link open; Hacklanta link with a real applicant; deletion with Apple revocation.
