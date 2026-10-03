# Progsu iOS app: architecture

Native SwiftUI app in `ios/Progsu`. iOS 17+, iPhone only, Swift 6. The only third-party dependency is
supabase-swift, pinned to exactly 2.55.3. The contract it talks to is `docs/ios/API.md`.

## Build

```
cd ios/Progsu
xcodegen generate            # project.yml is the source; Progsu.xcodeproj is committed too
xcodebuild -scheme Progsu -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

Config lives in `Config/*.xcconfig` and reaches the app through Info.plist keys. Debug points at local
Supabase (`127.0.0.1:54321`, the CLI's public demo anon key) and `localhost:3000`. ATS exceptions exist
for those two hosts only. Release points `API_BASE_URL` at `https://members.progsu.com` and leaves
`SUPABASE_URL`/`SUPABASE_ANON_KEY` empty; set them in `Config/Local.xcconfig` (gitignored) or in CI.
Copy `Config/Signing.example.xcconfig` to `Config/Signing.xcconfig` (also gitignored) to set
`DEVELOPMENT_TEAM`. The app holds no secrets. The anon key is public by design.

## Layout

| Folder | Role |
|---|---|
| `App/` | `ProgsuApp` (UIApplicationDelegate adaptor for APNs), `AppModel` (@MainActor @Observable: auth state, `/me`, `/config`, theme, tab and navigation paths, deep links), `RootView` (5 tabs, route table) |
| `Core/` | `APIClient` actor (envelope decode, error-code mapping, bearer token, 20 s timeouts, cancellation, bounded retry), `ProgsuAPI` (typed routes), `APIError`, `DiskCache`, `DeepLink`, `HacklantaTheme` (theme window, schedule grouping, now/next, filters), `QRCode` + `ScanDebouncer` |
| `Auth/` | `AuthService` actor (Supabase client, Apple ID-token sign-in, Google OAuth PKCE), `Nonce`, `SignInPanel` |
| `Models/API.swift` | Codable mirror of `lib/mobile/contracts.ts`: zod `.nullable()` maps to a Swift Optional; enums that may grow decode unknown values to a fallback case |
| `DesignSystem/` | Tokens copied from `app/globals.css` (HSL values), Hacklanta variant from the hacklanta-ii palette, ambient field, glass card, buttons, status pills, shared loading, empty, error and offline views |
| `Features/` | Home, Events, EventDetail, MyQR, Hacklanta (schedule, map, agenda, session), Announcements, Points, Profile, Onboarding, Settings, Staff |
| `Services/` | EventKitUI add-to-calendar, PassKit add-pass, wallet availability |

## Key decisions

- **Auth.** Sign in with Apple sends `SHA256(nonce)` to Apple and the raw nonce to
  `signInWithIdToken(.apple)`. Apple sends the user's name only on the first authorization. The app
  PATCHes `/me/profile` with that name only where the profile field is still empty. The authorization
  code goes to `POST /me/apple-authorization` so account deletion can revoke the Apple grant. Google uses
  supabase-swift's `ASWebAuthenticationSession` PKCE flow with the redirect `progsu://auth-callback`. The
  session is stored in the Keychain: `KeychainLocalStorage`, which is also the package default (checked
  in `AuthLocalStorage.swift`).
- **Token handling.** `APIClient` asks `AuthService` for a token on every request. After a 401 it forces
  one refresh and retries once. It retries only GET, PUT, DELETE, or requests that carry an
  `Idempotency-Key`, and only after a timeout, a transport failure or a 5xx. It never retries a 4xx.
- **Logout.** The app sends `DELETE /devices/{token}`, purges the `user` cache scope (pass, my events),
  signs out locally and resets navigation. The public cache (config, Hacklanta schedule) is kept.
- **Offline.** `DiskCache` writes JSON snapshots to Application Support with
  `completeUntilFirstUserAuthentication` and excludes them from backup. When a request fails, a screen
  shows its cached copy with "Offline. Last updated …". The app never shows invented content. If nothing
  has been published, the screen says so.
- **Theme.** `HacklantaThemeWindow.isActive` = manual preview OR `themeOverride == force_on` OR (`auto` and
  `startsAt <= now < endsAt`). It compares absolute instants, so the device timezone and DST cannot shift
  it. The theme is an environment value on a stable `TabView`, and navigation paths live in `AppModel`,
  so switching themes does not reset navigation. One timer re-evaluates the theme at the next window
  boundary, and the app re-checks it whenever it becomes active.
- **Hacklanta schedule.** The schedule is grouped by day in the edition's `timeZone`, not the device's
  (day tabs Fri/Sat/Sun). A null `endsAt` renders as "Starts 9:00 PM" and counts as "now" for 30
  minutes. `pointsNote` is an info label, never presented as a guaranteed award. `scheduleTentative`
  shows a notice. The room list is the distinct `roomLabel` values. There are no floor plans yet, so the
  map shows "Floor plans not published yet". The venue is geocoded at runtime with `MKLocalSearch` from
  the address unless the server supplies coordinates.
- **My QR.** The QR code is drawn with CoreImage, error-correction level M, an exact 4-module quiet zone
  and nearest-neighbour scaling, black on white. The short code is shown in groups of 4 and spelled out
  for VoiceOver. Screen brightness rises to at least 0.9 while the code is visible. It is restored when
  the view disappears, the app goes to the background, or the user switches tabs.
- **Staff.** The staff entry appears only when `/me.staffAssignments` is non-empty. The scanner is an
  AVFoundation QR scanner with a torch toggle. A 2.5 s per-code debounce stops one held-up code from
  firing repeated requests. It gives haptics and a VoiceOver announcement per result. Each of the 7 API
  `result` values gets its own title, icon and text, so the result never depends on colour alone. Staff
  can also type a short code, search the roster, and check someone in manually with a required reason.
- **Push.** Permission is requested only from Settings ("Turn on notifications"), never at launch.
  The device token is registered with `POST /devices` after sign-in. A notification's `userInfo.link` is
  routed through the same `DeepLink` parser as `progsu://` and universal links.
- **Deep links.** `progsu://event/<slug>`, `announcement/<id>`, `hacklanta/session/<id>`, `pass`, and
  `https://members.progsu.com/{events,announcements}/<id>` and `/hacklanta/sessions/<id>`. Ids are
  restricted to `[A-Za-z0-9_-]`, 200 characters max.

## Tests

`ProgsuTests`: fixture decoding, nonce and SHA256, theme window (including DST), schedule grouping in the
venue timezone, now/next, QR matrix and quiet zone, short-code formatting, debounce, deep-link parsing,
error mapping and retry policy through a stubbed `URLProtocol`. The fixtures are synthetic apart from the
Hacklanta schedule, and every fixture parses against the zod contracts; see `ProgsuTests/Fixtures/README.md`. `ProgsuUITests`: a smoke test that walks every
tab while logged out, plus a screenshot capture that is skipped unless `SCREENSHOT_DIR` is set.
