# 16 — Guest → Member Conversion

Owner: Events / onboarding
Last revised: 2026-08-23
Status: Spec. No code yet.

Supersedes nothing. Extends the guest RSVP path introduced in
`supabase/migrations/20260821010000_guest_event_rsvp.sql` and the completion-ring
model in `docs/14-low-friction-signup/`.

---

## 0. Why

Guest RSVP (2026-08-21) removed the account requirement for event sign-up. It
worked — too well. The guest path is now strictly *easier* than the member path:
three fields and no redirect, versus a bounce through Google OAuth. And the guest
gets 100% of the value up front: instant confirmation, a confirmation email, and a
public QR ticket at `/tickets/[token]`.

The current conversion nudge is a dismissible card on the RSVP success state in
`app/events/[slug]/_components/guest-rsvp-modal.tsx`, with "Maybe later" and
"Yes, let's go" at equal visual weight. It asks for extra work *after* the visitor
already has everything they came for. Declining is the rational choice.

Two further holes:

- Nothing checks whether the submitted email or phone already belongs to a
  member. A member can guest-RSVP with their own Google email and the system
  will happily create a parallel guest identity.
- `profiles.phone_number` is free-text and unnormalized (`+14045551234` and
  `555-555-5555` both exist in seeds), so it cannot be matched against as-is.

## 1. Goals

1. Make the account path the path of least resistance, not the detour.
2. Recover the profile fields `docs/14` moved out of the hard signup gate, at
   the warmest moment we will ever have with a non-member.
3. Recognize returning members at RSVP time and route them to sign-in.
4. Capture SMS consent to a standard that survives carrier review, without
   depending on an SMS provider existing yet.

### Non-goals

- Actually sending SMS. Provider integration is Phase 3 and gated on carrier
  registration, which is a lead-time problem, not a code problem. See §7.
- Making guest RSVP *worse* (member capacity priority, members-only QR
  tickets). Considered and deferred — see §10.
- Any change to the member RSVP path.

## 2. Decisions locked

These were open at spec time and are resolved here. Flagged so a reader knows
they were choices, not defaults.

| Decision | Choice | Rationale |
|---|---|---|
| Where guest answers live | Extend `legacy_members` | The claim-on-first-login pipeline already exists in `handle_new_user()`. A second parallel pipeline is the more expensive option. See §4.1. |
| Email/phone collision behavior | Hard block | Owner's framing was "just ask them to log in." Accepts the cost: a bailed sign-in loses the RSVP. |
| Auth timing on the welcome page | Questions first, sign-in last | Escalating asks convert better than front-loading OAuth, which is what the current modal already does and what we are replacing. |
| Guest SMS consent on claim | Pre-check, do not auto-write | See §6.2. Legal correctness and repo convention mildly disagree; we take the conservative side. |

## 3. Flow

```
  Guest submits name / email / phone in the RSVP modal
                        │
        ┌───────────────┴───────────────┐
        │                               │
  email or phone matches          no match
  an existing profile                   │
        │                               │
  no guest row created          guest row created
  modal → "You already have      redirect → /welcome/[claim_token]
  an account, sign in"                    │
                                   3 questions, one per step
                                   (major → graduation → looking for)
                                          │
                                   "Save this — sign in with Google"
                                          │
                                   handle_new_user() claims the row,
                                   copies answers into profiles
```

### 3.1 Collision, handled at the modal

Handling this at the modal rather than on the welcome page is deliberate: it
keeps the welcome page a single-purpose new-visitor surface with no
"welcome back" variant to design, and it means we never create a guest
identity we intend to throw away.

### 3.2 The welcome page

Route: `/welcome/[token]`. Sessionless, token-keyed, `force-dynamic`,
`robots: { index: false, follow: false }` — the same posture as
`app/tickets/[token]/page.tsx`, which is the existing precedent for a
bearer-token page with no session.

Because the token is in the URL, the guest confirmation email can link back to
it. A visitor who closes the tab gets a second conversion attempt for free.

Three questions, one per step, all existing profile fields:

1. **Major** — dropdown off the existing `majors` lookup table, plus Other →
   free text (`major_other_text`).
2. **Graduation** — `grad_year` + `class_standing`.
3. **What are you looking for** — `interested_roles`, already an enum array.

These are exactly the four fields `docs/14-low-friction-signup` removed from the
hard gate and pushed into the completion ring. Asking them here recovers that
data from someone who is not yet even a member.

Waitlisted guests get the page too. They are arguably the better audience —
"members get priority" is a live incentive for someone who just missed a spot.

### 3.3 The pitch, and its limit

The closing CTA is a progress ladder, not a promise:

> You're 3 of 8 done. Finish your profile to get into recruiter exports.

`recruiter_eligible_members` requires 100% completion, a verified `.edu` email,
an active resume, `open_to_recruiters`, and `recruiter_resume_sharing`. Any copy
implying three questions puts someone in front of a recruiter is a promise the
system will not keep, and finding that out later is worse than never being told.

Hard cap of three questions. "Couple more questions" that turns out to be eight
spends the goodwill the RSVP just earned.

## 4. Data model

### 4.1 `legacy_members` becomes the pre-signup identity table

Today it is described as pre-launch staging data imported from Luma/Sheets/Tally.
It already carries `personal_email` (unique), `phone_number`, `claimed_at`,
`claimed_profile_id`, a `source` discriminator, an admin surface in
`app/admin/members/page.tsx`, and — the reason this is the cheap option —
automatic claim-on-first-login inside `handle_new_user()`
(`20260816000200_legacy_claim_backfill.sql`).

A guest who was already in the Luma import merges onto their existing row via
the unique email index rather than forking a second pre-signup identity. That
merge is a feature, not an accident, and a new parallel table would lose it.

New columns:

```
major              text
major_other_text   text
grad_year          integer
class_standing     public.class_standing_t
interested_roles   public.interested_role_t[]  not null default '{}'
phone_e164         text
sms_consent_at     timestamptz
sms_consent_copy   text
answered_at        timestamptz
```

Guest-sourced rows get `source = 'guest_rsvp'`, `source_detail = <event slug>`.

**Accepted cost:** the table name becomes a misnomer — it now means "pre-signup
identity, any provenance," not "imported legacy data." Renaming a shipped table
is churn we do not need; update the table comment instead and note it here so
the next reader is not confused.

### 4.2 `event_guest_rsvps.claim_token`

```
claim_token uuid not null default gen_random_uuid()
```

with a unique index. Deliberately *not* reusing `checkin_token`, which is null
for waitlisted guests by design (the lifecycle rule in
`20260821040000_guest_checkin.sql` is "present iff status = 'going'"), and
waitlisted guests need this page.

### 4.3 `profiles.phone_e164`

A generated column driven by an `IMMUTABLE` normalizer so the collision lookup
is indexed:

```sql
create function public.normalize_phone_e164(p text) returns text
  language sql immutable ...
alter table public.profiles
  add column phone_e164 text generated always as (public.normalize_phone_e164(phone_number)) stored;
create index profiles_phone_e164_idx on public.profiles (phone_e164) where phone_e164 is not null;
```

Normalization is US-centric: strip non-digits, accept 10 digits (prepend `+1`)
or 11 digits starting with 1, return `null` for anything else. Malformed
existing data normalizes to null and simply never matches, which is the correct
failure mode.

No backfill script is needed — a stored generated column populates for existing
rows when it is added. The cost is that adding it rewrites the table and takes
an `ACCESS EXCLUSIVE` lock. At current `profiles` size that is
sub-second; it is called out here only so it is not a surprise later.

### 4.4 `sms_suppressions`

```
phone_e164  text primary key
reason      text not null      -- 'stop_keyword' | 'manual' | 'carrier'
created_at  timestamptz not null default now()
```

Global, supersedes every consent record, checked before every send. Carrier
requirement, and it must exist before the first message goes out.

RLS deny-all to `anon` and `authenticated`; writes via SECURITY DEFINER helper
only, per CLAUDE.md rule #4.

## 5. Helper changes

### 5.1 `guest_rsvp_to_event()` — return type change

The function must return the claim token, not just `rsvp_status_t`. Postgres
will not `create or replace` a function with a changed return type, so the new
migration does `drop function` + recreate + re-grant. Append-only is satisfied
(new file), but it has to be deliberate, and the grants to
`anon, authenticated, service_role` must be restated.

New behavior, in order:
1. Existing validation (name, email, phone regex).
2. Normalize phone to E.164.
3. Collision check against `profiles` on `google_email`, `student_email`, or
   `phone_e164`. On match, raise with a distinct message the server action maps
   to a new `ACCOUNT_EXISTS` error code. No guest row is written.
4. Existing rate limit, capacity/waitlist logic, insert, audit.
5. Return `(status, claim_token)`.

### 5.2 `guest_claim_context(p_token uuid)` — new, anon-callable

SECURITY DEFINER, returns the guest's first name, event title, RSVP status, and
whether answers are already recorded. Returns nothing for an unknown token.
Nothing about any other guest is reachable from it.

### 5.3 `submit_guest_answers(p_token uuid, ...)` — new, anon-callable

SECURITY DEFINER. Upserts into `legacy_members` keyed on the guest row's email,
writes `answered_at`, rate-limited via `consume_rate_limit`, audited via
`write_audit`.

### 5.4 `handle_new_user()` — extend the claim

Copy the new columns alongside the existing `phone_number` copy, keeping the
never-overwrite discipline. Note that `interested_roles` is `not null default
'{}'`, so the guard is "only fill if empty array," not `coalesce` on null.

Consents are **not** written here. See §6.2.

## 6. Consent and privacy

### 6.1 SMS opt-in capture (Phase 1, no provider needed)

An unchecked checkbox on the guest RSVP modal and on the welcome page:

> Text me about Progsu events. Msg frequency varies. Msg & data rates may apply.
> Reply STOP to opt out, HELP for help. See our Terms and Privacy Policy.

Unchecked by default — pre-checked boxes do not constitute express written
consent. The exact copy shown is stored in `sms_consent_copy` alongside the
timestamp, so we can prove later what someone actually agreed to.

This ships before provider registration because the registration itself requires
a live URL showing this flow. See §7.

### 6.2 Guest SMS consent on claim: pre-check, do not auto-write

`legacy_members`' own header comment is explicit: "Consent columns in profiles
are never defaulted true from this table, each person opts in explicitly at
claim time."

There is genuine tension here. A guest SMS opt-in *is* a valid express consent
with a timestamp and preserved copy — legally it does not need re-collecting.
But writing an accepted `consents` row from staging data is exactly what that
convention exists to prevent.

Resolution: guest-scope sends read the guest-side consent record; the member
`consents` ledger requires a fresh explicit acceptance, with the toggle
**pre-checked** at `/onboarding/consent` so nobody opts in twice from scratch.
Clean separation, conservative direction.

### 6.3 Privacy policy

Two changes to `app/privacy/page.tsx` (currently v5), both of which are also
carrier-registration prerequisites:

1. An explicit statement that mobile opt-in data and consent are never shared or
   sold to third parties for marketing. Its absence is a common verification
   rejection cause. The current page mentions SMS consent but not this.
2. A section describing academic data (major, graduation, interests) collected
   from non-members via the welcome page.

CLAUDE.md rule #8 ties version bumps to new *peer-visible* surfaces, and neither
of these is peer-visible, so a bump is not strictly forced. **Open question for
the owner** (§11): bump anyway. Collecting academic data from people who have
not signed up is a meaningful enough change in posture that re-acceptance seems
right, and the cascade already handles it.

`/terms` needs the standard message-frequency and rates disclosure.

## 7. SMS provider setup

Code is not the long pole here — carrier registration is. Nothing in Phases 1–2
is blocked by it.

**The sequencing that matters:** campaign registration requires a 40–2049
character description of the opt-in flow, 2–5 sample messages, and a URL where
the consent language is visible, and reviewers check that the page exists. So
§6.1 ships *before* registration is submitted, not after.

### 7.1 Brand type, forked on EIN

| Situation | Path |
|---|---|
| Progsu has its own EIN | Low-Volume Standard Brand (<6,000 msgs/day). Required over Sole Proprietor if an EIN exists. |
| Under GSU's umbrella | Register on the university EIN with a staff authorized representative. Politically slow; registers cleanly as `HIGHER_EDUCATION`. |
| No EIN anywhere | Sole Proprietor Brand, tied to one person's name, mobile, and home address. Low throughput, daily caps, bad handoff story for a student org. |
| Any of the above | Toll-free verification instead. Twilio states 10DLC approval takes longer than toll-free, and toll-free supports Business/Nonprofit. Likely the pragmatic choice at this volume. |

### 7.2 Owner actions (cannot be automated)

1. Create the Twilio account on an org-controlled email, not a personal one.
2. Buy the number.
3. Submit brand + campaign registration, or toll-free verification.
4. Set credentials in `.env.local` and Vercel directly.

### 7.3 Information the forms require

Brand: legal business name, EIN, business type, industry, website URL, social
URLs, mailing address, and authorized representative name, title, phone, email.

Campaign: use case, opt-in flow description (40–2049 chars), 2–5 sample messages
(20–1024 chars each), and STOP/HELP/opt-in keyword responses. Copy for the
description, samples, and keywords is drafted as part of this work — that is
where registrations usually get rejected.

### 7.4 Integration shape (Phase 3)

`lib/sms/` mirroring `lib/email/`: a provider adapter, a send helper that checks
`sms_suppressions` first, and a webhook route for STOP/HELP and delivery status.
Twilio signs webhooks with `X-Twilio-Signature` (HMAC-SHA1) — validate it with a
constant-time compare, per CLAUDE.md rule #10 and the pattern in
`app/api/cron/event-notifications/route.ts`.

New env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_MESSAGING_SERVICE_SID`, and `FEATURE_SMS` via `parseBool` in
`lib/env.ts`, defaulted `false` in `.env.example`.

## 8. Testing

Per CLAUDE.md: real Supabase, no mocks, green from scratch.

**Operational caveat.** There is no local Supabase instance and no `supabase`
CLI on this project — `.env.local` points at the production project, so every
smoke run writes real member data. Migrations here are validated inside a
rolled-back transaction against prod and then applied directly, rather than via
`supabase db reset`. Two consequences for this work: the collision and claim
smokes must seed and tear down their own users in a `finally` block without
assuming an empty database, and the `profiles.phone_e164` column lands on live
data on first application.

- `scripts/smoke-guest-claim.ts` — seed a guest RSVP, assert a claim token comes
  back, submit answers, create a Google user with the same email, assert
  `handle_new_user()` copied every field and stamped `claimed_at` /
  `claimed_profile_id`. Consent versions read dynamically from
  `consent_versions`, never hardcoded.
- `scripts/smoke-guest-collision.ts` — seed a profile, attempt guest RSVP with
  its email, assert `ACCOUNT_EXISTS` and that no guest row was created. Repeat
  with a differently-formatted version of the same phone number to prove
  normalization works.
- `scripts/smoke-sms-consent.ts` — assert consent copy and timestamp are stored
  verbatim, and that a suppressed number is never selected for send.
- `tests/e2e/scenarios/10-guest-rsvp-ticket-checkin.spec.ts` **will fail** once
  the modal redirects instead of rendering the inline success card. Updating it
  is part of this work, not follow-up.

## 9. Phasing

| Phase | Contents | Blocked on |
|---|---|---|
| 1 | Collision detection, phone normalization, claim token, welcome page, three questions, claim-on-login, SMS opt-in capture, privacy/terms copy | nothing |
| 2 | Confirmation-email link back to the welcome page, persistent claim banner for returning guests, post-event conversion push | Phase 1 |
| 3 | `lib/sms/`, send helper, STOP/HELP webhook, `FEATURE_SMS` | carrier registration |

Registration (§7) runs in parallel with Phase 1, starting immediately, since it
waits on carriers rather than on us.

## 10. Considered and deferred

- **Members-only QR tickets** — guests check in by name, members skip the line.
  Real benefit, but degrades a flow that currently works, and Phase 1 should be
  measured before adding friction.
- **Member capacity priority** — members get spots, guests waitlist first. The
  only option that creates a *reason* rather than friction, and the strongest
  candidate for a follow-up. Requires reworking the shared-pool math in
  `guest_rsvp_to_event()`.
- **Time-gated guest RSVP** — guest path opens only near the event date.
  Maximum pressure, biggest hit to raw attendance.
- **Magic-link or phone-OTP auth** — would remove the "I don't want to use my
  Google account" objection entirely, but `docs/14` §3 fixes the member auth
  model at Google-only. A separate decision, not this spec's.

## 11. Open questions

1. **Privacy version bump?** §6.3. Not strictly required by rule #8; recommended
   anyway. Owner's call, and it gates the migration ordering.
2. **EIN status.** §7.1. Determines brand type and the registration timeline.
   Everything else in Phase 3 waits on this answer.
3. **Does the collision check include `student_email`?** Currently specified as
   yes. It widens the enumeration surface slightly for a case that is rare (a
   guest RSVPing with their `.edu` rather than their Google address) but real.
4. **Enumeration tolerance.** The collision check tells a submitter whether an
   address belongs to a member. `consume_rate_limit` at 5/60min bounds it. For a
   ~300-person org this reads as proportionate, but it is a real trade being
   accepted knowingly, not a free one.
