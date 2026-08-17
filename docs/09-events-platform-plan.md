# 09 — Events Platform Program Plan

Owner: Planning synth lead
Last revised: 2026-08-16 (D12 added: QR check-in reopens non-goal #10, see §7.5)
Status: Canonical program plan after multi-agent review
Canon for the existing platform: `docs/00-plan-review.md` + `docs/07-implementation-plan.md` + live code + `supabase/migrations/*`

This plan is **additive**. It extends the current Progsu member CRM into an internal events platform without rewriting auth, onboarding, recruiter export, consents, resumes, or the current admin/member split.

This document now covers the **whole requested goal**, not just a narrow V1:

1. admins can create and manage events
2. members can see events they went to
3. members can view other member profiles and shared event history, but only through an explicit, privacy-safe model

To keep that safe and buildable, the program is split into staged releases:

- **Release 1**: core events operations
- **Release 2**: opt-in member cards and profile viewing
- **Release 3**: opt-in shared-event discovery

Release 1 is the immediate implementation starting point. Releases 2 and 3 stay in this plan so the program still matches the stated product goal.

This is planning only. Do not implement from this doc without explicit go-ahead.

---

## 0. Resolved Canonical Decisions

These decisions replace contradictory parts of the earlier swarm draft.

| # | Topic | Canonical decision |
|---|---|---|
| D1 | Plan scope | This is a **program plan**, not a Release-1-only memo. Release 1 covers core events; Releases 2 and 3 cover member profile discovery and shared-event visibility. |
| D2 | Event management authority | **Admin-only in Release 1.** No non-admin organizer auth surface under `/admin/*` in the first release. |
| D3 | Event modeling | Event **status** and event **visibility** are separate concerns. Do not overload one column for both. |
| D4 | Waitlist behavior | **Manual promotion only in Release 1.** No automatic waitlist promotion. |
| D5 | Check-in code behavior | ~~One active self-check-in code per event window.~~ **Removed by D13, 2026-08-17.** See §7.4. |
| D6 | Cancelled event visibility | Cancelled events disappear from general discovery feeds, but remain visible on direct detail/history surfaces for admins and RSVP’d members. |
| D7 | Privileged writes | Event lifecycle mutations go through **server action -> RPC/helper -> audit**, not direct client table writes. |
| D8 | Peer profile viewing | Member-to-member profile discovery is **not** public. It is feature-flagged, opt-in, and uses a sanitized member-card projection rather than raw `profiles` reads. |
| D9 | Shared-event visibility | Shared-event history requires **mutual opt-in**, non-sensitive events, minimum attendee thresholds, and privacy-policy/copy updates before launch. |
| D10 | Notifications trust model | Event confirmations/reminders/cancellations are treated as transactional only after the app’s privacy/settings copy is updated to say so explicitly. |
| D11 | Document authority | This doc is self-contained. It does not rely on `/tmp` lane files or ephemeral swarm artifacts. |
| D12 | QR check-in (reopens non-goal #10, 2026-08-16) | Per-attendee QR check-in ships as a check-in entry path. A random `checkin_token` is generated on `event_rsvps` when status becomes `going`; the member's ticket view renders it as a QR. Staff scan it from the existing admin check-in screen, which resolves the token to the attendee and writes to `event_attendances` through the same helper/audit seam as every other check-in method. No new table, no "ticket" object, no payment concept, see §7.5. |
| D13 | Cut D5, QR is the sole staff-facing check-in mechanism (2026-08-17) | The shared per-event code (D5) never matched Luma's actual pattern, checked against their real docs: Luma is QR scan + staff manual name-search, not a typed shared code. Removed `self_check_in`, `rotate_check_in_code_with_raw`, `check_in_code_hash`/`check_in_code_expires_at`. QR (D12) is now primary; the pre-existing `admin_check_in_member` roster-search flow is the fallback, matching Luma exactly, no new fallback work needed. |

---

## 1. Current State Summary

The live repo today is a member CRM, not an events app.

- **Framework**: Next.js 15 App Router + React 19 + TypeScript.
- **Auth**: Supabase Auth with Google OAuth, SSR session refresh in `middleware.ts`.
- **Member funnel**: login -> optional school-email verification -> profile -> resume -> required consents -> dashboard.
- **Onboarding contract**: `lib/auth/onboarding.ts` is the canonical source of truth. It derives `profileFieldsComplete`, `hasCurrentResume`, `requiredConsentsCurrent`, `fullyOnboarded`, and `studentEmailVerified`.
- **Admin contract**: `/admin/*` is hard-gated by `profiles.is_admin`; non-admins get `notFound()`, not a 403.
- **Data model**: SQL migrations in `supabase/migrations/*` are the schema source of truth. Drizzle is types only.
- **Security posture**: RLS-first, helper functions like `is_admin()` and `write_audit()`, service-role access only on server paths, append-only consent/audit patterns.
- **Current member surface**:
  - `/login`
  - `/onboarding/*`
  - `/dashboard`
  - `/dashboard/settings`
- **Current admin surface**:
  - `/admin`
  - `/admin/members`
  - `/admin/members/[id]`
  - `/admin/export`
  - `/admin/domain-requests`
  - `/admin/audit`
  - `/admin/settings`
- **Current privacy posture**: effectively self + admin only. Cross-member profile browsing does not exist today.

### What stays unchanged

The following stay unchanged in Release 1 unless a later design decision explicitly reopens them:

- Google OAuth / Supabase auth model
- onboarding cascade and admin bypass
- recruiter export behavior and recruiter-specific SQL
- append-only consent ledger pattern
- private resume storage model
- `profiles`, `resumes`, `consents`, `audit_log`, `school_domains`, `domain_requests`, `account_deletion_requests` existing schemas
- SQL migrations as source of truth

### Key constraints the events program must respect

1. The current app allows full onboarding without requiring `studentEmailVerified`; recruiter export is where verification becomes a hard gate.
2. `profiles` is not safe as a direct member-visible read surface because it contains private contact data, verification state, and admin state.
3. The current app has no event routes, no member directory, and no delegated organizer auth model.
4. The current app’s CI is still lightweight; smoke scripts are primarily local integration tools today.

---

## 2. Product Goal And Framing

The right framing is:

**add an internal events operations layer on top of the trusted member graph**

This is not Eventbrite, not a public Meetup clone, and not a general social network.

The platform should help Progsu:

- publish and manage events
- let members discover and RSVP to events
- track actual attendance
- let members see their own event history
- eventually let members opt into discoverability and shared-event visibility in a controlled way

The user goal that drove this plan is broader than “just event CRUD.” It includes member profile viewing and shared event context. That is supported here, but it is intentionally phased because it changes the current privacy model.

### Program-level success criteria

- Officers can run Progsu events without spreadsheets and ad hoc Discord tracking.
- Members have one place to see what is happening and what they attended.
- The app gains profile and shared-event discovery only through explicit visibility controls and audit-friendly backend rules.
- No new data surface leaks email, phone, resume, verification state, or admin flags to peers.

---

## 3. Program Scope By Release

### 3.1 Release 1 — Core Events Operations

This is the smallest coherent shipping slice.

**In Release 1:**
- admin event CRUD
- draft / publish / cancel / archive lifecycle
- member event discovery inside the authenticated app
- RSVP with optional capacity + waitlist
- attendance / check-in
- self event history
- admin roster, check-in, and event analytics basics
- private-invite events
- event cover images
- transactional event notifications with corrected privacy copy

**Not in Release 1:**
- peer profile viewing
- member directory
- shared-event overlap
- non-admin organizer auth

### 3.2 Release 2 — Member Cards And Profile Viewing

This is the first release that satisfies the “view other people’s profiles” part of the ask.

**In Release 2:**
- `/members`
- `/members/[slug]`
- opt-in member cards with a strict field allow-list
- member-visible attended-event history only when the target user has enabled it
- feature flag + privacy-policy/copy update + audit trail for visibility changes

### 3.3 Release 3 — Shared Event Discovery

This is the release that satisfies the “what events this person and I both went to” part of the ask.

**In Release 3:**
- shared-events section on member profiles
- mutual opt-in requirement
- aggregate shared-event counts
- optionally named shared events only when all safety gates pass

---

## 4. Explicit Non-Goals

These are out of scope for the current program unless reopened explicitly.

1. No public anonymous event pages.
2. No guest checkout or unauthenticated RSVP.
3. No payments, tickets, dues, promo codes, or refunds.
4. No SMS or push notifications.
5. No full marketing automation or event-blast system in Release 1.
6. No public member directory.
7. No public attendance rosters.
8. No exposure of `google_email`, `student_email`, `phone_number`, resume metadata, consent history, verification state, or admin flags to other members.
9. No comments, chat, reactions, or event photos.
10. ~~No QR scanner native app or offline kiosk mode.~~ **Reopened 2026-08-16, see D12/§7.5.** Per-attendee QR check-in is now in scope, scanned from the existing admin web check-in screen (a browser `<video>` + decode, not a native app). Offline/kiosk mode is still out of scope, no change there.
11. No recurring-event engine in Release 1.
12. No delegated non-admin organizer auth in Release 1.
13. No automatic waitlist promotion in Release 1.
14. No attendance CSV export in Release 1.

---

## 5. Roles And Route Authority

### 5.1 Roles

| Role | Meaning | Release 1 authority |
|---|---|---|
| `admin` | `profiles.is_admin = true` | Full event management, roster access, check-in, analytics, settings |
| `member` | authenticated + `fullyOnboarded = true` | Browse events, RSVP, show QR at check-in, self history |
| `target member` | another member in Release 2+ | Viewable only through opt-in member-card rules |
| `unauthenticated` | no session | No event/profile access |

### 5.2 Route authority model

- `/admin/events*` is **admin-only** in Release 1.
- `/events*` is a member surface with its own layout and the same onboarding gate behavior as the dashboard shell.
- `/members*` does not exist until Release 2 and remains feature-flagged.

### 5.3 Host display vs admin authority

Do not conflate “people shown on the event page” with “people allowed to manage the event.”

- **Management authority** in Release 1 belongs only to admins.
- **Displayed hosts** are event content, not auth actors. Use an explicit display model like `event_hosts`, not the admin table or raw organizer auth state.

---

## 6. Canonical Route Map

### Unchanged routes

- `/`
- `/login`
- `/privacy`
- `/terms`
- `/auth/callback`
- `/onboarding/*`
- `/dashboard`
- `/dashboard/settings`
- `/admin`
- `/admin/members`
- `/admin/members/[id]`
- `/admin/export`
- `/admin/domain-requests`
- `/admin/audit`
- `/admin/settings`

### Release 1 new member routes

- `/events`
- `/events/[slug]`
- optional `/dashboard/events` if we choose a dedicated dashboard subsection rather than only a summary card

### Release 1 new admin routes

- `/admin/events`
- `/admin/events/new`
- `/admin/events/[id]`
- `/admin/events/[id]/check-in`

### Release 2 new member-directory routes

- `/members`
- `/members/[slug]`

### Route notes

- `/events` should be served by a dedicated events layout that reuses the member shell and applies the `fullyOnboarded` gate.
- `/members` should use the same member shell and gate, plus feature-flag and visibility checks.
- Private-invite event detail returns 404 to non-invitees.
- Cancelled events are removed from public/member discovery feeds, but direct detail remains available to admins and RSVP’d members.

---

## 7. Domain Model And State Machines

### 7.1 Event lifecycle

Use separate status and visibility.

- `event_status_t`: `draft | published | cancelled | archived`
- `event_visibility_t`: `members | private_invite`

Lifecycle:

`draft -> published -> cancelled -> archived`

Additional rules:

- drafts may be deleted
- published events may not be hard-deleted
- cancelled events remain visible in direct detail/history to admins and RSVP’d members
- archived events are admin-only by default

### 7.2 RSVP lifecycle

Use one `rsvp_status_t`:

- `going`
- `waitlisted`
- `declined`
- `cancelled`

State rules:

- first RSVP can become `going` or `waitlisted`
- members may change from `going` or `waitlisted` to `declined`/`cancelled`
- **manual promotion only** in Release 1: admins move `waitlisted -> going`
- no automatic promotion in Release 1

### 7.3 Attendance model

Attendance is separate from RSVP.

Canonical Release-1 model:

- one row per `(event_id, user_id)` in `event_attendances`
- rows are created by staff check-in, either QR scan or manual roster search (D13)
- corrections update the row through a dedicated RPC/helper
- audit log stores before/after history

This avoids the previous contradiction between “append-only ledger” and `unique(event_id, user_id)`.

### 7.4 Check-in code behavior — removed (D13, 2026-08-17)

~~One active code per event window, compared server-side, self check-in requires a valid code plus a `going` RSVP.~~ Cut entirely. See D13 and §7.5. `self_check_in`, `rotate_check_in_code_with_raw`, and the `check_in_code_hash`/`check_in_code_expires_at` columns are dropped (migration `20260817000100_remove_shared_checkin_code.sql`). `attendance_method_t` keeps the `self_code` value for historical/schema reasons, Postgres can't drop an enum value cheaply, but nothing can produce it anymore.

### 7.5 QR check-in (D12, 2026-08-16; sole staff-facing mechanism as of D13, 2026-08-17)

Reference model: Luma's actual check-in flow, verified against their real help docs, not guessed (`help.luma.com/p/check-in` + `help.luma.com/p/external-check-in-integration`). Luma's real pattern is a static per-registration QR **plus staff manual name-search as the fallback**, it has no shared typed code at all. D5 (the shared code) predated this project's Luma research and didn't match what Luma actually does; D13 cuts it so the app matches the reference model instead of carrying two unrelated check-in mechanisms.

**What this is, precisely:**

- `event_rsvps.checkin_token` — nullable column, a random opaque value (`gen_random_uuid()`). Generated by the RSVP trigger the moment status becomes `going`; cleared if the RSVP moves to `declined`/`cancelled`.
- Member's event page (`/events/[slug]`) renders the token as a QR when RSVP = `going` and the event window is open.
- **Scanning happens from the existing admin check-in screen** (`/admin/events/[id]/check-in`), browser camera access, no native app. A scanned token resolves to the attendee and writes to `event_attendances` via `admin_check_in_by_token`.
- **Fallback, matching Luma exactly: manual name/email search on the same admin check-in screen's roster**, already built (`admin_check_in_member`, predates this doc's QR work but is the correct Luma-equivalent fallback, not the removed shared code). No new work needed here, staff already can search a name and tap to check someone in without a working camera.
- `attendance_method_t` values in active use: `qr_token` (QR scan), `admin_click` (manual roster search/tap). `self_code` is retired.

**What this does NOT add:**
- No new table. No "ticket" as its own object, attendance is still exactly one row per `(event_id, user_id)` in `event_attendances`.
- No payment/ticket-tier concept, non-goal #3 is untouched.
- No offline/kiosk mode, still out of scope.

**Security note:** the token is unguessable (UUID-class entropy) and single-use in effect, `event_attendances` has a `unique(event_id, user_id)` constraint, so a second scan of an already-checked-in guest's QR fails the same way a duplicate manual check-in would, no new race condition. Appropriate security tier for an internal club event, not the rotating/signed-token tier used by resale-prone commercial ticketing.

---

## 8. Visibility And Privacy Model

### 8.1 Release 1 event visibility

**Member discovery**
- published `members` events are visible to fully onboarded members
- published `private_invite` events are visible only to invitees
- drafts are invisible to members
- archived events are invisible to members

**Event detail**
- members can open visible events
- RSVP’d members can still open cancelled event detail
- non-invitees get 404 on private-invite events

**People data on event pages**
- no attendee lists in Release 1
- no peer names in Release 1
- if host identity is shown, it comes from the explicit host-display model, not auth actors

### 8.2 Release 2 member-card visibility

Release 2 introduces a separate projection for peer-visible member pages.

Default:

- every member is private by default
- no `/members` access until the feature flag is on
- the target member must opt in

Allowed member-card fields:

- `preferred_name` or `first_name`
- `avatar_url`
- school
- class standing
- graduation term or year bucket
- interested roles
- optional “attended events this user chose to share”

Never expose:

- `google_email`
- `student_email`
- `phone_number`
- resume data or paths
- consent history
- verification state
- `is_admin`
- audit metadata

### 8.3 Release 3 shared-event rules

Shared-event discovery is allowed only when **all** of the following are true:

1. the viewer has enabled shared-event visibility
2. the target has enabled shared-event visibility
3. the event is not marked sensitive
4. the event is not `private_invite`
5. the event meets a minimum attendee threshold
6. the feature flag is enabled

Recommended thresholds:

- aggregate shared-event count only if attendee count >= 10
- named shared events only if attendee count >= 10 and the event is not sensitive

### 8.4 Release gates for privacy

Before Release 1 event emails:

- update `/privacy`
- update onboarding/settings copy to distinguish transactional event emails from marketing email

Before Release 2 member cards:

- privacy-policy update
- terms update if needed
- re-acceptance flow for the new privacy version

Before Release 3 shared-event discovery:

- privacy-policy update
- feature flag
- audit + rate-limit + threshold checks verified by smoke/integration tests

---

## 9. Schema Additions And Migration Plan

### 9.1 Release 1 new tables and enums

**Enums**
- `event_status_t`
- `event_visibility_t`
- `rsvp_status_t`
- `attendance_method_t` (`admin_click`, `qr_token` — added D12, 2026-08-16; `self_code` retired by D13, kept in the enum since Postgres can't drop values cheaply, but nothing produces it)

**Tables**
- `events`
- `event_hosts`
- `event_invites`
- `event_rsvps`
- `event_attendances`
- `event_notification_jobs` if queued reminder/cancellation delivery is needed for reliable fan-out

**Storage**
- new private `event-covers` bucket

### 9.2 Release 1 recommended tables

`events`
- `id`
- `slug`
- `title`
- `description_md`
- `status`
- `visibility`
- `starts_at`
- `ends_at`
- `location_text`
- `location_url`
- `capacity`
- `waitlist_enabled`
- `cover_image_path`
- `send_rsvp_email`
- `send_reminder_email`
- `reminder_sent_at`
- `cancellation_reason`
- `is_sensitive`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

`event_hosts`
- `event_id`
- `sort_order`
- `display_name`
- optional `profile_id` if later we want structured host references without using them as auth actors

`event_invites`
- `event_id`
- `user_id`
- `invited_by`
- `invited_at`

`event_rsvps`
- `event_id`
- `user_id`
- `status`
- `comment`
- `rsvp_at`
- `status_changed_at`
- `checkin_token` — added D12, 2026-08-16; nullable, set when `status` becomes `going`, cleared on `declined`/`cancelled`
- unique `(event_id, user_id)`

`event_attendances`
- `event_id`
- `user_id`
- `checked_in_at`
- `checked_in_by`
- `method`
- `updated_at`
- unique `(event_id, user_id)`

### 9.3 Release 1 read models

- `member_visible_events` — `SECURITY INVOKER` view for member event discovery
- `self_event_history` — `SECURITY INVOKER` view for a member’s own RSVP/attendance history
- `admin_event_roster_for(p_event_id)` — audited RPC/helper for admin roster access rather than a casually readable sensitive view

### 9.4 Release 2 additions

- `profile_visibility_settings`
  - `user_id`
  - `profile_slug`
  - `discoverable`
  - `share_attended_events`
  - `share_shared_event_counts`
  - `updated_at`
- `member_cards` — sanitized `SECURITY INVOKER` view or RPC-backed projection

### 9.5 Migration table

#### Release 1

| Order | Migration | Purpose |
|---|---|---|
| 1 | `20260423xxxxxx_events_core.sql` | enums, `events`, `event_hosts`, `event-covers` bucket, CRUD helpers |
| 2 | `20260423xxxxxx_event_rsvps_invites.sql` | `event_invites`, `event_rsvps`, RSVP helpers, waitlist helpers |
| 3 | `20260423xxxxxx_event_attendance.sql` | `event_attendances`, self/admin check-in, correction helpers |
| 4 | `20260423xxxxxx_event_views_notifications.sql` | member views, admin roster helper, reminder flags, notification jobs if used |
| — | `20260816xxxxxx_qr_checkin.sql` (D12, not yet written) | `checkin_token` on `event_rsvps`, `qr_token` enum value, `admin_check_in_by_token` helper |

#### Release 2

| Order | Migration | Purpose |
|---|---|---|
| 5 | `20260423xxxxxx_member_cards.sql` | `profile_visibility_settings`, `member_cards`, profile-view helpers |

#### Release 3

| Order | Migration | Purpose |
|---|---|---|
| 6 | optional | only if shared-event visibility needs extra schema beyond Release 2 settings |

### 9.6 Cross-schema impact

Release 1 should not modify existing `profiles`, `resumes`, `consents`, or `audit_log` schemas.

Release 2+ also should avoid changing raw `profiles` if possible. Use projection/settings tables instead.

---

## 10. Permission Model, RLS, And Helpers

### 10.1 Release 1 RLS model

`events`
- admin: full read/write
- member: read published rows they are allowed to see
- no direct member writes

`event_invites`
- admin: full read/write
- invited member: read own invite rows

`event_rsvps`
- member: read own rows
- admin: read all
- direct client inserts/updates/deletes denied

`event_attendances`
- member: read own rows
- admin: read all
- direct client inserts/updates/deletes denied

### 10.2 Release 1 helpers

- `create_event`
- `update_event`
- `publish_event`
- `cancel_event`
- `archive_event`
- `delete_draft_event`
- `invite_member_to_event`
- `revoke_event_invite`
- `rsvp_to_event`
- `promote_waitlisted_member`
- `admin_check_in_member`
- `admin_check_in_by_token` — added D12, 2026-08-16; resolves `checkin_token` to an attendee, then writes through the same seam as `admin_check_in_member`
- `correct_attendance`
- `can_view_event`
- `is_fully_onboarded`

### 10.3 Canonical mutation seam

Release-1 rule:

- privileged writes go through **server action -> RPC/helper -> audit**
- do not rely on direct `.from('events').update()` for lifecycle mutations
- direct table access is acceptable for straightforward reads when the projection and RLS are already safe

### 10.4 `is_fully_onboarded()` parity contract

The DB helper must match `lib/auth/onboarding.ts` exactly:

- required profile fields:
  - `first_name`
  - `last_name`
  - `school`
  - `major`
  - `class_standing`
  - `grad_year`
  - `grad_term`
- `interested_roles` must be non-empty
- required consents must be the latest accepted rows at the current versions
- `studentEmailVerified` remains a soft gate, not part of `fullyOnboarded`

This parity test is a hard merge gate for Release 1.

### 10.5 Release 2/3 profile-view helpers

Do not expose raw `profiles`.

Use explicit helpers such as:

- `can_view_member_card(viewer_id, target_id)`
- `member_card_for_viewer(viewer_id, target_slug)`
- `shared_events_for_viewer(viewer_id, target_id)`

These helpers must enforce visibility settings, event sensitivity rules, attendee thresholds, and mutual opt-in where required.

---

## 11. UX Plan

### 11.1 Release 1 admin UX

Add `Events` to the existing admin nav.

Core screens:

- `/admin/events`
- `/admin/events/new`
- `/admin/events/[id]`
- `/admin/events/[id]/check-in`

Recommended admin information architecture:

- `List`: Draft, Published, Past, Cancelled, Archived
- `Details`: content, date/time, location, cover image
- `Access`: visibility, invites, capacity, waitlist
- `Guests`: roster and RSVP management
- `Notifications`: confirmation/reminder/cancellation settings
- `Check-in`: day-of operations
- `Activity`: audit timeline
- `Review & publish`: final confirmation step

### 11.2 Release 1 member UX

`/events`
- tabs: `Upcoming`, `My Plans`, `Past`
- `My Plans` = future events where the member is `going`, `waitlisted`, or invited but not responded
- `Past` = attended history first, with cancelled/declined rows handled explicitly in copy

`/events/[slug]`
- hero
- date/time
- location
- host label
- RSVP area
- cancellation/reschedule banner when applicable
- check-in CTA during the valid event window if RSVP = `going`

Dashboard
- add an “Upcoming events” summary card on `/dashboard`

Private-invite flow
- invited members should receive in-app visibility and optional invite messaging
- an invite should surface as an explicit state, not only as “the event happens to appear”

### 11.3 Release 2 member-card UX

`/members`
- feature-flagged
- minimal card list only for discoverable members

`/members/[slug]`
- sanitized member profile
- optional attended events they chose to share
- no contact info

### 11.4 Release 3 shared-event UX

On a member profile:

- `Shared events with you`
- initially aggregate counts
- named shared events only after all visibility thresholds pass

---

## 12. Notifications, Email, And Copy

### 12.1 Release 1 notification scope

Ship:

- in-app confirmation toasts
- in-app cancellation/reschedule banners
- transactional RSVP confirmation email
- transactional reminder email
- transactional cancellation email

Do not ship:

- SMS
- push
- marketing digests
- broad event blasts

### 12.2 Transactional classification

RSVP confirmations, reminders, and cancellations are transactional because they are triggered by the member’s participation in an event workflow.

However, Release 1 must not rely on that classification silently. Before launch:

- update `/privacy`
- update settings copy
- state clearly that event participation can trigger operational emails even when marketing emails are off

### 12.3 Operational email reliability

The current codebase mostly sends single emails inline. Bulk event sends are a new operational pattern.

Recommended Release-1 rule:

- confirmations may send inline
- reminders and large cancellation fan-out should be driven through a cron/job path or a capped batched worker
- if a simple background job table is introduced, it belongs in migration 4

### 12.4 Required new env/config

- `FEATURE_EVENTS`
- `FEATURE_MEMBER_DIRECTORY`
- `FEATURE_SHARED_EVENT_HISTORY`
- `CRON_SECRET`

---

## 13. Testing Strategy

### 13.1 Local required smoke scripts

Release 1:

1. `smoke-event-crud`
2. `smoke-event-rsvp`
3. `smoke-event-check-in`
4. `smoke-event-visibility`
5. `smoke-event-reminder-cron`
6. `smoke-onboarding-parity`

Release 2:

7. `smoke-member-cards-visibility`

Release 3:

8. `smoke-shared-events-visibility`

### 13.2 CI reality

Current CI is lightweight. The plan should not pretend integration smoke coverage already exists in CI.

Required before Release-1 GA:

- add an integration workflow that boots Supabase
- run at least the Release-1 smokes there
- keep `lint`, `typecheck`, and `build` green

### 13.3 Hard gates

Release 1 merge blockers:

- migration set applies cleanly with `supabase db reset`
- Release-1 local smokes green
- onboarding parity smoke green
- RLS checks for event/feed/history surfaces green

Release 2 merge blockers:

- member-card visibility tests green
- direct raw-profile peer reads remain denied

Release 3 merge blockers:

- mutual opt-in and threshold checks green
- private-invite and sensitive-event overlap stays impossible

---

## 14. Rollout Plan

Replace date-based rollout with prerequisite-based rollout.

### 14.1 Prerequisites

Before any production events release:

- production deploy path wired
- Supabase prod project linked
- env vars present
- cron wiring available if reminder/cancellation jobs use it
- integration workflow added or an explicitly approved temporary local-only release process

### 14.2 Release 1 rollout

Phase A — admin-only preview
- feature flag on for admins only
- officers create test events
- validate CRUD, RSVP, check-in, cancellation, reminders, audit

Phase B — member pilot
- enable member `/events`
- run one real event through the system
- watch logs, reminders, audit rows, and no-show/check-in flows

Phase C — Release-1 GA
- remove preview restriction
- keep kill switch active

### 14.3 Release 2 rollout

- ship member cards behind `FEATURE_MEMBER_DIRECTORY`
- pilot with a small opt-in group
- verify profile projection and history sharing rules

### 14.4 Release 3 rollout

- ship shared-event history behind `FEATURE_SHARED_EVENT_HISTORY`
- require mutual opt-in and privacy threshold checks
- pilot slowly

### 14.5 Kill switches

- `FEATURE_EVENTS`
- `FEATURE_MEMBER_DIRECTORY`
- `FEATURE_SHARED_EVENT_HISTORY`

### 14.6 Rollback guidance

Do not assume a rich rollback pipeline already exists.

Canonical rollback posture should remain aligned with `docs/07`: use feature flags and forward hotfixes first; only use migration-repair workflows when necessary and deliberate.

---

## 15. Risks And Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Cross-user event/profile data leaks | Critical | sanitized projections only, helper-backed access, RLS/integration tests |
| `is_fully_onboarded()` drift from app logic | Critical | parity smoke is a hard merge gate |
| Waitlist behavior confusion | High | one canonical rule: manual promotion only in Release 1 |
| Organizer/admin auth drift | High | admin-only Release 1 event management |
| Notification trust gap | High | privacy/settings copy update before transactional event email rollout |
| Bulk reminder/cancellation timeouts | High | use cron/job path or capped batching, not blind inline fan-out |
| QR token forwarded/screenshotted (D12) | Low | unguessable token + `unique(event_id, user_id)` on `event_attendances` means only the first scan succeeds regardless of who holds the image; manual roster search (`admin_check_in_member`) is the fallback if a camera's unavailable, not a security boundary being removed |
| Private-invite event leakage through covers or projections | Medium | cover bucket gated by event visibility rules |
| Shared-event inference in small/private groups | Critical for Release 3 | mutual opt-in, thresholding, no private-invite/sensitive overlap, audit |

---

## 16. Open Product Decisions

These still need owner sign-off before implementation starts.

1. For Release 1, should event discovery require `fullyOnboarded` only, or also verified student email?
2. Should host display be free text only, structured host profiles, or both?
3. Should invited-but-unanswered events appear under `My Plans`, or get a dedicated `Invited` tab/state?
4. Should waitlist position be shown to members in Release 1?
5. Do we want reminder email on by default for every event, or opt-in per event?
6. Is Release 2 allowed to show attended-event history on a member card by default once the target opts in, or should that be a separate setting from discoverability?
7. In Release 3, do we stop at aggregate shared-event counts, or allow named shared-event lists once the safety rules pass?

---

## Appendix A — What Stays Unchanged From The Current Member Platform

- auth model
- onboarding funnel
- admin bypass of onboarding
- recruiter export
- resume lifecycle
- append-only consents
- existing admin/member route split
- SQL migrations as schema source of truth
- existing `profiles`, `resumes`, `consents`, `audit_log`, `school_domains`, `domain_requests`, and `account_deletion_requests` schemas

---

## Final Note

The earlier swarm draft was strongest on Release-1 core events, but it undershot the stated product goal and carried several internal contradictions. This revised plan fixes that by doing two things:

1. making Release 1 smaller and more internally coherent
2. keeping the broader member-profile and shared-event goal inside the same program, but only after the required privacy and projection work exists

That is the safest way to get the results you asked for without pretending the current self+admin-only privacy model can be relaxed for free.
