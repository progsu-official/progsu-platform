# Campaign links

Short links that tell you which push filled the room.

Shipped 2026-08-24 behind `FEATURE_REFERRAL_LINKS`. Migrations
`20260824150000_referral_links.sql` and
`20260824160000_referral_grants_lockdown.sql`.

---

## 1 · The problem

We push an event through a flyer in the library, a Discord post, a class
announcement and a table outside the student center, and afterwards the
platform can tell us exactly one thing: how many people RSVP'd. Not which of
those four did the work. `admin_event_analytics_for()` starts counting at the
RSVP; nothing above it was ever recorded.

So the next semester's posters get printed on a hunch.

## 2 · The shape

One link per channel, per event:

```
progsu.com/r/library-flyer   ->  302  ->  /events/fall-kickoff-carnival
```

The redirect is where the click is recorded and where an attribution cookie is
set. Everything downstream — the RSVP, the signup — reads that cookie and adds
a counter row.

A short redirect rather than `?ref=` on the event URL, because these get
printed, typed by hand off a poster, and turned into QR codes. A query param
is long, ugly on paper, and the first thing someone strips when they re-share
the link in a group chat.

Random slugs use the alphabet `abcdefghjkmnpqrstuvwxyz23456789` — no `i`, `l`,
`o`, `0` or `1`. Those five characters are exactly where a link read off a
flyer at a distance costs you the visitor.

## 3 · The privacy line

**`referral_link_hits` has no user column, and must never gain one.** Not a
`user_id`, not an email, not a `guest_rsvp_id`, not an IP.

The table can answer *"the flyer brought 40 RSVPs, and they arrived on the
12th"*. It cannot answer *"Natasha came from the flyer"*. That is the whole
design, not an omission.

Why the line sits there:

- The aggregate answer is the one anyone acts on. Nobody changes what they do
  next semester based on which specific person saw which specific poster.
- Per-person attribution creates a new category of personal data — a durable
  record of where someone came from — which lands squarely in CLAUDE.md hard
  rule #8. It needs a `privacy_policy` bump and a re-acceptance cascade for
  the whole roster.
- Making it structural beats making it a rule. There is no column to
  accidentally populate, so no code review has to catch it.

`smoke-referral-links.ts` asserts the exact column set of
`referral_link_hits` against a real row. A future migration that adds
`user_id` "just for debugging" fails the smoke rather than shipping.

If per-person attribution is ever genuinely wanted, it is a new table and a
consent bump. Do not widen this one.

**Amended 2026-08-25.** The Discord RSVP alert
(`docs/18-discord-rsvp-alerts.md`) names the campaign in the same message as
the member who came through it. The table below is unchanged and stays
unchanged — nothing new is stored — but the join the schema refuses to hold is
now composed in application code and posted to a channel. That is a real
widening of the surface, covered by the `privacy_policy` v7 bump in
`20260825130000`, not by a generous reading of this section. If you are adding
a third place that pairs a person with a campaign, it needs its own bump too.

The daily recap in the same doc is *not* such a place. It names campaigns and
counts their conversions, which is exactly what this table is for, and it
never names a person — which is why it runs behind its own flag with no
consent bump attached.

## 4 · Access model

Both tables are RLS-on with **zero policies**, so PostgREST refuses every
direct client read and write. Everything goes through SECURITY DEFINER
helpers:

| Function | Granted to | Notes |
|---|---|---|
| `create_referral_link(event, slug, label)` | `authenticated`, `service_role` | re-checks `is_admin` internally; runs on the officer's own client so `auth.uid()` names them in the audit row |
| `archive_referral_link(id, archived)` | `authenticated`, `service_role` | reversible |
| `admin_referral_links_for(event)` | `authenticated`, `service_role` | aggregate read, no audit row — see §5 |
| `record_referral_click(slug, is_new_visitor)` | `service_role` only | resolves + counts in one call |
| `record_referral_conversion(slug, kind)` | `service_role` only | refuses `'click'` |

The two recorders take no caller identity, so there is nothing for them to
authorise. **Being unreachable from a browser is the entire anti-abuse
story** — that is why they are service-role only and called from the `/r`
route handler and the RSVP actions on the admin client.

That very nearly did not hold. `20260824150000` revoked them from the PUBLIC
pseudo-role and assumed that was enough; Supabase's default privileges had
already granted EXECUTE to `anon` and `authenticated` as explicit per-role
grants, which a revoke from PUBLIC does not touch. For minutes, on a feature
behind an off flag, any browser could have inflated a campaign's numbers.
`20260824160000` closes it, and it is now CLAUDE.md hard rule #10.

## 5 · Counting rules

- **Clicks vs visitors.** Every hit is a click; the first hit from a browser
  that has no cookie for this link is also a visitor. A poster in a hallway
  someone walks past twice a day would otherwise read as a runaway success.
- **Conversions dedupe on a cookie flag.** Each browser counts at most one
  RSVP and one signup per link. That is the honest ceiling for what a cookie
  can know — it cannot tell that the same person also RSVP'd from their phone,
  and it does not try.
- **Member RSVPs count on the transition into `going`,** the same edge the
  confirmation email uses, so toggling an answer does not inflate anything.
  The guest path has no prior-status read available to it (an anon caller
  cannot read `event_guest_rsvps`), so there the cookie flag is the only
  guard.
- **Signups count when `user.created_at` is within five minutes,** which is
  what separates "signed up just now" from "signed in again". The cookie
  survives the Google round trip the same way `GUEST_CLAIM_COOKIE` does.
- **Last touch wins.** Clicking a second link overwrites the first, and the
  dedupe flags reset with the slug they belong to.
- **Archived links stop resolving but still take conversions.** Someone who
  clicked before it was archived and RSVPs after belongs to the campaign that
  brought them.
- **A link on an unpublished event never resolves.** Otherwise a campaign
  started early leaks a draft event's page.

`admin_referral_links_for()` writes no audit row. It is a tab, read on every
navigation to it, and every number in it is an org-level aggregate — one audit
row per page view would bury the log in "an officer looked at a click count".
Same reasoning as `admin_platform_analytics()`; the line is drawn at
per-member data, and this function is structurally incapable of returning any.

## 6 · Failure behaviour

The `/r/<slug>` handler is the one surface a total stranger reaches first, so
every failure mode lands somewhere useful. Unknown slug, archived link,
unpublished event, feature flag off, database error: all redirect to
`/events`. A dead campaign link in the wild is our problem, not the visitor's.

Conversion recording never throws and is never fatal. An RSVP must not fail
because a stat did not get written.

## 7 · Rollout

Follow `docs/12-events-pilot-runbook.md`. `FEATURE_REFERRAL_LINKS=false` is
the shipped default.

- **Phase A** — flag on, make a link for an event already running, click it
  yourself from a phone on cell data, confirm the counts move.
- **Phase B** — one real campaign with two links, so the comparison between
  channels is the thing being tested, not the mechanism.
- **Phase C** — GA.

Turning the flag off closes the redirect route and hides the tab. Existing
links stop resolving and send visitors to `/events`, which is the correct
behaviour for a kill switch on a surface strangers reach from print.

## 8 · Not built

- **A cross-event roll-up.** Links live on the event they promote. If
  comparing campaigns across events becomes a real question, that is a
  top-level `/admin/links` page reading the same helpers.
- **Time series per link.** `referral_link_hits.occurred_at` is recorded and
  indexed, so "clicks per day for this campaign" is a query away — nothing
  renders it yet.
- **QR generation.** The event QR machinery in `qr-center-mark.tsx` already
  exists and a campaign link is just a URL, so this is UI work, not new
  plumbing.
