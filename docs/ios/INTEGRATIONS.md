# Integrations

| Integration | Used for | Config | Status |
|---|---|---|---|
| Supabase (progsu project) | Auth, Postgres + RLS, storage | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`; app: `SUPABASE_URL`/`SUPABASE_ANON_KEY` xcconfig | implemented-tested (local) |
| Sign in with Apple | Login; token revocation on deletion | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICES_ID`, `APP_ENCRYPTION_KEY`; Supabase Apple provider | implemented-unverified (needs real Apple keys + entitlement) |
| Google OAuth | Login (PKCE, `progsu://auth-callback`) | Supabase Google provider + redirect allowlist | implemented-unverified on device against prod |
| APNs | Announcement push | `APNS_*`; cron `/api/cron/push-outbox` every minute | implemented-unverified (needs `aps-environment` entitlement + key) |
| Apple Wallet | Event pass | `PASS_*` certs | implemented-unverified (needs Pass Type ID cert) |
| Resend | Emails (RSVP confirmations, Hacklanta link codes) | existing env | implemented (shared with web) |
| Discord | RSVP announcements from app RSVPs (same `rsvp_to_event` path as web) | existing env | implemented (shared with web) |

## Hacklanta
- **Separate Supabase project** (the hacklanta-ii app's). The platform talks to it server-side only with `HACKLANTA_SUPABASE_URL` + `HACKLANTA_SUPABASE_SECRET_KEY` (`lib/mobile/hacklanta.ts`). The iOS app never talks to it directly. Missing env → Hacklanta personal routes return `503`.
- **Guide** (schedule, rooms, venue) lives in the progsu project (`20261003130000_hacklanta.sql`), loaded by `scripts/import-hacklanta-schedule.ts` from `data/hacklanta-ii-schedule.json`, public once published. Schedule is flagged tentative. No floor plans published yet; venue coordinates are geocoded on device unless verified ones are set.
- **Link-by-OTP**: `POST /hacklanta/link/start {email}` → server looks up `applications` by email in the Hacklanta project; only a match gets a 6-digit code (bcrypt, 10 min, 5 attempts); identical response either way. `POST /hacklanta/link/verify {code}` stores the link (one account per application). After linking, `/hacklanta/me` returns status, attendance confirmation, team name and teammate first names (≤10).
- **Team finder**: not in the iOS app. It lives in the hacklanta-ii web app; this repo only exposes server-to-server endpoints it calls (`/api/team-finder-lookup`, `/api/team-finder-discord`, `TEAM_FINDER_SYNC_SECRET`). No in-app link-out to the team finder was found in `ios/` code.

| Hacklanta piece | Status |
|---|---|
| Public guide + bookmarks | implemented-tested locally (`smoke-mobile-api.ts`); prod import pending (`--remote --publish`) |
| Theme window + in-app preview toggle | implemented-tested (unit tests incl. DST) |
| Link-by-OTP + status | implemented; **unverified against the real Hacklanta project** (schema assumptions: `applications.email`, `first_name`, `team_id`; `teams.name`) |
| Team finder | not in app |
