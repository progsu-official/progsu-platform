# Mobile API v1

Base: `${NEXT_PUBLIC_SITE_URL}/api/mobile/v1`. JSON only. All routes `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `Cache-Control: no-store` on every response.

Code: routes in `app/api/mobile/v1/**`; shared plumbing in `lib/mobile/{http,auth,contracts,data}.ts`. `contracts.ts` (zod) is the source of truth for every shape below; `scripts/smoke-mobile-api.ts` parses every live response against it and, with `--write-fixtures`, writes them to `ios/Progsu/ProgsuTests/Fixtures/`.

Kill switches: `FEATURE_MOBILE_API` off → every route answers `404 feature_off` before any auth work. Event routes (`/events*`, `/me/events*`) additionally follow `FEATURE_EVENTS`.

## Auth

- The app authenticates with Supabase Auth directly (Apple ID-token flow, Google OAuth PKCE via `ASWebAuthenticationSession`, redirect `progsu://auth-callback`). Apple sign-ins get a `profiles` row from `handle_new_user()` like Google ones; a "Hide My Email" relay address lands in `profiles.google_email` (column name unchanged).
- Personal routes take `Authorization: Bearer <supabase access token>`. The server verifies it with `supabase.auth.getUser(token)` (round-trip to Auth: signature, expiry, revocation, deleted user), never by decoding. It then uses a **user-scoped** client carrying that token so RLS and `auth.uid()` apply. The service-role client is only used inside server helpers that need it (rate limits, Hacklanta link codes, deletion).
- Public routes accept an optional bearer. No bearer → public data only. A bearer that fails verification → `401` (so the app refreshes instead of silently showing the signed-out view).
- `/api/mobile/` is excluded from the cookie middleware.

## Envelope

```
200 {"ok": true, "data": ...}
4xx/5xx {"ok": false, "error": {"code": "snake_case", "message": "safe text", "field"?: "...", "retryAfterMs"?: n}, "requestId": "..."}
```

Codes: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `invalid_input` 400, `conflict` 409, `rate_limited` 429 (+ `Retry-After` header), `not_onboarded` 403, `feature_off` 404, `unavailable` 503, `internal` 500. Messages are safe to show; internal error text is never returned.

Every response carries `X-Request-Id`. Idempotency is enforced by the database (PKs, unique entitlement keys, `on conflict`), so retries are safe on every mutation listed as idempotent; no `Idempotency-Key` header is needed.

Pagination (where noted): `?cursor=<opaque>&limit=<1..50>` (default 20) → `data.items`, `data.nextCursor` (null at end). Cursor = base64url JSON of `[timestamp, uuid]`. A malformed cursor is `400 invalid_input`.

Timestamps: ISO-8601 UTC (`...Z`). Event-local zone is given separately as IANA `timeZone` (`America/New_York` for every Progsu event).

Rate limits are durable (`consume_rate_limit`), spent in their own statement before the guarded operation so failures still count.

## Routes

| Method | Path | Auth | Data / notes |
|---|---|---|---|
| GET | `/config` | none | `config`: `minSupportedBuild` (env `MOBILE_MIN_SUPPORTED_BUILD`, default 1), `features{events,hacklanta,wallet,push,appleRevocation}`, `hacklanta` summary or null |
| GET | `/me` | user | `me`: profile, `affiliation`, `verifiedGsu`, `onboarding` (from `lib/auth/onboarding.ts`), `consentVersions`, live `staffAssignments`, `pointsBalance` |
| PATCH | `/me/profile` | user | Body: any of `firstName,lastName,preferredName,affiliation(gsu_student|other_student|nonstudent),institutionName,school,major,majorOtherText,minor,phoneNumber`. Unknown keys rejected. Major must be an active `majors` slug; `other` needs `majorOtherText`; US phone. Returns `me`. |
| POST | `/me/consents` | user | Body `{acceptances:{privacy_policy:true,terms_of_service:true,age_confirmation:true,...}}` → `{recorded:[...]}`. Same helper as web (`lib/domain/consents.ts`); required three must be true; versions are read live. |
| POST | `/me/student-email/start` | user | `{studentEmail}` → `{expiresAt}`. Same helper as web (`lib/domain/student-email.ts`), plus 10/h mobile limit. |
| POST | `/me/student-email/verify` | user | `{studentEmail, code}` → `{studentEmail, verifiedAt}`. 20/h. |
| POST | `/me/apple-authorization` | user | `{authorizationCode}` → `{stored}`. Exchanges with Apple, stores the refresh token AES-256-GCM encrypted. `503 unavailable` if Apple/encryption env missing; `400` if Apple rejects the code. 10/h. Call once right after Sign in with Apple. |
| POST | `/me/delete` | user | `{confirm:"DELETE"}` → `{status:"completed", deletedAt}`. Revokes Apple token (if stored and configured), deletes storage objects (resumes/avatars/banners), device tokens, then the auth user (everything keyed to the profile cascades). Resumable; once complete the old bearer is `401`. 5/h. |
| GET | `/events` | optional | Page of `eventSummary`, upcoming (ends ≥ now), ordered by `startsAt`. Anon: public events only. Signed in: `member_visible_events` (adds private events you're invited to). `?q=` title search. |
| GET | `/events/{slug}` | optional | `eventDetail`; `viewer` is null when signed out, else `{rsvpStatus, checkedInAt, pointsAvailable, pointsEarned, isStaff}`. Draft / uninvited private → `404`. |
| POST | `/events/{id}/rsvp` | user | `{desired:"going"|"cancelled", comment?}` → `{effectiveStatus}` via `rsvp_to_event` (shared with web, `lib/domain/rsvp.ts`, incl. confirmation email + Discord alert). Idempotent. 60/h. |
| GET | `/me/events` | user | `{items:[{event, rsvpStatus, checkedInAt}]}` — my RSVPs + attendance history (not paginated, ≤500). |
| GET | `/me/pass` | user | `{qrPayload, shortCode}`: `qrPayload` = `profiles.checkin_code` (same as the web QR); `shortCode` = its first 8 hex, uppercase, accepted by staff scan for typing. |
| GET | `/me/events/{id}/wallet` | user | `application/vnd.apple.pkpass`. Requires a going RSVP to a published event. Each download issues a new opaque token (`pp1.…`, only its SHA-256 is stored) and revokes the previous one; the pass serial is stable per (event, user) so Wallet replaces the old pass. `503 unavailable` when signing env is missing. 20/h. |
| GET | `/me/points` | user | `{balance, items:[pointEntry], nextCursor}` (newest first, paginated). |
| GET | `/announcements` | optional | Page of `announcement`, newest first. RLS scopes the audience: signed out sees `all` only; `event_rsvps` needs a going/waitlisted RSVP; `hacklanta` needs a linked application. `read` is null when signed out. |
| POST | `/announcements/{id}/read` | user | `{read:true}`. Idempotent. `404` if the announcement isn't visible to you. |
| POST | `/devices` | user | `{token:<hex APNs token>, env:"sandbox"|"production"}` → `{registered:true}`. Registering moves the token to the caller (a phone has one owner). 30/h. |
| DELETE | `/devices/{token}` | user | `{removed:boolean}`. Only removes your own token. **Call on sign-out** (the privacy policy says we do). |
| GET | `/hacklanta` | none | `hacklantaGuide`: published edition (dates, `timeZone`, venue, `lat/lng` null unless verified, theme + `themeActive`, `scheduleTentative`), floors (public image URL with `?v=version`), rooms, sessions. Sessions have a stable `key`, free-text `roomLabel`, optional `roomId`, nullable `endsAt`, `status` scheduled|cancelled|moved, and `pointsNote` (display text for prizes; **never** auto-awarded). `404` until an admin publishes. |
| GET | `/hacklanta/bookmarks` | user | `{sessionIds:[...]}` |
| PUT / DELETE | `/hacklanta/bookmarks/{sessionId}` | user | `{bookmarked:boolean}`. Idempotent. Unknown/unpublished session → `404`. |
| GET | `/hacklanta/me` | user | `{linked:false, application:null}` or `{linked:true, application:{status, attendanceConfirmed, team:{name, memberFirstNames}|null}}`. Reads only the linked application. `503` if the Hacklanta project env is missing. |
| POST | `/hacklanta/link/start` | user | `{email}` → `{expiresAt}`. Same answer whether or not an application matched (no enumeration); only a matched address is emailed a 6-digit code (10 min, 5 attempts, bcrypt-hashed). 5/h per user and per email. `503` if Hacklanta env missing. |
| POST | `/hacklanta/link/verify` | user | `{code}` → `{linked:true}`. `400` incorrect/expired/no code, `429` locked, `409` application already linked to another account. 10/h. |
| GET | `/staff/events` | user | `{items:[staffEvent]}` — events with a live (unrevoked, unexpired) assignment for the caller. Empty list for non-staff. |
| POST | `/staff/events/{id}/scan` | staff | `{code}` → `scanResult {result, attendee:{displayName,kind}|null, pointsAwarded, checkedInAt}`. Accepts `profiles.checkin_code`, `event_rsvps.checkin_token`, guest `checkin_token`, `pp1.` Wallet tokens, and 8-hex short codes. Idempotent. `403` without a live assignment. 600/10 min. |
| GET | `/staff/events/{id}/roster?q=` | staff | `{items:[rosterEntry]}`: name, RSVP status (going/waitlisted), checked-in. No email/phone. ≤200 rows. |
| POST | `/staff/events/{id}/manual-checkin` | staff | `{userId, reason(3..500)}` → `scanResult`. Same rules as scan (going RSVP, window), reason recorded in the attendance note and audit log. |

Scan `result` values: `checked_in`, `already_checked_in`, `wrong_event`, `revoked`, `not_rsvpd`, `outside_window`, `invalid_code`.
Rules: event must be `published`; window is `startsAt − 2h … endsAt + 2h`; members need a `going` RSVP; `checked_in_by` is the scanning staff member (real actor); the attendance insert is `on conflict do nothing`, so two concurrent scans produce one attendance and one award.

## Points

- Per-event rule `point_rules.points` (null = unconfigured, awards nothing), set by admins on the event's **App** tab (`/admin/events/{id}?tab=mobile`).
- Awards happen only inside the staff-verified mobile transitions (`mobile_staff_scan`, `mobile_staff_manual_checkin`). Self QR check-in, admin corrections/backfill, and the legacy web `/checkin` door award nothing.
- Removing an attendance (any path) writes a reversal. Re-check-in may award again only while the net for that (user, event) is zero: net award is capped at one. Keys: `event:{e}:user:{u}:attendance[:n]`, `…:reversal:{n}`.
- Officers adjust with a reason (`admin_adjust_points`, also on the App tab). Ledger is append-only; balance = sum.

## Affiliation

`affiliation` is self-reported. `verifiedGsu` is true only with a verified `student.gsu.edu` student email. Onboarding requires `affiliation ≠ unknown`; school + major are required only for students. Each attendance insert snapshots affiliation, verified flag and institution (`event_attendance_affiliations`); corrections are admin-only with a reason.

## Models (Swift ↔ TS parity)

Defined in `lib/mobile/contracts.ts` (zod) and `ios/Progsu/Progsu/Models/API.swift`. Fixtures in `ios/Progsu/ProgsuTests/Fixtures/*.json` are real captured responses (see that folder's README); values change on every capture.
