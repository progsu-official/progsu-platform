# Mobile API v1

Base: `${NEXT_PUBLIC_SITE_URL}/api/mobile/v1`. JSON only. All routes `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `Cache-Control: no-store` on anything personal.

## Auth

- Client authenticates with Supabase Auth directly (Apple ID-token flow, Google OAuth PKCE via `ASWebAuthenticationSession`, redirect `progsu://auth-callback`).
- Personal routes take `Authorization: Bearer <supabase access token>`. The server verifies it with `supabase.auth.getUser(token)` (round-trip to the project's Auth server — signature, expiry, revocation), never by decoding. It then builds a **user-scoped** client with that token so RLS applies, and uses the service-role client only inside helpers that need it.
- Public routes accept an optional bearer; with none they return only public data.

## Envelope

```
200 {"ok": true, "data": ...}
4xx/5xx {"ok": false, "error": {"code": "snake_case", "message": "safe text"}, "requestId": "..."}
```

Stable codes: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `invalid_input` 400, `conflict` 409, `rate_limited` 429, `not_onboarded` 403, `feature_off` 404, `unavailable` 503, `internal` 500.

Every response carries `X-Request-Id`. Mutations accept `Idempotency-Key` where noted; the DB enforces idempotency regardless.

Pagination: `?cursor=<opaque>&limit=<1..50>` → `data.items`, `data.nextCursor` (null at end). Cursor = base64url of `(timestamp, uuid)`.

Timestamps: ISO-8601 UTC strings. Event-local zone given separately as IANA `timeZone`.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/config` | none | App config: active Hacklanta edition summary + theme window/override, min supported app build, feature switches |
| GET | `/me` | user | Profile, affiliation, onboarding state (from `lib/auth/onboarding.ts`), staff assignments, points balance |
| PATCH | `/me/profile` | user | Update editable profile fields (zod-validated, same rules as web) |
| POST | `/me/consents` | user | Accept current consent versions (same helper as web) |
| POST | `/me/student-email/start` · `/verify` | user | School email OTP (reuses web verification helpers + rate limits) |
| POST | `/me/apple-authorization` | user | Body `{authorizationCode}`; server exchanges with Apple, stores encrypted refresh token for revocation |
| POST | `/me/delete` | user | Body `{confirm:"DELETE"}`; runs deletion workflow; idempotent |
| GET | `/events` | optional | Upcoming visible events, cursor-paginated, `?q=` search |
| GET | `/events/{slug}` | optional | Event detail + caller's RSVP/attendance/points state |
| POST | `/events/{id}/rsvp` | user | Body `{desired:"going"|"cancelled"}` → `rsvp_to_event` |
| GET | `/me/events` | user | My RSVPs + attendance history |
| GET | `/me/pass` | user | Personal check-in QR payload + readable short code |
| GET | `/me/events/{id}/wallet` | user | Signed `.pkpass` (503 `unavailable` if signing not configured) |
| GET | `/me/points` | user | Balance + ledger entries (cursor) |
| GET | `/announcements` | optional | Feed scoped to caller's audience; `read` flag when authed |
| POST | `/announcements/{id}/read` | user | Mark read |
| POST | `/devices` · DELETE `/devices/{token}` | user | APNs device token register/remove |
| GET | `/hacklanta` | none | Active edition: dates, tz, venue, floors (image URLs + version), rooms, sessions, publishedAt |
| GET/PUT/DELETE | `/hacklanta/bookmarks[/{sessionId}]` | user | Personal agenda |
| GET | `/hacklanta/me` | user | Linked application status + team summary (or `linked:false`) |
| POST | `/hacklanta/link/start` · `/link/verify` | user | Prove ownership of a Hacklanta application by emailed OTP |
| GET | `/staff/events` | staff | Events the caller is assigned to (active, unexpired) |
| POST | `/staff/events/{id}/scan` | staff | Body `{code}`; returns `{result, attendee:{displayName}, pointsAwarded}` |
| GET | `/staff/events/{id}/roster?q=` | staff | Minimal roster: name, rsvp status, checked-in |
| POST | `/staff/events/{id}/manual-checkin` | staff | Body `{userId, reason}` |

Scan `result` values: `checked_in`, `already_checked_in`, `wrong_event`, `revoked`, `not_rsvpd`, `outside_window`, `invalid_code`.

## Models (Swift ↔ TS parity)

Defined in `lib/mobile/contracts.ts` (zod) and `ios/Progsu/Progsu/Models/API.swift`. `scripts/smoke-mobile-api.ts` asserts responses parse against the zod schemas; Swift tests decode the shared fixtures in `ios/Progsu/ProgsuTests/Fixtures/*.json`, which the smoke also validates.
