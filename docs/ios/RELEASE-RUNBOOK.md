# Release runbook: Progsu iOS 1.0

Ordered. Owner-run steps are marked **(owner)**. Production site: `https://members.progsu.com` (Release `API_BASE_URL`, `UNIVERSAL_LINK_HOST`).

## 1. Apple Developer portal (owner)
1. Identifiers › App ID `com.progsu.app` with capabilities: Sign in with Apple, Associated Domains, Push Notifications. (Wallet passes use a separate Pass Type ID; the app does not need the Wallet capability to add passes via PassKit.)
2. Pass Type ID (e.g. `pass.com.progsu.app`) → create Pass Type certificate → export signer cert + key PEM; download Apple WWDR G4 PEM.
3. Keys: one key with Sign in with Apple (→ `APPLE_KEY_ID`, `.p8` → `APPLE_PRIVATE_KEY`) and one with APNs (→ `APNS_KEY_ID`, `.p8` → `APNS_PRIVATE_KEY`). Record the Team ID.
4. **Fill `ios/Progsu/Progsu/Resources/Progsu.entitlements`** (currently empty — blocker): `com.apple.developer.applesignin = [Default]`, `com.apple.developer.associated-domains = [applinks:members.progsu.com, webcredentials:members.progsu.com]`, `aps-environment = $(APS_ENVIRONMENT)`.

## 2. Supabase production (owner)
1. Back up the database (Dashboard › Database › Backups, or `pg_dump`) **before** migrations.
2. Apply migrations `20261003100000` … `20261003160000` (`supabase db push` against prod, or `scripts/apply-migration.ts`). Confirm `consent_versions.privacy_policy = v8` afterwards; every user will be re-prompted for consent (intended).
3. Auth › Providers › Apple: enable; Client IDs include `com.progsu.app` (native ID-token flow). Google: confirm enabled.
4. Auth › URL Configuration › Redirect URLs: add `progsu://auth-callback`.

## 3. Vercel production env (owner)
New since `main` (from `.env.example`): `FEATURE_MOBILE_API`, `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICES_ID` (= `com.progsu.app`), `IOS_BUNDLE_ID` (optional, default `com.progsu.app`), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` (= `com.progsu.app`), `PASS_TYPE_ID`, `PASS_TEAM_ID`, `PASS_SIGNER_CERT`, `PASS_SIGNER_KEY`, `PASS_SIGNER_KEY_PASSPHRASE`, `PASS_WWDR_CERT`, `HACKLANTA_SUPABASE_URL`, `HACKLANTA_SUPABASE_SECRET_KEY`. Optional: `MOBILE_MIN_SUPPORTED_BUILD` (default 1).
Set `FEATURE_MOBILE_API=true` only after steps 2 and 4 pass. Deploy.

## 4. Verify web (anyone)
- `curl -sI https://members.progsu.com/.well-known/apple-app-site-association` → 200, `application/json`, no redirect.
- `https://members.progsu.com/support` and `/privacy` load signed out.
- `curl https://members.progsu.com/api/mobile/v1/config` → `{"ok":true,...}`.

## 5. Hacklanta guide (owner)
`pnpm tsx scripts/import-hacklanta-schedule.ts --remote --publish` with `.env.local` pointing at prod. Then check `/admin/hacklanta` (venue, theme window, published).

## 6. Admin setup
- Demo event + points rule + staff assignments on the event's App tab (`/admin/events/{id}?tab=mobile`).
- Real Hacklanta staff assignments with expiry after Oct 11.

## 7. Reviewer demo account (owner)
Create a throwaway Google account, sign in once in the app, complete onboarding, RSVP to the demo event, grant it staff on the demo event, award a point by scanning a second demo member. Put credentials in App Store Connect only (not in git).

## 8. Build config
`ios/Progsu/Config/Local.xcconfig` (gitignored): `SUPABASE_URL = https:/$()/<prod-ref>.supabase.co`, `SUPABASE_ANON_KEY = <prod anon key>`. `Config/Signing.xcconfig`: `DEVELOPMENT_TEAM = <TEAM_ID>`. Bump `CFBundleVersion` in `Info.plist` for every upload.

## 9. Archive and upload
```
cd ios/Progsu && xcodegen generate
xcodebuild -scheme Progsu -destination 'platform=iOS Simulator,name=iPhone 17' test
xcodebuild -scheme Progsu -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/Progsu.xcarchive archive
xcodebuild -exportArchive -archivePath build/Progsu.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export -allowProvisioningUpdates
xcrun altool --upload-app -f build/export/Progsu.ipa -t ios \
  --apiKey <ASC_KEY_ID> --apiIssuer <ASC_ISSUER_ID>
```
`ExportOptions.plist` (not in repo): `method = app-store-connect`, `teamID`, `destination = upload` (with `destination = upload`, `-exportArchive` uploads directly and `altool` is unnecessary). Xcode Organizer › Distribute App is the equivalent GUI path. Install via TestFlight on a real device and run §4 + sign-in, push, Wallet, universal link (`https://members.progsu.com/events/<slug>` from Notes) before submitting.

## 10. App Store Connect
- Metadata: `STORE-LISTING.md`. Privacy answers: `PRIVACY-NUTRITION.md`. Review notes: `REVIEW-NOTES.md`.
- **Age rating**: no violence/sexual/profanity/gambling/drugs content; Unrestricted Web Access: No; **User-generated content: none shown in the app** (the peer directory with bios is web-only; the app shows only officer-written announcements, staff rosters as first name + last initial, and Hacklanta teammate first names). Contests: No. Expected 4+; the 18+ requirement is enforced at onboarding by our terms, not by the rating. If a future build adds the directory, answer UGC Yes and add report/block (guideline 1.2).
- **Export compliance**: the app uses only standard HTTPS/TLS via Apple's networking stack and CryptoKit SHA-256 for the Sign in with Apple nonce. That is exempt; `ITSAppUsesNonExemptEncryption = NO` is already set in `Info.plist`, so no per-build prompt.
- Submit; then `EXPEDITE-REQUEST.md` if needed.

## 11. Kill switches and monitoring
- `FEATURE_MOBILE_API=false` → every `/api/mobile/v1` route 404s before auth (app shows its offline/error state). `FEATURE_EVENTS` additionally gates event routes. Missing `APNS_*`/`PASS_*`/`APPLE_*`/`HACKLANTA_*` disables just that feature.
- Force update: raise `MOBILE_MIN_SUPPORTED_BUILD`.
- Watch Vercel logs for `/api/mobile/v1/*` 5xx (responses carry `X-Request-Id`) and `/api/cron/push-outbox`.
- **Expiry calendar**: Pass Type certificate (1 year), Apple Distribution cert (1 year), provisioning profile (1 year), Sign in with Apple and APNs `.p8` keys don't expire but are revocable. Supabase Apple provider client secret, if configured for the web flow, expires every ≤6 months.
