# R3 Shared Event Discovery — Implementation Spec

Version: R3-spec-v1
Author: R3 planning synth (2026-04-22)
Status: Proposed — awaits owner sign-off on §16 Q7 (this spec recommends the hybrid model in §2) and the open questions at the end
Canon this builds on: `docs/09-events-platform-plan.md` §3.3, §8.3, §8.4, §9.4, §9.6, §10.5, §11.4, §13 (R3 merge blockers), §14.4, §15; `docs/10-r2-member-card-spec.md` (R2 member-card projection)
Prerequisite release: R2 (member cards + `profile_visibility_settings`) must be landed, opt-in rates observed, and `FEATURE_MEMBER_DIRECTORY=true` in production before R3 rollout.

---

## 1. Scope

R3 delivers the third stage of member discovery: **mutual-opt-in shared-event history** rendered inside the peer-visible member-card surface that R2 built.

### What R3 ships

1. A new helper `shared_events_for_viewer(viewer_id, target_id)` returning **two projections in one call**:
   - `aggregate_count` — how many events the viewer and the target both attended, filtered through the 6-gate rule in plan §8.3.
   - `named_events` — a JSON array of `{event_id, event_slug, event_title, starts_at}` for events that additionally meet the stricter named-event threshold (≥ 10 attendees AND non-sensitive AND non-private-invite).
2. A new `Shared events with you` section on `/members/[slug]` that consumes the helper and renders aggregate-only, named, or empty.
3. `profile_visibility_settings.share_shared_event_counts` becomes active (R2 wires the column but leaves it inert).
4. Audit trail entry `member.shared_events_view` on each non-self helper call.
5. Rate limit bucket `shared_events_view` @ 30 hits / 60 s per viewer.
6. Privacy policy version bump and re-acceptance gate for enabling the third toggle (see §8).
7. New smoke script `smoke-shared-events-visibility` exercising mutual-opt-in, thresholds, inference attacks, and flag-off behavior.
8. `FEATURE_SHARED_EVENT_HISTORY` enforced at the route/helper edge: when off, the helper returns an empty set (never an error), and the UX renders nothing — no placeholder, no "feature unavailable" leak.

### What R3 does NOT ship

- No friends list, follow graph, or mutual-connections primitive.
- No shared-event notifications ("X also attended the event you're going to").
- No inverse query API ("who among my peers attended this event?").
- No school/cohort-filtered shared-event rollups on a directory-wide surface.
- No shared-RSVP-intent or shared-upcoming-plans view — R3 operates only on historical, completed attendance.
- No expansion of the member-card allow-list. This release uses only fields already permitted in R2.
- No admin-side "shared events analytics" dashboard — R3 is a member-to-member surface only.
- No retroactive disclosure: flipping `share_shared_event_counts` off hides the rows immediately; no grace window, no "see what peers saw".

### Why the narrow scope

Plan §8.3 and §15 both flag small-group inference as a critical risk. The 6-gate rule plus mutual opt-in plus thresholds plus rate limits plus per-event filtering plus audit is already a large surface; every feature omitted above removes a vector for oracle-style probing of private participation. R3 focuses exclusively on the minimum viable shared-history feature that still answers the product goal "what events this person and I both went to".

---

## 2. Decision for Plan §16 Q7

**Question:** do we stop at aggregate shared-event counts, or allow named shared-event lists once the safety rules pass?

**Recommendation:** **Hybrid — both, tiered by threshold.** One helper returns both projections; each projection has its own gate.

- **Aggregate shared-event count:** always computed when the 6 gates from plan §8.3 pass and an event's attendee count ≥ 10. Rendered as "You have N shared events with this member."
- **Named shared events:** populated only for events that additionally satisfy the named-event threshold. An event appears in `named_events` iff attendee count ≥ 10 AND `is_sensitive = false` AND `visibility <> 'private_invite'` AND the event is not in `draft` or `archived` status (consistent with R2's `member_card_attended_events_for_viewer`).

### Justification

1. **Product goal.** Plan §3.3 says R3 is the release that satisfies "what events this person and I both went to." Aggregate counts alone technically answer the question but degrade the product to a privacy-safe but unsatisfying number. Named events are the differentiated feature; cutting them entirely means R3 ships with much less than the user asked for.
2. **Safety gates are already strong enough for named rendering.** The named-event gate (≥ 10 attendees + non-sensitive + non-private-invite) is strictly stricter than the aggregate gate. If the aggregate gate is safe, the named gate is by construction safer.
3. **No extra schema cost.** Both projections can be computed in a single CTE pass over the same joined table. There's no runtime/storage argument for splitting them into separate releases.
4. **Graceful degradation.** When a pair of users have shared attendance where *only some* events clear the stricter gate, the UX naturally falls back: "You have 8 shared events, including: [3 named events]." That is exactly the experience the plan anticipates in §11.4 ("initially aggregate counts; named shared events only after all visibility thresholds pass").
5. **R3 rollout safety.** The hybrid model lets us ship with the named-event threshold deliberately high initially (≥ 10 per plan §8.3), then tune downward if observed abuse is zero. Rolling back from "named" to "aggregate only" is a one-flag change in the helper — or, if we add the env var suggested in §10, zero code change at all.

### Alternative considered and rejected

**Stop at aggregate only in R3.1, ship named in R3.2.** Rejected because:

- Doubles the privacy-policy-version-bump cost (R3.1 bump for the third toggle, R3.2 bump for named rendering).
- Named events use strictly the R2 allow-list — nothing new is exposed beyond what the `member_card_attended_events_for_viewer` helper already exposes for consenting members. Split-rollout buys no additional safety over the shared helper's gate structure.
- Small-group inference is the dominant risk and it attacks the *aggregate* count (via private-invite overlap), not the named list — splitting out named rendering delays the vulnerable primitive's shipping, not the safer one.

---

## 3. New migration

Migration filename: `20260425xxxxxx_shared_events.sql`.

### 3.1 Required cross-column invariant

R2 already provides the columns, helpers, and view surface R3 needs. The one required addition is a CHECK constraint enforcing `share_shared_event_counts = true` implies `discoverable = true`:

```sql
alter table public.profile_visibility_settings
  add constraint pvs_share_counts_requires_discoverable
  check (
    share_shared_event_counts = false
    or discoverable = true
  );
```

The `set_profile_visibility` helper (R2 §3.4) must be updated to surface a clear error message when a caller attempts to set `share_shared_event_counts=true` with `discoverable=false` — see §4.4.

### 3.2 Deferred additions

- **Configurable thresholds table** — keep constant-in-code (10) until one real event argues for a lower value.
- **Per-(viewer, target) audit surface** — reuse `audit_log`.
- **Materialized view** — only if benchmarks demand it (see §3.3).

### 3.3 Materialized view / summary table: not at R3 launch

At 10k members with typical attendance sparsity (< 50 events per user), the query cost for `shared_events_for_viewer(a, b)` is O(|attended_by_a| × log|attended_by_b|) via indexed hash join on `event_attendances(user_id, event_id)`. Existing `event_attendances_user_idx` supports this.

**Benchmark plan** (before GA, not before merge): seed 10k members, 500 events, avg 40 attendees/event, 30 events/member; measure p95 latency uncached.

**Trigger for adding materialized view:** p95 > 150 ms uncached at benchmark size.

**If triggered:** add `shared_event_pair_counts` (`user_low uuid, user_high uuid, event_count int, named_event_count int, computed_at timestamptz`) with canonical `user_low < user_high` ordering, refreshed via trigger on `event_attendances`. Deferred to R3.1.

### 3.4 Attendee-count caching: inline, not precomputed

The helper needs `count(*) from event_attendances where event_id = X` per candidate event. At 500 events this is 500 cheap counts per call — acceptable. Do not precompute `events.attendee_count`; drift surface.

---

## 4. Helpers

All SECURITY DEFINER unless noted; all `set search_path = public`; all `revoke all … from public; grant execute … to authenticated, service_role;`.

### 4.1 `shared_events_for_viewer(viewer_id uuid, target_id uuid) returns table (event_count int, named_events jsonb)`

Returns exactly one row.

**Gates enforced (in order, short-circuiting):**

1. `viewer_id` non-null and equals `auth.uid()` when `authenticated` (service_role bypass allowed).
2. `viewer_id <> target_id` (self-calls return `(0, '[]')`).
3. `is_fully_onboarded(viewer_id)` is true.
4. `can_view_member_card(viewer_id, target_id)` is true.
5. Viewer has `share_shared_event_counts = true`.
6. Target has `share_shared_event_counts = true`.
7. Rate limit: `consume_rate_limit('shared_events_view', viewer_id::text, 30, 60)`.

**Gates 3–7 fail silently** — return `(0, '[]'::jsonb)`. Do NOT raise. Flag-off and opt-out paths must be indistinguishable from "no shared events".

Gates 1–2 raise (bugs, not privacy boundaries).

**After gate-pass, per-event filter:**

For each event in the intersection of both users' `event_attendances`:

- Exclude `events.status in ('draft', 'archived')`. Cancelled stays in — both parties were physically there pre-cancellation.
- Exclude `events.visibility = 'private_invite'` — hard. Never contribute.
- Count attendees (`select count(*) from event_attendances where event_id = E`):
  - `< 10`: skip entirely.
  - `>= 10 AND is_sensitive = true`: counts for aggregate, NOT for named.
  - `>= 10 AND is_sensitive = false`: counts for both.

**Audit write (gate-pass path only):**

```sql
perform public.write_audit(
  'member.shared_events_view',
  viewer_id, target_id,
  jsonb_build_object(
    'aggregate_count',   v_event_count,
    'named_event_count', jsonb_array_length(v_named_events)
  )
);
```

Do NOT include event IDs in the audit row — audit is proof-of-access, not a second copy of the projection.

**No audit on gate-failure.** Repeated probing of opted-out targets should not fill audit_log; rate-limit bucket handles that.

**Named events payload shape:**

```json
[
  {
    "event_id":    "uuid",
    "event_slug":  "string",
    "event_title": "string",
    "starts_at":   "timestamptz"
  }
]
```

Ordered `starts_at desc`, capped at 50. `has_more` pagination deferred.

**Signature:**

```sql
create or replace function public.shared_events_for_viewer(
  p_viewer_id uuid,
  p_target_id uuid
)
returns table (event_count int, named_events jsonb)
language plpgsql
security definer
set search_path = public
as $$ ... $$;

revoke all on function public.shared_events_for_viewer(uuid, uuid) from public;
grant  execute on function public.shared_events_for_viewer(uuid, uuid) to authenticated, service_role;
```

### 4.2 `set_profile_visibility` updates

Extend R2 §3.4:

1. Setting `share_shared_event_counts = true` requires latest accepted `privacy_policy` version equals the R3-bumped version. If stale, raise `ERR_REACCEPT_PRIVACY_R3`.
2. Attempting `share_shared_event_counts=true` with `discoverable=false` raises `ERR_SHARED_EVENTS_REQUIRES_DISCOVERABLE` with a friendlier message than the raw CHECK violation.
3. Audit change as `member.visibility_changed` with before/after including `share_shared_event_counts`.

### 4.3 Rate limit — `shared_events_view` bucket

30/60 s. Higher than R2's `member.card_view` (20/60) because directory browsing legitimately hits 5–10 profiles in quick succession.

**Exhaustion behavior:** return `(0, '[]')`, NOT an error. No audit row. `rate_limit_hits` still records the attempt. Indistinguishable from "no shared events" — deliberate.

### 4.4 `list_member_cards` — no change

Do not fetch shared-events per list row. Detail page only, per §4.4 of R2 rationale and §6.4 below.

### 4.5 No admin helper

Do NOT ship `admin_shared_events_for(viewer, target)`. Admin inspection uses existing `audit_log` + direct `event_attendances` reads via R1 admin policies.

---

## 5. Threshold rationale

### 5.1 Why 10?

Plan §8.3 recommends ≥ 10. Reasoning: statistical anonymity; organizational fit (Progsu events are 15–80 typical); round-number legibility in policy copy.

### 5.2 Edge-count behavior

- 9 attendees: neither aggregate nor named.
- 10: aggregate yes; named yes if other gates pass.
- 11+: same as 10.

Boundary is `>= 10`, tested in smoke.

### 5.3 What counts as an attendee

**Count `event_attendances` rows, not RSVPs.** Shared events means "both checked in", not "both RSVP'd". State this in privacy copy.

Admin walk-in check-ins count (physical presence). Correction-deletions drop events live off current state — no snapshot.

### 5.4 Cancelled events that both attended

Include them. Real shared presence. Only `draft` and `archived` are excluded by status.

---

## 6. UX additions

### 6.1 `/members/[slug]` extension

After R2's "Attended events" block, add shared-events section gated on:

- `env.FEATURE_SHARED_EVENT_HISTORY === true`
- `auth.uid() !== card.user_id`
- Helper returned `event_count > 0`

Otherwise: render nothing (no heading, no skeleton, no "Coming soon").

### 6.2 Rendering rules

- `event_count == 0`: section hidden.
- `event_count > 0, named_events empty`: heading + "You and {name} have attended {event_count} shared events."
- `event_count > 0, named_events.length == event_count`: heading + list only (no aggregate counter — list is the count).
- `event_count > 0, named_events.length < event_count`: heading + list + "Plus {event_count - named_events.length} more shared events that aren't shown here."
  - Phrase deliberately avoids "sensitive"/"private" — don't classify hidden ones.

### 6.3 Named-event link behavior

Link to `/events/{slug}`. Viewer may or may not have access; 404 is acceptable. Fact of shared attendance was the consented payload.

### 6.4 No shared-events on `/members` list

Would turn into N+1 rate-limit hits and leak per-row existence. Detail page only.

### 6.5 Self-preview

R2's "Preview mode" banner already shows. Shared-events section always hidden in self-preview.

---

## 7. Feature flag gating

### 7.1 Env

`FEATURE_SHARED_EVENT_HISTORY` already wired in `lib/env.ts`. Default `false`.

### 7.2 Three check locations

1. **UX layer (`app/members/[slug]/page.tsx`)**: flag off → skip helper call entirely. Zero rows, zero audit, zero rate-limit hit.
2. **Server action wrapper (`lib/actions/members.ts`)**: flag off → short-circuit `(0, [])` without invoking helper.
3. **Helper layer — NOT checked.** Helpers stay deterministic given DB state. Flag is a rollout switch, not a privacy boundary.

### 7.3 Flag-off externally

- `/members/[slug]` renders R2 card only. No shared-events heading. No "unavailable".
- Settings toggle hidden entirely when flag off (R2 had "Coming soon"; R3-flag-off hides).
- No observable timing difference large enough to matter.

### 7.4 Kill switch semantics

Flag changes take effect next request. `share_shared_event_counts` column is NOT reset — opted-in users stay opted in. Re-enabling reactivates without re-consent (consent is tied to privacy-version, not flag-state).

---

## 8. Privacy copy updates

### 8.1 `/privacy` changes

1. **New section: "Shared event history with other members"** stating:
   - Opt-in via `/dashboard/settings`.
   - Mutual opt-in required.
   - Events with fewer than 10 attendees never included.
   - Sensitive events never shown by name.
   - Private-invite events never included.
   - Each view logged to a member audit log readable by admins.
   - Toggling off immediately stops new views. Does not delete prior audit records.
   - "Shared events" means both parties checked in (not just RSVP'd).
2. **Update R2 "Member directory" section** with cross-reference.
3. **Privacy version bump** v2.x → v3.0. Triggers onboarding-cascade re-acceptance.

### 8.2 Re-acceptance semantics

Same as R2 §6.2. `set_profile_visibility` extended so `share_shared_event_counts=true` flips require v3.0.

### 8.3 In-app copy

Settings toggle: **"Show shared event history to other members who opt in"**

Helper text: *"When another member and I have both enabled this, we can each see counts and — for events that were public, non-sensitive, and had at least 10 attendees — the names of events we both attended. We won't see private-invite events. Turning this off immediately hides your shared events from others."*

Link: "Learn more in our Privacy Policy." → `/privacy#shared-events`.

### 8.4 Terms

Counsel review only. R3 extends R2's member-card projection, not a distinct surface. No separate R3 Terms section expected.

### 8.5 Onboarding

No changes.

---

## 9. Smoke test: `smoke-shared-events-visibility`

Script: `scripts/smoke-shared-events-visibility.ts`.

### 9.1 Fixtures

**Members**: admin + 7 members covering all gate states (opted-in, partial opt-in, non-discoverable, stale-privacy, unonboarded, 3-way overlap tests).

**Events**: `public-big-1/2/3` (≥10, non-sensitive, members), `public-sensitive` (≥10, sensitive), `public-small` (9), `public-exact-ten` (10), `private-invite-big` (≥10, private), `draft-not-live`, `cancelled-big`, `archived-big`.

### 9.2 Scenarios

**Gate tests**: mutual opt-in happy path; self-view; each side opted-out; target not discoverable; viewer not onboarded; stale-privacy raise.

**Threshold boundary**: 9 hidden, 10 shown, re-add attendance moves events across boundary.

**Private-invite inference attack**: event never contributes regardless of attendee count.

**Sensitive-event**: counts aggregate, not named.

**Small-group inference**: 9 attendees excluded entirely.

**Flag-off**: DB helper returns data; server-action wrapper returns empty; UX renders nothing.

**Rate limit**: 30 ok, 31st empty-without-audit.

**Audit**: exactly one row per gate-pass call; zero on gate-fail.

**UX render**: 4 named + "plus 1 more"; non-discoverable target → 404; no-shared-toggle → card only.

### 9.3 Full scenario list — see §11 merge-blocker assertions

---

## 10. Open questions and abuse vectors

### 10.1 Private-invite inference attack

**Real vector, mitigated by symmetric filter.** Private-invite excluded from BOTH sides of the intersection, so count is invariant to target's private-invite attendance. Defense: mandatory symmetric filter in helper (§4.1 gate) + smoke scenarios 11, 12.

**Admin collusion** is out-of-product; handled by admin audit + personnel controls.

### 10.2 Attendance-correction race

Peer has cached `named_events` client-side after target toggles off. Accepted limit; state in privacy copy if legal requires.

### 10.3 Time-series inference

Daily polling detects aggregate increments from sensitive events. Mitigation options:

- **Accept** — known minor leak, target opted into count sharing.
- **Round aggregate down** to nearest 5 — weakens product; deferred.
- **Audit-based detection** — nightly report flagging actor-target pairs with >7 distinct-day calls per month. **Recommended for ops backlog.**

### 10.4 Timing side-channel

Gate-fail ~0.1 ms vs gate-pass ~10 ms. Viewer already knows their own opt-in state and target's discoverability (via `/members/[slug]` 404). No new info leaked.

### 10.5 Open design questions

1. Render aggregate-only sections when zero named events qualify? **Current spec: yes.**
2. Shared-attendance in event emails? **Out of scope.**
3. Counter always visible vs only when named < aggregate? **Weak call; defer to UX.**
4. `has_more` pagination when >50 named? **Deferred.**
5. Per-event opt-out? **Out of scope** — use `is_sensitive` or global toggle.

---

## 11. Merge blockers per plan §13.3

### 11.1 Mutual opt-in
- A1: viewer on, target off → `(0, [])`.
- A2: roles swapped → `(0, [])`.
- A3: flip in either direction takes effect next call.

### 11.2 Attendee threshold
- B1: 9 attendees → excluded.
- B2: 10 attendees (other gates pass) → +1 aggregate, +1 named.
- B3: delete one attendance row → next call drops it.

### 11.3 Non-private-invite (critical)
- C1: private-invite with 12 attendees → 0 contribution.
- C2: same at 100 attendees → still 0.
- C3: scan all fixtures — no `named_events` entry points to `visibility='private_invite'`.

### 11.4 Non-sensitive (named only)
- D1: sensitive + 12 attendees → aggregate yes, named no.
- D2: scan all fixtures — no `named_events` entry points to `is_sensitive=true`.

### 11.5 Feature flag
- E1: flag off → server action returns `(0, [])`.
- E2: flag off → UX renders nothing (no heading, no skeleton).

### 11.6 Re-acceptance
- F1: stale v2.0 user cannot flip `share_shared_event_counts=true` → `ERR_REACCEPT_PRIVACY_R3` raised.

### 11.7 Raw-profile denial preserved
- G1: peer reads of phone/emails/admin/verification → 0 rows (re-assert R2 Blocker B).

### 11.8 Audit + rate-limit + no leak
- H1: one audit per successful call, zero on failure.
- H2: 31st call within 60s → empty-without-audit.

### 11.9 Migration applies cleanly
- I1: `supabase db reset` through R1 + R2 + R3.

### 11.10 Cross-release parity
- J1: R1 onboarding-parity smoke green.
- J2: R2 member-cards-visibility smoke green.
- J3: new shared-events-visibility smoke green in CI.

---

## 12. Files the next agent will touch

- `supabase/migrations/20260425xxxxxx_shared_events.sql` — new; CHECK constraint + `shared_events_for_viewer` + extended `set_profile_visibility`.
- `app/members/[slug]/page.tsx` — extend with shared-events section.
- `app/dashboard/settings/visibility-settings.tsx` — activate third toggle.
- `app/privacy/page.tsx` — v3.0 copy update.
- `lib/actions/members.ts` — new `getSharedEventsForViewer` wrapper.
- `scripts/smoke-shared-events-visibility.ts` — new.
- `.env.example` — no new vars (flag already exists).

---

## Final Note

R3 is deliberately narrow: one helper, one UI section, one privacy-policy version bump, one smoke script, one CHECK constraint. Every broader ambition is explicitly deferred. Safety rests on symmetric gate application (not admin discretion, not caching) and audit-based detection of polling abuse. Flag-off, gate-failures, and rate-limit exhaustion are all indistinguishable from empty — no error path leaks feature existence.
