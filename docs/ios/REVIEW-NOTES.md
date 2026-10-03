# App Review notes (draft)

Paste into App Store Connect › App Review Information › Notes. Replace every `<PLACEHOLDER>`.

---

Progsu is the member app for Progsu, a student programming and builders community at Georgia State University (Atlanta). Members use it to find and RSVP to community events, show a check-in QR code at the door, see announcements, track attendance points (no cash value, not redeemable), and use a guide for our hackathon, Hacklanta II (Oct 9–11, 2026).

**Demo account:**
Sign in with Apple or Google is the only sign-in method. We created a review account:
- Google account: `<REVIEWER_GOOGLE_EMAIL>` / password `<REVIEWER_PASSWORD>`
This account is already onboarded (18+ confirmed, consents accepted) so you land directly on Home.

**Things to try without attending an event**
1. Events tab → "App Review demo event" → RSVP Going. The event is published and open through `<DEMO_EVENT_END_DATE>`.
2. My QR tab → shows the check-in code for that account.
3. Profile → Points → points history (demo account has an award from a staff check-in).
4. Hacklanta mode: Profile → Settings → toggle "Preview Hacklanta mode". This switches the app to the Hacklanta theme and guide (schedule by day, rooms, bookmarks) outside the event dates. Toggle off to return.
5. Announcements: Profile → Announcements.

**Staff features**
Door-staff scanning appears only for accounts an officer assigns to a specific event. The review account has a staff assignment on the demo event, so Profile shows "Staff check-in": scan any member's QR (or type the 8-character short code `<DEMO_SHORT_CODE>` of a second demo member) to check them in. Scanning works from 2 hours before the event starts to 2 hours after it ends.

**Account deletion:** Profile → Settings → Delete my account → type DELETE. This is permanent and also revokes Sign in with Apple. Please use a fresh Apple ID sign-in if you want to test deletion, so the shared review account stays usable.

**Permissions:** Camera (staff scanner only), Calendar write-only (add an event you chose), notifications (requested only from Settings).

**Hacklanta application linking** requires an email that applied to Hacklanta II; it is not testable without one. It emails a 6-digit code and then shows that applicant's own status.

Contact: `<OWNER_NAME>`, hello@progsu.com, `<PHONE>`.

---

Owner checklist before submitting: create the account (`RELEASE-RUNBOOK.md` §7), create the demo event spanning the review window, grant staff on it, create a second demo member for scanning, and confirm Google sign-in works for a non-GSU Gmail. **Unverified:** whether reviewers can complete Google sign-in on the account if Google triggers a new-device challenge; consider disabling 2-step verification on that throwaway account.
