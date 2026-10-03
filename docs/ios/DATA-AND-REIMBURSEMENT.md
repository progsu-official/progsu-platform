# Data flows and reporting (affiliation, points)

"Reimbursement" here means reporting event attendance by affiliation (e.g. to GSU or a sponsor) as totals. Nothing in this branch moves money.

## Affiliation
- `profiles.affiliation`: `gsu_student | other_student | nonstudent` (self-reported; `unknown` blocks onboarding).
- `verifiedGsu` is derived: true only with a verified `student.gsu.edu` student email.
- On every attendance insert, a snapshot is written to `event_attendance_affiliations` (affiliation, verified flag, institution name at that moment). Officers can correct a snapshot with a reason; corrections are audited.
- Reporting uses snapshots, so later profile edits don't rewrite history. Reports are aggregate counts, never name lists (privacy policy v8).
- Evidence: `scripts/smoke-affiliation-snapshot.ts`, migration `20261003100000_affiliation.sql`.

## Points
- Per-event `point_rules.points` set on the admin App tab (`/admin/events/{id}?tab=mobile`); null = no award.
- Awards only via staff scan / staff manual check-in in the app. Web `/checkin`, self QR and admin backfill award nothing.
- Removing attendance writes a reversal; officers adjust with a reason (`admin_adjust_points`). Ledger is append-only; balance = sum.
- Points have **no cash value** and are not redeemable in the app. Hacklanta `pointsNote` is display text only and never auto-awarded. If points ever become redeemable for goods, re-check App Store guideline 3.1.1 and contest/sweepstakes rules (5.3) first.
- Evidence: `scripts/smoke-mobile-staff-points.ts` (incl. concurrent double-scan → one award), migration `20261003110000_points.sql`.

## Who sees what
| Data | Member (self) | Other members | Event staff | Admins |
|---|---|---|---|---|
| Affiliation + snapshots | own profile | no | no | yes |
| Points balance/history | yes | no | no | yes |
| RSVP/check-in status | yes | no (directory opt-in rules unchanged) | name (first + last initial) + status for their event | yes |
| Email / phone | yes | never | never | yes |
