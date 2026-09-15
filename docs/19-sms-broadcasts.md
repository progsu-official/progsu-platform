# SMS broadcasts

Officers text opted-in members from `/admin/sms`. Phase 3 of
`docs/16-guest-conversion` §7.4.

| Piece | Where |
|---|---|
| Schema, recipient rule, all mutations | `supabase/migrations/20260915120000_sms_broadcasts.sql` |
| Twilio adapter, signature check | `lib/sms/twilio.ts` |
| Delivery worker | `lib/sms/worker.ts`, `app/api/cron/sms-deliveries` (every minute) |
| STOP handling | `app/api/webhooks/twilio/inbound` |
| Delivery receipts | `app/api/webhooks/twilio/status` |
| Officer actions | `lib/actions/sms.ts`, `lib/actions/sms-schemas.ts` |
| Page | `app/admin/sms/` behind `FEATURE_SMS` |
| Smoke | `scripts/smoke-sms-broadcast.ts` |

---

## 1 · Who gets texted

A number is sendable when it is not in `sms_suppressions` **and** the most
recent consent decision on record for it is a yes. `sms_is_sendable()` is the
only definition; the audience count, the enqueue, and the worker's claim all
call it.

Decisions come from two places, and the newer one wins (a tie is a no):

- the member ledger: latest `consents` row of type `sms_marketing`
- the guest/import record: `legacy_members.sms_consent_at`, with the verbatim
  disclosure in `sms_consent_copy`

These do **not** count as consent and are never texted:

- `legacy_members.sms_interest = true` with no `sms_consent_at` — a bare "Yes"
  in an old form export, with no timestamp or copy to show a carrier
- `event_guest_rsvps.phone` on its own
- an archived profile's opt-in (its opt-out still counts)
- a guest opt-in that has been claimed, unless the claiming member is live and
  still has that same number on their profile. Once someone is a member, the
  profile is where they manage SMS; a number they moved away from may not be
  theirs any more, and a deleted account's old opt-in no longer counts

The GSU audience additionally needs a record placing the number at Georgia
State: a member's student email, or a staging row's campus (else personal)
email, on `student.gsu.edu` or `gsu.edu`.

Numbers at the time of writing (2026-09-15, prod):

| | GSU | All schools |
|---|---|---|
| Union of both consent sources, minus suppressions | 529 | 582 |
| **The rule above** (what ships) | **479** | **530** |

Most of the difference is 48 unsuppressed numbers with a guest opt-in and a
*later* member-side decline; a union would have texted every one of them. The
claimed-guest rule removes a few more (a member who changed number, one who
removed it, one deleted account).

## 2 · How a send works

1. The officer picks an audience, writes the text, and types the count to
   confirm. `create_sms_broadcast()` snapshots recipients into
   `sms_deliveries` and refuses if the count moved since the page loaded, if
   the body lacks STOP wording, or if another broadcast is still sending (a
   partial unique index enforces that last one under concurrent submits).
   Tests to the officer's own phone skip the consent rule but not suppression,
   are capped at 10 an hour, and record the destination number in the audit
   row.
2. The server action starts the worker via `after()`; the per-minute cron
   finishes anything larger than one pass.
3. `claim_sms_deliveries()` re-applies the rule to each row it claims. A number
   that replied STOP after Send is closed out as `suppressed` and never reaches
   the worker.
4. Each text goes to Twilio through the Messaging Service.
   `finish_sms_delivery()` records the result; Twilio error 21610 (recipient
   already opted out at the carrier) adds the number to `sms_suppressions`.
5. Status callbacks move rows to `delivered` / `undelivered` / `failed`, only
   ever forward.

A row handed to Twilio is never re-queued. A worker that runs out of its time
budget releases the rows it claimed but had not started; if it is killed
outright, those rows fail after 30 minutes rather than risk a second text.

"Stop" on a broadcast cancels everything still queued. Rows already handed to
Twilio may still arrive.

**Kill switch:** `FEATURE_SMS=false` hides the page and makes the worker a
no-op between batches, so queued texts wait. The STOP webhook ignores the flag
on purpose.

## 3 · Access model

Both tables: RLS on, zero policies, all client grants revoked. Officer
functions (`admin_sms_overview`, `create_sms_broadcast`,
`cancel_sms_broadcast`) keep the `authenticated` grant so `auth.uid()` names
the officer in the audit row, and re-check `is_admin`. The resolver and every
worker function are `service_role` only, with the explicit `anon`,
`authenticated` revoke from CLAUDE.md hard rule #10. The smoke asserts every
refusal.

Audit actions: `sms.test_sent`, `sms.broadcast_created` (with the body),
`sms.broadcast_cancelled`, `sms.broadcast_completed` (with final counts),
`sms.suppressed`. Per-recipient outcomes live in `sms_deliveries`, not the
audit log.

## 4 · Environment

| Variable | Used for | Unset means |
|---|---|---|
| `FEATURE_SMS` | page + worker | page 404s, worker idle |
| `TWILIO_ACCOUNT_SID` | request path | sending off, page says so |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | send auth | sending off |
| `TWILIO_MESSAGING_SERVICE_SID` | sender | sending off |
| `TWILIO_AUTH_TOKEN` | verifying both webhooks | webhooks 401; texts stop at "sent" |
| `CRON_SECRET` | cron auth | cron 401s; only the post-Send kick runs |

Sending uses an API key rather than the auth token so the key can be revoked
alone. Twilio signs webhooks only with the auth token, so both are needed.

## 5 · Twilio side (checked 2026-09-15)

- The Messaging Service's sender pool is one **toll-free number with an
  approved toll-free verification** (use case: events). That is the sending
  path, and it does not depend on 10DLC.
- The account's separate 10DLC campaign was **rejected** (error 30909, call to
  action could not be verified). It only matters for the local number, which
  is not in the sender pool. Ignore it unless that changes.
- The verification declared **100 messages/month**. One broadcast to the GSU
  audience is ~480. Raise the declared volume in the Twilio console before the
  first real send; traffic far above the verified volume is a filtering risk.
- The toll-free number's inbound webhook currently points at an older Google
  Apps Script, which is failing (error 11200). Pointing it at
  `https://members.progsu.com/api/webhooks/twilio/inbound` replaces that
  script. Twilio still enforces STOP on its side either way; the webhook is
  what keeps `sms_suppressions` in step.
- Check the account balance covers `segments × recipients` at current
  toll-free pricing plus carrier fees before sending. The composer shows the
  total segment count.

## 6 · Rollout

Same phases as `docs/12-events-pilot-runbook.md`.

1. Apply the migration (validated in a rolled-back transaction against prod
   first), `pnpm db:pull`, commit the generated types.
2. Run `pnpm tsx scripts/smoke-sms-broadcast.ts` with `FEATURE_SMS` still off
   on the deployment.
3. Set the Twilio variables in Vercel, raise the verification volume, top up
   the balance.
4. **Phase A:** `FEATURE_SMS=true`. An officer sends a test to their own phone
   and confirms it arrives, replies STOP from a second phone that is on the
   list, and confirms the audience count drops by one.
5. **Phase B:** one real broadcast to the GSU audience.
6. **Phase C:** routine use.

## 7 · Not built

- Re-confirming the ~500 `sms_interest`-only rows. The clean path is an opt-in
  email (Resend and `email_marketing` consent already exist) that writes a real
  timestamped consent, not a backfill of `sms_consent_at`.
- START / re-subscribe. `sms_suppressions` has no un-suppress path by design;
  someone who texts START is still skipped until an officer clears them by hand.
- Scheduling, per-event audiences, editable templates, MMS.

## 8 · Event reminders

Migration `20260915130000_sms_event_reminders.sql`, `lib/sms/reminders.ts`,
`lib/sms/templates.ts`, smoke `scripts/smoke-sms-event-reminders.ts`.

Thirty minutes before a published event starts, everyone RSVP'd **going** who
passes the §1 rule gets one text. Being RSVP'd is not consent; the SMS opt-in is.
Waitlisted, declined and cancelled RSVPs get nothing, and a person RSVP'd as both
a member and a guest on the same number gets one text.

```
yo, PrizePicks Internship Recruiting Event starts in 30 min at Petit Science Center Rm. 101! See you there.

Progsu: reply STOP to opt out
```

- **Default on.** `events.send_sms_reminder` defaults true. Officers switch it
  off per event under "Text reminder" in the event's options
  (`set_event_sms_reminder()`, audited). `FEATURE_SMS_EVENT_REMINDERS=false`
  stops all reminders without stopping broadcasts; unset means on.
- **When.** The per-minute cron queues reminders for events starting 30 to 5
  minutes out, so a few missed ticks still send, but "starting soon" never lands
  as doors open.
- **Exactly once.** `enqueue_event_sms_reminder()` stamps
  `events.sms_reminder_sent_at` under a row lock in the same transaction as the
  enqueue. Moving `starts_at` clears the stamp, so a rescheduled event reminds
  again at the new time.
- **Re-checked at send.** A reminder row is skipped if the person cancelled their
  RSVP or stopped being textable, if the event was cancelled, or once it has
  started.
- **Never blocked.** Reminders don't count toward the one-broadcast-at-a-time
  rule, so an officer's blast in flight can't hold one up.
- **Cost.** One segment for any event with a room (title capped at 45
  characters, room at 35, emoji dropped). With no room, the event link is
  included instead, which can run to two segments.
- **Where to see it.** `/admin/sms` shows the message for the next event, which
  events in the next 7 days will send, and how many people each will reach so
  far. Sent reminders appear in the history as "Event reminder: title".

Validated before applying the same way as §6: the migration plus assertions ran
in one rolled-back transaction against prod. That covered claim-time skips for a
cancelled RSVP, a suppressed number and a cancelled event, which the smoke
cannot exercise without racing the live worker.
