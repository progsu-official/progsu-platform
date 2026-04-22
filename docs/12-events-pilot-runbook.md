# R1 Events — Pilot Rollout Runbook

Last revised: 2026-04-22

This runbook walks through Phase A → B → C of the R1 rollout per
`docs/09-events-platform-plan.md` §14.2. It assumes R1 code is merged and
deployed to Vercel, but `FEATURE_EVENTS` has not yet been flipped on.

At the end of Phase C, R1 is GA and officers can use `/admin/events` for any
real event without needing this runbook.

**Before you start**, make sure these have already landed:

- All R1 migrations applied in production (`supabase db push`).
- `scripts/smoke-onboarding-parity` green against production DB.
- A named owner for the pilot event (probably you).
- A low-stakes first event picked — officer meeting, coworking session,
  demo day. Nothing with >~30 attendees for the first run.

---

## Phase 0 — Vercel env setup (one-time)

Log in to the Vercel dashboard for the Progsu project, then:

```bash
# Generate a strong cron secret.
openssl rand -base64 32

# Set it in Vercel (repeat for preview if you want cron to fire on previews).
vercel env add CRON_SECRET production
# Paste the generated value.

# Flag. Leave OFF for now — we'll flip in Phase A.
vercel env add FEATURE_EVENTS production
# Type: false
```

Trigger a deploy. `vercel.json` already declares the two cron jobs; they
start running as soon as `CRON_SECRET` exists.

**Sanity check**: once deployed, hit both cron routes with the secret. They
should return 200 even when there's no work:

```bash
curl -i -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/event-reminders

curl -i -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/event-notifications
```

Expected: `200 OK` with JSON like `{"ok":true,"eventsScanned":0,...}`.
Without the header, both routes return 401.

---

## Phase A — admin-only preview (no real attendees)

**Goal**: officers confirm the happy path works without any members seeing
event routes.

### Step A1 — flip the flag on

```bash
vercel env rm FEATURE_EVENTS production
vercel env add FEATURE_EVENTS production
# Type: true
```

Redeploy so the new env takes effect. After redeploy, hitting `/events` as a
member-role user should now reach the onboarding cascade or the directory
page; before, it 404'd.

Non-admins don't know it exists yet — no announcement to members. Admins see
the "Events" link in their admin nav.

### Step A2 — seed the pilot event

Use the pilot tool from your local machine against production:

```bash
pnpm tsx scripts/pilot-event.ts create
```

It will prompt for title, slug, starts_at, ends_at, location, capacity.
Defaults are sensible for a session starting tomorrow at 6pm for 2 hours.
Slug defaults to `pilot-YYYY-MM-DD`.

After create, the tool prints the draft event URL. Visit `/admin/events/[id]`
and sanity-check the details tab.

### Step A3 — publish

```bash
pnpm tsx scripts/pilot-event.ts publish --id <uuid>
```

The tool prints a check-in code to the terminal. **Write this down.** It
won't be shown again. The hash is stored in the DB; this is the only time
the raw string is visible.

You can also rotate the code yourself from `/admin/events/[id]` under the
Check-in tab if you want a prettier code.

### Step A4 — each officer RSVPs themselves as a real member

Every officer with a Google-linked Progsu account should visit
`/events/[slug]` and RSVP "going" on their own. Watch for:

- RSVP confirmation email arrives (check spam folders).
- Email is sent via the Resend transport — log into the Resend dashboard
  and confirm each delivery succeeded.
- The admin roster at `/admin/events/[id]?tab=guests` updates live as
  officers RSVP.

### Step A5 — cancel + re-publish drill

On the draft event, or a separate throwaway draft:

1. Publish.
2. Have 2 officers RSVP going.
3. `pnpm tsx scripts/pilot-event.ts cancel --id <uuid>`
4. Each officer should receive a cancellation email with your reason.
5. `pnpm tsx scripts/pilot-event.ts archive --id <uuid>` to clean up.

This proves the cancellation fan-out works. Verify the Vercel function
logs for `/api/cron/event-notifications` show jobs being drained.

### Step A6 — reminder drill

The reminder cron fires when `starts_at` is 20-30 hours out. Don't wait
for that — fire it manually:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/event-reminders
```

Then drain the queue:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/event-notifications
```

All officers with `going` RSVPs get a reminder email. Check delivery.

### Exit criteria for Phase A

- All officers received confirmation + reminder emails reliably.
- Cancellation drill round-tripped cleanly.
- No errors in Vercel function logs.
- `/admin/events/[id]?tab=activity` shows the full audit trail of all actions.

If any of these fail: fix and re-drill. **Do not proceed to Phase B until
Phase A is clean.**

---

## Phase B — member pilot (one real event)

**Goal**: one low-stakes event runs through the system with real member
attendees.

Recommended first event: a regular officer meeting or coworking session.
Not a flagship event. Not >30 attendees. Not anything time-sensitive
(don't pick your Fall kickoff for the pilot).

### Step B1 — announce to members

Members already see `/events` if they're fully onboarded (the flag is on
from Phase A). But they have no reason to visit unless told.

Post to Discord or your usual member channel: "Our events platform is
live for its first test run. RSVP at progsu.app/events for [event name].
Let us know if anything breaks." Keep it low-key — people are more
forgiving when told it's a beta.

### Step B2 — watch the roster fill

Visit `/admin/events/[id]?tab=guests` periodically. Things to notice:

- Going count climbs smoothly.
- If capacity is set, does the waitlist populate after full?
- If you manually promote a waitlisted member, do they get an RSVP
  confirmation? (They should.)

Run `pnpm tsx scripts/pilot-event.ts status --id <uuid>` from anywhere
for a quick text summary.

### Step B3 — day-of check-in

At the event, open `/admin/events/[id]/check-in` on a laptop. This is the
day-of operations page. Two check-in paths:

**Self check-in**: share the check-in code you recorded in Phase A3
verbally. Members open `/events/[slug]/check-in` on their phones, type
the code, and are marked attended.

**Admin check-in**: admin taps the "Check in" button next to each going
RSVP on the day-of page. Useful for walk-ins (no RSVP required — the
helper allows walk-ins on published events per plan §7.3).

Either works. Expect both at a real event.

### Step B4 — after the event

Either leave the event as "published" (it naturally becomes "past") or
archive it:

```bash
pnpm tsx scripts/pilot-event.ts archive --id <uuid>
```

Archived events disappear from the discovery feed but remain visible to
members who attended. Admins see them in `/admin/events?tab=archived`.

### Exit criteria for Phase B

- At least one member self-checked-in with the shared code.
- At least one admin-click check-in.
- No members reported broken flows.
- Audit log contains full trail:
  `event.create`, `event.publish`, `event.rotate_check_in_code`,
  several `event.rsvp`, several `event.self_check_in` or
  `event.admin_check_in`.

If any member flow is broken: fix in code, deploy, archive the pilot
event, retry Phase B with a fresh event.

---

## Phase C — R1 GA

**Goal**: remove the "preview" mental framing. Officers start using
`/admin/events` for real events without a runbook.

### Step C1 — retrospect Phase B

- What emails did members open / ignore?
- Did anyone get confused by the RSVP / waitlist UI?
- Any friction in admin event creation?

Write up any found issues as GitHub issues and queue them for normal
product work. Known pre-existing gaps are listed in
`docs/09-events-platform-plan.md` §15 and the TODO comments in the
admin code.

### Step C2 — declare GA

There's no switch for this — the flag is already on, the routes are
already live. GA is just: stop calling it a pilot in your head. Schedule
the next event through the admin UI, hand the code to members, move on.

### Step C3 — open the door for R2

R2 (member directory) can now be scheduled. Its implementation is
already in the repo behind `FEATURE_MEMBER_DIRECTORY=false`. The gating
blocker is privacy policy sign-off: `docs/10-r2-member-card-spec.md` §0
lists the non-schema prerequisites (attorney review, re-acceptance flow,
etc.).

---

## Rollback procedures

### The flag is the primary switch

If anything goes seriously wrong in any phase:

```bash
vercel env rm FEATURE_EVENTS production
vercel env add FEATURE_EVENTS production
# Type: false
```

Redeploy. Every events route now returns 404. The DB state is preserved
— audit logs, RSVPs, attendance all remain. Re-enabling the flag
restores the UX exactly as it was.

### If a published pilot event has bad data

Draft events can be hard-deleted:

```bash
pnpm tsx scripts/pilot-event.ts cancel --id <uuid>
# Then fix whatever was wrong, create a new event, and archive the old.
```

Published events should be cancelled (not deleted) to preserve the
audit trail. Members with RSVPs will get the cancellation email.

### If cron is mis-firing

Check Vercel's Cron dashboard and disable one or both cron jobs there
temporarily. Re-enable after fixing. Jobs in the queue that didn't
drain will be picked up when the worker runs again.

---

## Quick reference

**Env vars required** (Vercel production):
- `FEATURE_EVENTS=true`
- `CRON_SECRET=<32+ random chars>`
- Existing: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

**Env vars required locally** for the pilot tool:
- Everything above, plus `SUPABASE_DB_URL` pointing at the target
  database. The tool uses direct SQL to generate pgcrypto-compatible
  check-in code hashes.

**Pilot commands**:
- `pnpm tsx scripts/pilot-event.ts create`
- `pnpm tsx scripts/pilot-event.ts publish --id <uuid>`
- `pnpm tsx scripts/pilot-event.ts status --id <uuid>`
- `pnpm tsx scripts/pilot-event.ts cancel --id <uuid>`
- `pnpm tsx scripts/pilot-event.ts archive --id <uuid>`
- `pnpm tsx scripts/pilot-event.ts help`

**Manual cron triggers** (for drills):
- `POST /api/cron/event-reminders` — scan for events 20-30h out and
  enqueue reminder jobs.
- `POST /api/cron/event-notifications` — drain the queue, send emails.

Both require `Authorization: Bearer $CRON_SECRET`.

**Key URLs** (after flag on):
- `/events` — member-facing directory, auth + onboarding gate.
- `/events/[slug]` — event detail page.
- `/events/[slug]/check-in` — member self check-in form.
- `/admin/events` — admin directory.
- `/admin/events/new` — create form.
- `/admin/events/[id]` — detail with 7 tabs.
- `/admin/events/[id]/check-in` — day-of operations page.
