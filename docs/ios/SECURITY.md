# iOS app: security model

Facts below are from code on `codex/progsu-ios-app`. Items marked **unverified** have not been exercised against production.

## Secrets
- The app ships no secrets. `SUPABASE_ANON_KEY` is public by design (RLS is the boundary). Config reaches the app via xcconfig → Info.plist keys (`ProgsuSupabaseURL`, `ProgsuAPIBaseURL`, ...).
- Server-only secrets (Vercel env): `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `APPLE_PRIVATE_KEY`, `APNS_PRIVATE_KEY`, `PASS_SIGNER_*`, `HACKLANTA_SUPABASE_SECRET_KEY`. Each feature returns `503 unavailable` (or no-ops, for push) when its env is missing rather than failing open.

## Authentication
- Supabase Auth directly from the app: Sign in with Apple (ID token + SHA-256 nonce) and Google (PKCE via `ASWebAuthenticationSession`, redirect `progsu://auth-callback`).
- Session stored in the Keychain (`KeychainLocalStorage`).
- API bearer tokens are verified with `supabase.auth.getUser(token)` on every request (signature, expiry, revocation, deleted user), then used to build a user-scoped client so RLS and `auth.uid()` apply. Never decoded locally.
- Apple refresh tokens (for revocation on deletion) are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY` (`lib/mobile/crypto.ts`).

## Authorization
- RLS on every new table (migrations `20261003100000`–`20261003160000`). Privileged mutations go through SECURITY DEFINER helpers (`mobile_staff_scan`, `mobile_staff_manual_checkin`, `admin_adjust_points`, deletion helpers).
- Staff features require a live (unrevoked, unexpired) `staff_assignments` row per event; checked server-side on every staff route. The app hiding the Staff entry is cosmetic only.
- Points are awarded only inside staff-verified transitions; ledger is append-only, net award capped at one per (user, event).

## Abuse controls
- Durable rate limits (`consume_rate_limit`) on every mutation; see table in `API.md`.
- Hacklanta link: no email enumeration (same answer whether or not an application matched), 6-digit code, 10 min TTL, 5 attempts, bcrypt-hashed, one account per application.
- Staff scan: 2.5 s client debounce plus server idempotency (`on conflict do nothing`).
- Wallet pass barcodes are opaque `pp1.` tokens; only SHA-256 is stored; reissue revokes the prior token.

## Transport
- HTTPS only in Release. ATS exceptions exist for `localhost` and `127.0.0.1` only (Debug convenience; harmless in Release but could be stripped).
- No certificate pinning (deliberate: Vercel/Supabase rotate certificates).

## Data at rest on device
- `DiskCache` JSON in Application Support, `completeUntilFirstUserAuthentication`, excluded from backup. User-scope cache is purged on sign-out.

## Known gaps / open items
- **`Progsu.entitlements` is an empty dict.** It has no `com.apple.developer.applesignin`, `com.apple.developer.associated-domains` (`applinks:members.progsu.com`, `webcredentials:members.progsu.com`), or `aps-environment`. Sign in with Apple, universal links and push will not work in a signed build until it is filled in (owned by whoever edits `ios/`). **Blocker.**
- `lib/mobile/hacklanta.ts` reads `applications` with `select("*")` via the Hacklanta service key; only mapped fields are returned to the client, but narrowing the select would reduce blast radius.
- No independent penetration test. Security review is code review plus smokes (`TEST-EVIDENCE.md`).
