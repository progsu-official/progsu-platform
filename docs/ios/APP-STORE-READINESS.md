# App Store readiness matrix

Status: **IT** implemented-tested · **IU** implemented-unverified · **BO** blocked-owner · **GAP** not implemented.

| Requirement | Evidence | Status |
|---|---|---|
| Account deletion in app (5.1.1(v)) | Settings › Delete my account; `POST /me/delete`; `smoke-account-deletion.ts` | IT (local) |
| Sign in with Apple offered alongside Google (4.8) | `Auth/AuthService.swift`, `SignInPanel` | IU — needs entitlement + prod keys |
| SIWA token revocation on deletion | `lib/mobile/apple.ts`, `/me/apple-authorization` | IU — needs real Apple keys |
| Privacy policy URL, in app + listing | `/privacy` (v8, public); Settings links it | IT (`smoke-support-aasa.ts`); policy still labelled "Draft", attorney sign-off pending → BO |
| Support URL | `/support` (public) | IT |
| Privacy manifest | `PrivacyInfo.xcprivacy` | IU — missing Phone/Other User Content/Product Interaction (`PRIVACY-NUTRITION.md`) |
| Nutrition label answers | `PRIVACY-NUTRITION.md` | BO (enter in ASC) |
| Purpose strings | `Info.plist` camera, calendar write-only | IT (present) |
| Push permission not at launch | Settings toggle only (ARCHITECTURE.md) | IU |
| Entitlements (SIWA, associated domains, aps-environment) | `Progsu.entitlements` is empty | **GAP → owner of ios/** |
| Universal links | AASA route + `DeepLink.swift` | IT server-side; IU on device (needs entitlement) |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` | IT (present) |
| Age gate 18+ | Onboarding toggle + `age_confirmation` consent | IT (shared consent helpers) |
| UGC moderation (1.2) | No UGC surfaced in app | N/A for 1.0 |
| Demo account + notes | `REVIEW-NOTES.md` | BO |
| Minimum functionality (4.2) | native events, QR, staff scan, Wallet, push, Hacklanta guide | IU (reviewer judgement) |
| Production backend live | runbook §2–§5 | BO |
| Kill switch | `FEATURE_MOBILE_API` | IU (route-edge check in `lib/mobile/http.ts`; no smoke asserts the off state) |
| Forced update path | `/config.minSupportedBuild` | IU — app behaviour on mismatch not checked here |
| Screenshots 6.9" | `ScreenshotUITests` | BO (not captured) |
| App icon 1024 | `AppIcon.png` 1024px, no alpha | IT (checked with sips) |
| Terms consistency | `/terms` v1 says "students 18+ at an allowlisted school", but affiliation now allows non-students | GAP — terms copy out of date |
| Policy domain | `/privacy` cites `progsu.app/members/<slug>`; prod host is `members.progsu.com` | GAP — copy fix |
