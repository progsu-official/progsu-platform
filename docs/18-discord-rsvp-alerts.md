# Discord RSVP alerts and daily recap

Two surfaces in the Progsu Discord: an embed every time someone RSVPs, and a
once-a-day recap with a rendered chart.

| | Flag | Names people? | Needs the v7 cascade? |
|---|---|---|---|
| Per-RSVP alert | `FEATURE_DISCORD_RSVP_ALERTS` | yes — first name + last initial | **yes** |
| Daily recap | `FEATURE_DISCORD_RECAP` | no — counts only | no |

Both default **false**. The split is deliberate: the recap is aggregate, so it
can run today while the per-RSVP alert waits on consent. Migration
`20260825130000_privacy_policy_v7.sql`. Code in `lib/discord/`.

---

## 1 · The problem

RSVPs land in a database nobody has open. An officer finds out the room is
filling up by remembering to check `/admin/events`, which means they find out
late, and they find out about the *total* rather than the *rate*. Neither of
those is the thing you act on.

The thing you act on is: it is Tuesday, the workshop is Thursday, and four
people have signed up. That is a fact with a deadline attached, and it belongs
where the officers already are.

## 2 · The shape

One embed per RSVP, posted through a plain webhook. No bot, no gateway
connection, no slash commands — a webhook URL in an env var and a `fetch`.

```
┌ New RSVP · Guest
│ Marcus T.
│ Going to Fall Kickoff Carnival
│ █████░░░░░░░░░
│ 44 of 120 going (37%) · 76 spots left
│
│ Starts        Where                 Came from
│ in 6 days     Student Center East   Library flyer (2nd floor)
│
│ Progsu · members.progsu.com                      today at 14:22
└
```

Four design decisions worth keeping:

- **Exactly three inline fields.** This is the whole reason the first cut
  looked wrong. Discord lays inline fields out three to a row: two become two
  lopsided halves, four wrap to a lonely orphan. Three fills the row evenly.
  It is also why "Came from" now says `Direct` instead of vanishing — a
  disappearing field takes the grid with it.
- **Short values in those fields, anything wide in the description.** An
  inline field is a third of the embed. A full date wraps to three lines
  inside one and looks broken; a relative `in 6 days` does not.

- **Colour carries the status.** Violet (`--primary`) for going, amber for
  waitlisted, slate for a cancellation. You can read the channel's state by
  scrolling past it without reading a word.
- **The progress bar is `█`/`░` at 14 slots, bolded, in the description.**
  Bold blocks are heavier than `▰▱` and land on the same width as the text
  above them instead of floating. Fourteen is as wide as a bold description
  line gets before it wraps on a narrow client.
- **Times are Discord's `<t:unix:F>` markup**, so every viewer's client
  renders them in that viewer's timezone. A baked-in "7:00 PM ET" is wrong for
  the member reading it from home over break.
- **The capacity bar earns its decoration.** `44/120` and a bar two-fifths
  full say the same thing, but only one of them tells you the event needs
  promoting without doing arithmetic first.

```bash
pnpm discord:rsvp <webhook-url>
```

Posts all four variants. Touches no database and asserts nothing — it renders
the real builder against fixtures, so the fixtures in that script are the
design brief. Change them to see how the embed handles a long title or a room
that is already full.

## 3 · What gets announced

Edges, not states. `rsvpAlertKindFor()` in `lib/actions/events.ts`:

| Transition | Posts as |
|---|---|
| anything → `going` | **New RSVP** |
| anything → `waitlisted` | **Joined the waitlist** |
| `going` → `declined` / `cancelled` | **RSVP cancelled** |
| everything else | nothing |

Re-saving `going` is not news. A member declining an event they were never
going to is not either. The cancellation edge is in because it is the cue for
whoever is watching a waitlist.

The member path tests the transition directly, using the prior-status read
that already exists for the confirmation email. The guest path has no prior
status available to it — an anon caller cannot read `event_guest_rsvps` — so
the notifier reads the row back on the service-role client and refuses to
announce one whose `created_at` is older than `FRESH_RSVP_MS` (30s). That is
what stops a refreshed confirmation page from posting twice.

## 4 · What is never announced

`shouldAnnounce()` is an allowlist, so a future status or visibility value is
refused until someone decides it is safe:

- `is_sensitive` events. Ever, to anyone.
- `visibility = 'private_invite'`.
- Anything not `status = 'published'`.

And within an announcement that does go out: no last name, no email, no phone
number, no avatar, no profile fields. `publicDisplayName()` reduces every name
to first name plus a last initial before it reaches the builder.

## 5 · The privacy line, and where this crosses it

The channel is readable by the whole Progsu Discord. That makes this a
peer-visible surface, which is CLAUDE.md hard rule #8, which is why v7 exists.

It also crosses the line `docs/17-campaign-links.md` §3 draws. That line is
about `referral_link_hits`, which has no user column and still must not gain
one — but the structural refusal only covers what the *database* stores. This
embed composes the forbidden join in application code and posts it to a
channel. It is a real widening, not a loophole, and the consent bump is what
covers it rather than a clever reading of the old one.

Two things follow:

1. **The flag is a kill switch, not the permission.** `FEATURE_DISCORD_RSVP_ALERTS`
   must stay `false` until the v7 cascade has actually run and members have
   re-accepted. The row in `consent_versions` is the permission.
2. **Do not widen this further without another bump.** Adding the member's
   Discord handle (`profiles.discord_username` exists and would make these
   posts genuinely nicer) means naming them exactly, not approximately, and
   that is a v8 conversation.

Opting out is currently manual: an officer removes the member from the alert
path by hand. `/privacy` says so plainly rather than implying a toggle that
does not exist. A real per-member opt-out belongs in `profile_visibility_settings`
alongside `discoverable`, and is the first thing to build if anyone asks.

## 6 · The daily recap

`FEATURE_DISCORD_RECAP`, posted by `/api/cron/discord-recap` at 14:00 UTC
(10am EDT / 9am EST), covering a rolling 24 hours. Rolling rather than a
calendar day so there are no gaps and no timezone edge cases — a 9am run
covers 9am to 9am, always.

```
┌ Progsu
│ Daily Recap — Monday, Aug 25
│ Next up · Fall Kickoff Carnival in 3 days
│ █████████░░░░░
│ 78 of 120 going (65%) · 42 to fill
│
│ Last 24h      Last 7 days       Vs prior week
│ +12           61 (8.7/day)      ▲ 369%
│
│ Guests        New members       Events upcoming
│ 5 of 12       +6                3
│
│ Also coming up
│ 03 Sep 2026 · Ship It Night — 30/30
│ 10 Sep 2026 · Resume Teardown — 12 going
│
│ Campaigns
│ Library flyer (2nd floor) — 9 RSVPs from 64 clicks  /r/library-flyer
│ GSU CS Discord post — 3 RSVPs from 38 clicks        /r/gsu-cs-discord
│
│ [ 14-day bar chart ]
│ Daily recap · members.progsu.com                 today at 10:00
└
```

**The headline is the next event's fill**, not a cumulative total. Hacklanta
counted toward a 2,000-RSVP goal; a student org has no such number. What it
has is a room with a date on it, and "78 of 120, and it's Thursday" is the
fact that makes someone go put up more posters.

**Campaigns sort by RSVPs, then clicks.** A link with one conversion beat a
link with forty idle clicks; sorting by clicks says the opposite.

**The chart** is `next/og` — Satori, so no headless browser and no native
canvas module on the serverless function. Fourteen bars, one per day,
zero-filled by `buildRecapStats` because a chart that silently drops empty
days draws a busy week through a dead one. Colour ramps violet-900 to
violet-400 oldest-to-newest, so recency reads without a legend; a repeating
palette alternates neighbouring bars and just looks like noise.

Satori is not a browser. Flexbox only, no grid, no CSS variables, and every
multi-child element needs an explicit `display`. The verbose inline styles in
`recap-chart.tsx` are that constraint, not a preference.

**Data comes off the tables directly** on the service-role client.
`admin_platform_analytics()` re-checks `is_admin` against `auth.uid()`, and a
cron worker has no session to check; adding a `service_role` variant would
mean a new function in `public`, which is hard rule #10 territory for numbers
that are a `select` away. `readUpcomingEvents()` applies the same
sensitive/private/draft allowlist as the per-RSVP alert — the recap lands in
the same channel, so a sensitive event must not appear even as a line item.

```bash
pnpm discord:recap <webhook-url>          # real data, read-only
pnpm discord:recap <webhook-url> --demo   # fixtures, no database
```

That script sets `NODE_OPTIONS=--conditions=react-server`, and it has to:
`recap-data.ts` imports `server-only`, which resolves to a module that throws
under a bare `tsx`. Running it without that flag fails on the import rather
than on anything you wrote.

## 7 · Failure behaviour

`notifyRsvpInBackground()` is never awaited and never throws. Discord being
down costs an announcement; it must never cost an RSVP. Failures land in the
structured log under `action: "discord.notify_rsvp"`.

The webhook call carries a 5s `AbortSignal.timeout`. Without it a hung Discord
holds the serverless invocation open until the platform kills it, and the
member watching the RSVP button gets nothing back.

No retry, deliberately. A retried announcement that arrives ninety seconds
late is worse than a missing one, and the RSVP itself is already recorded.

The recap is the opposite: `runDailyRecap()` is allowed to throw, because its
caller is a cron route whose entire job is to run it. A failure should surface
as a 500 in the Vercel log, not a silent no-op.

## 8 · Rollout

Follow `docs/12-events-pilot-runbook.md`.

- **Phase A** — ship the v7 migration, let the consent cascade run, point
  `DISCORD_RSVP_WEBHOOK_URL` at a private scratch channel, flag on, RSVP to a
  draft-then-published test event yourself. Confirm the sensitive/private
  refusals by flipping those fields and watching nothing arrive.
- **Phase B** — repoint the webhook at the real channel for one low-stakes
  event with two campaign links.
- **Phase C** — GA.

## 9 · Not built

- **A per-member opt-out.** See §5. Manual until someone asks.
- **Digest mode.** A busy event will post a lot of per-RSVP embeds. If that
  becomes the complaint, the fix is a debounce that rolls up "6 more RSVPs"
  rather than a quieter embed.
- **A weekly or per-event recap.** `buildRecapStats()` takes a window in
  hours, so a Sunday-night 168h variant is a cron entry and a headline change.
- **Check-in numbers in the recap.** Attendance-vs-RSVP is the most useful
  number nobody has asked for yet.
- **Check-in announcements.** Same plumbing would carry them; nobody has asked.
