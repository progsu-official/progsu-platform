# App Store privacy ("nutrition label") inventory

Derived from the app code (`ios/Progsu/Progsu/Models/API.swift`, `Features/*`), the mobile API (`lib/mobile/contracts.ts`), and privacy policy v8. Apple's label covers data collected **through the app**; because the app signs into the same account as the web, data entered on the web and linked to the account is declared too (conservative reading).

**Tracking: No.** No ad SDKs, no IDFA/AdSupport, no third-party analytics or crash SDK (grep of `ios/` for analytics/Firebase/Sentry/AdSupport is empty). Only dependency: supabase-swift. No data is shared with data brokers or used for third-party advertising.

## Field-by-field

| Data (App Store category) | Collected where | Purpose | Linked | Tracking |
|---|---|---|---|---|
| Name (Contact Info › Name) | Apple/Google sign-in; `PATCH /me/profile` first/last/preferred | App functionality | Yes | No |
| Email address (Contact Info › Email) | Sign-in identity (incl. Apple relay); student email verification; Hacklanta link email (used for lookup + code, not stored as a profile field) | App functionality | Yes | No |
| Phone number (Contact Info › Phone) | `PATCH /me/profile phoneNumber` (required in onboarding) | App functionality (event SMS only if separately opted in on web) | Yes | No |
| User ID (Identifiers › User ID) | Supabase auth user id; check-in code | App functionality | Yes | No |
| Device ID (Identifiers › Device ID) | APNs push token via `POST /devices` | App functionality (push) | Yes | No |
| Other User Content | Affiliation, school/institution, major (onboarding); web-only: bio, note, banner, LinkedIn/GitHub/portfolio | App functionality | Yes | No |
| Photos (User Content › Photos or Videos) | Avatar/banner — **web only**, not uploaded from the app. Declare only if you take the conservative "account-linked" reading | App functionality | Yes | No |
| Other User Content › resume | Web only (PDF) | App functionality | Yes | No |
| Product Interaction (Usage Data) | RSVPs, check-ins, points ledger, announcement read receipts, Hacklanta bookmarks | App functionality | Yes | No |
| Sensitive Info | Not collected (no DOB, race, gender, health) | — | — | — |
| Location | **Not collected.** Venue is geocoded from its address with MapKit; the user's location is never requested | — | — | — |
| Camera | Used by staff scanner in memory; images not stored or sent (only the decoded code string) | Not "collected" | — | — |
| Calendar | Write-only add-event via EventKitUI; never read | Not collected | — | — |
| Diagnostics / crash data | Not collected by the app (Apple's opt-in crash reports are Apple's, not ours) | — | — | — |

## Mismatch with `PrivacyInfo.xcprivacy` (owner of `ios/` to fix)
The manifest declares Name, Email, User ID, Device ID only. It is missing at least **Phone Number** (`NSPrivacyCollectedDataTypePhoneNumber`), **Other User Content** (`...OtherUserContent`) and **Product Interaction** (`...ProductInteraction`). App Store Connect answers and the manifest should agree. Required-reason APIs declared: UserDefaults `CA92.1`, file timestamp `C617.1` — **unverified** that supabase-swift 2.55.3 ships its own manifest covering its usage.
