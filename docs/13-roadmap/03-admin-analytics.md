# 03 — Admin event analytics

Status: Planned. Detailed plan ready; awaits engineer attention.
Priority: Nice-to-have. Does not block R3 GA.
Created: 2026-04-22
Target surface: `/admin/events/[id]?tab=analytics` and a cross-event rollup at `/admin/events/analytics`.

## 0. Intro — why analytics

R1 shipped seven tabs on `/admin/events/[id]` (Details, Access, Guests, Notifications, Check-in, Activity, Review). The roster is good for "who is coming to this specific event." It is not good for the operational questions officers keep asking in practice:

- What is our RSVP-to-attendance conversion rate on hackathons vs. workshops?
- How often does the waitlist actually promote people, i.e. is `waitlist_enabled = true` doing anything?
- Are walk-ins a meaningful share of attendance, and if so should we stop rejecting RSVPs at the door?
- When we flip `send_reminder_email` on, does a reminder actually go out? Did anyone fail?
- Over the last 90 days, how many events did we run and what did attendance look like?

Today the only way to answer these is to open the Supabase SQL editor and write ad-hoc queries against `event_rsvps`, `event_attendances`, and `event_notification_jobs`. That works for one officer who already has Supabase access and SQL muscle memory, and fails for everyone else.

Scope discipline:

- Analytics is **read-only**. No new RPCs that mutate anything. No new writes except audit rows logging "admin viewed analytics".
- Analytics never exposes anything that isn't already in `admin_event_roster_for()`. Admins see per-member detail because they already can; members never see analytics at all.
- No export. CSV roster download already covers the legitimate need. Analytics is for glancing at numbers in a browser, not for feeding into external tools.
- No per-event analytics sharing. "Officer A wants to post 150 came to the hackathon on LinkedIn" is fine, but we don't build a shareable public permalink — it would be a new public surface with its own privacy review. Officers can screenshot, or we add it later if demand is real.

## 1. Per-event analytics tab (`/admin/events/[id]?tab=analytics`)

Add an eighth tab. It loads when the admin clicks it, not on the default page render, so we don't pay the aggregation cost on every Details view.

### 1.1 Layout

Four sections, top to bottom:

1. **Headline numbers** (single row, 4–6 stat tiles)
2. **RSVP and attendance breakdown** (table of counts by status)
3. **Timing** (when things happened, as a short table)
4. **Notifications** (reuses data we already store in `event_notification_jobs`)

No charts in V1. Every stat is either a number or a small table. Justification in §4.

### 1.2 Stat tiles (headline numbers)

Tile 1: **Going count**
- SQL: `select count(*) from public.event_rsvps where event_id = $1 and status = 'going'`
- Already computed once on Details (reuse). Source cost: cheap (indexed `event_rsvps_event_status_idx`).
- Effort: reuse. Priority: MVP.

Tile 2: **Attendance rate** (format: `42 / 50 = 84%`)
- SQL:
  ```sql
  select
    (select count(*) from public.event_attendances where event_id = $1) as attended,
    (select count(*) from public.event_rsvps where event_id = $1 and status = 'going') as going
  ```
- The interesting number is `attended / going` where the denominator is the going count at event-start time. Since we don't snapshot that, we use the current going count. For past events this is equivalent (no one can change RSVP after the window closes without an admin correction, which is audited). Note this subtly in tooltip copy.
- Source cost: cheap (two index scans).
- Effort: S. Priority: MVP.

Tile 3: **Walk-ins** (attendances with no prior RSVP of any status)
- SQL:
  ```sql
  select count(*) from public.event_attendances a
   where a.event_id = $1
     and a.method = 'admin_click'
     and not exists (
       select 1 from public.event_rsvps r
        where r.event_id = a.event_id
          and r.user_id  = a.user_id
     )
  ```
- Per plan §7.3, walk-ins are allowed (admin_check_in_member accepts users with no RSVP). This number is "how many had no roster trace until we clicked them in at the door."
- Source cost: cheap for any one event (PK lookups on `event_rsvps`, scan of attendances for this event via `event_attendances_event_idx`). Scales linearly with event size, which is bounded.
- Effort: S. Priority: MVP.

Tile 4: **No-shows** (RSVP'd going but no attendance row)
- SQL:
  ```sql
  select count(*) from public.event_rsvps r
   where r.event_id = $1
     and r.status = 'going'
     and not exists (
       select 1 from public.event_attendances a
        where a.event_id = r.event_id
          and a.user_id  = r.user_id
     )
  ```
- Semantically = going - attended + (walk-in overlap). In practice people care about "X people said they were coming and didn't" so we compute it directly. Only meaningful after the event window closes; show `—` if `ends_at > now()`.
- Source cost: cheap.
- Effort: S. Priority: MVP.

Tile 5: **Check-in method split** (format: `23 self / 19 admin`)
- SQL: `select method, count(*) from public.event_attendances where event_id = $1 group by method`
- Answers "how did people check in" — useful when evaluating whether the self-code flow is being used at all.
- Source cost: cheap.
- Effort: S. Priority: MVP.

Tile 6: **Waitlist depth** (current waitlisted count)
- SQL: `select count(*) from public.event_rsvps where event_id = $1 and status = 'waitlisted'`
- Reused from Details header area if available; otherwise cheap.
- Source cost: cheap (indexed).
- Effort: reuse. Priority: MVP.

### 1.3 RSVP breakdown table

One-row-per-status table:

| Status | Count |
|---|---|
| Going | n |
| Waitlisted | n |
| Declined | n |
| Cancelled | n |

Plus two derived rows:
- **Promoted from waitlist**: members whose RSVP status ever transitioned from `waitlisted` to `going`. See §1.5.
- **Walk-ins** (no RSVP row, attended anyway): same as tile 3, repeated here for context.

SQL (single query, cheap):
```sql
select status, count(*)
  from public.event_rsvps
 where event_id = $1
 group by status
```

Priority: MVP. Effort: S. Cost: cheap (indexed scan).

### 1.4 Timing section

A small 2-column table answering "when did things happen":

| Milestone | Timestamp |
|---|---|
| Created | events.created_at |
| Published | events.published_at |
| First RSVP | min(rsvp_at) from event_rsvps |
| Capacity reached | first moment going count hit capacity — **not stored**, derivation below |
| First check-in | min(checked_in_at) from event_attendances |
| Reminder sent | events.reminder_sent_at |
| Event start / end | events.starts_at / ends_at |
| Cancelled | events.cancelled_at (if applicable) |
| Cancellation lead time | cancelled_at - starts_at, expressed in hours/days, negative if after start |

Most rows are direct column reads. Two are derived:

**First RSVP**:
```sql
select min(rsvp_at) from public.event_rsvps
 where event_id = $1 and status in ('going', 'waitlisted')
```
Cheap; we have `(event_id, user_id)` PK so a filter-on-event is a scan of that event's rows only.

**Capacity reached**:
Only computable if we either have audit-log data ordered by time, or we add a `capacity_reached_at` column to `events`. Proposal: skip in MVP. The stat is nice-to-have and requires either a new column or replaying audit_log `event.rsvp` entries for this event, which is a full scan of audit_log metadata (GIN-indexed on `metadata` so it's not catastrophic, but it's moderate cost and complex SQL). **Defer to "nice".**

If we do compute capacity-reached later (nice-to-have): the data we'd need exists in `audit_log` where `action = 'event.rsvp'` and `metadata->>'event_id' = $1` and `metadata->>'effective' = 'going'`, ordered by created_at. We'd walk those rows and find the one where the running count of `effective = 'going'` events hits the event's capacity. This is a moderate-cost derivation. Could instead add a migration: on rsvp_to_event, if the insert crosses `count(going) == capacity`, stamp `events.capacity_reached_at = now()`. Write-side solution is cheaper than read-side. Tag as "nice" and flag in Schema Implications §3.

**Cancellation lead time**:
```sql
select
  extract(epoch from (events.starts_at - events.cancelled_at)) / 3600
    as hours_in_advance
from public.events where id = $1
```
Format as "2d 4h" or similar. Priority: MVP when cancelled, suppress row otherwise.

Priority: MVP for everything except capacity-reached. Effort: S–M (the render layer is more code than the SQL). Cost: cheap.

### 1.5 Promoted-from-waitlist (derived from audit_log)

There's no boolean on `event_rsvps` that says "this row was once waitlisted and got promoted." The waitlist→going transition is only recorded in `audit_log` with `action = 'event.promote_waitlist'` (and the `event.rsvp` action also records the `previous` and `effective` in metadata, covering the self-RSVP-went-from-waitlisted case).

For MVP, count two sources:

```sql
select count(distinct target_user_id)
  from public.audit_log
 where action = 'event.promote_waitlist'
   and metadata->>'event_id' = $1::text;
```

Plus self-triggered waitlist→going (rarely happens, but possible when someone cancels and the user re-RSVPs):

```sql
select count(distinct actor_user_id)
  from public.audit_log
 where action = 'event.rsvp'
   and metadata->>'event_id'  = $1::text
   and metadata->>'previous'  = 'waitlisted'
   and metadata->>'effective' = 'going';
```

Take the union. Cost: moderate — this uses the JSON-text filter which is not index-optimized on `audit_log.metadata` unless we lean on the existing GIN index with a containment query. Rewrite as:

```sql
select count(distinct coalesce(target_user_id, actor_user_id))
  from public.audit_log
 where action in ('event.promote_waitlist', 'event.rsvp')
   and metadata @> jsonb_build_object('event_id', $1::text)
   and (
     action = 'event.promote_waitlist'
     or (metadata @> '{"previous":"waitlisted","effective":"going"}'::jsonb)
   );
```

The `@>` containment operator uses the `audit_log_metadata_gin` index. For a young audit_log (thousands of rows) this is fine. Flag for re-evaluation when the log hits 100k+ rows.

Priority: MVP for the total count, nice for per-member detail.

### 1.6 Notifications mini-section

Group `event_notification_jobs` by `kind` × `status` for this event_id:

```sql
select kind, status, count(*)
  from public.event_notification_jobs
 where event_id = $1
 group by kind, status
 order by kind, status;
```

Rendered as a tiny table:

| Kind | Pending | In flight | Sent | Failed | Skipped |
|---|---|---|---|---|---|
| Confirmation | 0 | 0 | 142 | 2 | 0 |
| Reminder | 0 | 0 | 138 | 4 | 0 |
| Cancellation | 0 | 0 | 0 | 0 | 0 |

Uses the existing `event_notification_jobs_event_idx` (event_id, kind, status). Cheap.

If any failed count is > 0, link to the Activity tab filtered to notification-failure audit rows. (Current Activity tab does not filter — that's its own roadmap item; for now, just show the number.)

Priority: MVP. Effort: S. Cost: cheap.

### 1.7 Host info

Right rail or bottom: hosts of the event.

```sql
select display_name, profile_id, sort_order
  from public.event_hosts
 where event_id = $1
 order by sort_order asc;
```

Already loaded at the page level in `page.tsx`. Just re-render here with a small heading "Hosted by". No new query. This is context for the admin who's looking at the analytics for an event they didn't run.

Priority: MVP. Effort: trivial (reuse).

### 1.8 Privacy per event

All numbers above are aggregate within a single event. Per-member data only appears if we expand tiles to drill-down tables (e.g., "19 no-shows" → click → list). For MVP, no drill-downs — keep it as counts. If we later add drill-downs, they must use `admin_event_roster_for()` as the backing query (no custom user-detail SQL), since that RPC already logs a `event.roster_view` audit event.

## 2. Cross-event rollup (`/admin/events/analytics`)

New page. Add a link in the events list header ("Analytics →") next to "Create event". Also add an "Analytics" nav in the admin sidebar if there's room.

### 2.1 Time windows

Three rollups: last 30 days, last 90 days, last 365 days. Computed against `events.ends_at` (the event happened within this window). Show them in a tiled row, each time window being a card.

### 2.2 Headline metrics per window

For each window $w$ days:

**Events run**:
```sql
select count(*) from public.events
 where status in ('published', 'cancelled', 'archived')
   and ends_at >= now() - interval '$w days'
   and ends_at <  now();
```

**Total RSVPs (going)**:
```sql
select count(*) from public.event_rsvps r
  join public.events e on e.id = r.event_id
 where r.status = 'going'
   and e.ends_at >= now() - interval '$w days'
   and e.ends_at <  now();
```

**Total check-ins**:
```sql
select count(*) from public.event_attendances a
  join public.events e on e.id = a.event_id
 where e.ends_at >= now() - interval '$w days'
   and e.ends_at <  now();
```

**Average attendance rate (event-averaged, not person-averaged)**:
```sql
select avg(rate) from (
  select
    coalesce(
      (select count(*)::numeric from public.event_attendances a where a.event_id = e.id)
      / nullif((select count(*) from public.event_rsvps r
                 where r.event_id = e.id and r.status = 'going'), 0),
      0
    ) as rate
  from public.events e
  where e.ends_at >= now() - interval '$w days'
    and e.ends_at <  now()
    and e.status <> 'draft'
) sub;
```

Each inner `select count(*)` is O(event size) and there's one per event. For 30 days this is cheap. For 365 days it's N events × 2 index scans. Still reasonable at current scale (plan §15 baseline: 15–80 attendees per event). Flag for re-evaluation at >500 events/year.

**Visibility split**:
```sql
select visibility, count(*) from public.events
 where ends_at >= now() - interval '$w days'
   and ends_at <  now()
 group by visibility;
```

Two numbers per window: members vs private_invite.

**Email delivery health** (aggregate across all notification jobs for events ending in window):
```sql
select j.kind, j.status, count(*)
  from public.event_notification_jobs j
  join public.events e on e.id = j.event_id
 where e.ends_at >= now() - interval '$w days'
   and e.ends_at <  now()
 group by j.kind, j.status;
```

Tile: "Email delivery: 98.4% sent, 0.6% failed, 1.0% skipped."

Priority: MVP for 30-day and 90-day. 365-day is nice (same query, bigger window, tiny incremental cost; ship it).
Effort: M (mostly layout work).
Cost: moderate. Multiple aggregations, no pre-materialized rollups. See §3 for materialization proposal if this becomes slow.

### 2.3 Most active members (opt-in aware)

**Decision**: cut from MVP.

Reasoning: admins already see everything via `admin_event_roster_for()`. A "top attendees across the last 90 days" leaderboard is individual-level data that's already accessible; showing it aggregated on one screen makes lookup faster but doesn't change the privacy surface. However:

- The feature has very low officer demand relative to engineering time. No one has asked.
- It inherits the member-directory opt-in question: do we surface names or just user ids? If names, we need to re-audit whether it composes with opt-in. Admins seeing names is fine per R2 spec, but the precedent matters — we don't want a future contributor to copy the pattern into a member-facing page.
- Defer to "later". If it comes up, the query is trivial:

```sql
select p.first_name, p.last_name, p.student_email, count(*) as attended
  from public.event_attendances a
  join public.events e on e.id = a.event_id
  join public.profiles p on p.id = a.user_id
 where e.ends_at >= now() - interval '365 days'
 group by p.id, p.first_name, p.last_name, p.student_email
 order by attended desc
 limit 50;
```

Cost: moderate (joins to profiles; indexed by user_id on attendances). Ship only if officers ask.

Priority: later. Effort: S (query + render). Cost: moderate.

### 2.4 Do cross-event rollups include private-invite events?

Yes. Admins already see all events. The rollup is admin-only, so including private-invite events is consistent with R1 admin authority. The visibility-split tile will naturally reveal how much of the volume is private_invite, which is itself useful (e.g., if 80% of last quarter's events were invite-only, that's a product insight worth seeing).

Per-event analytics tab: yes, always shows the owner their own event's analytics regardless of visibility. No opt-in needed — this is the admin surface.

## 3. Schema implications

Current indexes cover almost everything we need:

- `event_rsvps_event_status_idx` — per-event status groupings (MVP tiles 1, 4, 6; breakdown table)
- `event_rsvps_event_waitlist_idx` — waitlist FIFO (used implicitly in `admin_event_roster_for`)
- `event_attendances_event_idx` — per-event attendance counts (tiles 2, 3, 5)
- `event_notification_jobs_event_idx` — per-event notification rollups (§1.6)
- `events_status_starts_at_idx` and `events_discovery_idx` — event filtering for rollup windows (§2.2)
- `audit_log_metadata_gin` — JSON containment for waitlist-promotion derivation (§1.5)

What's missing or weak:

1. **No ends_at index.** Cross-event rollup (§2.2) filters by `ends_at` windows. Current indexes are on `starts_at`. For 30-day windows over a few hundred rows the planner will seq-scan and be fine; for 365-day windows with thousands of events this becomes moderate cost. **Proposal**: add `events_ends_at_idx on public.events (ends_at) where status in ('published', 'cancelled', 'archived')`. Tiny index, improves every rollup query. Ship as part of the analytics migration.

2. **No per-event attendance-count column.** Every analytics load recomputes counts from scratch. For one officer opening one analytics tab, this is fine — the counts are sub-millisecond. For cross-event rollup with 365 days of events, we're doing O(N) count subqueries. **Proposal A**: add denormalized `events.cached_going_count`, `cached_waitlist_count`, `cached_attended_count` columns updated via triggers on `event_rsvps` and `event_attendances`. Complex to get right (triggers must handle soft-state transitions). **Proposal B**: a materialized view `event_analytics_summary` refreshed nightly. Simpler. **Recommend B for later**, not MVP. MVP should just do the on-demand SQL; if the page feels slow (server-render > 500ms), switch to materialized view in a follow-up.

3. **Capacity-reached timestamp** (§1.4): to compute it cheaply, add `events.capacity_reached_at timestamptz` and stamp it in `rsvp_to_event` when a going insert makes `count(going) = capacity`. Write-side solution. Defer to "nice"; not worth a migration for V1.

4. **No dedicated analytics RPC.** Consider wrapping the per-event query set in a single SECURITY DEFINER function `admin_event_analytics_for(p_event_id uuid)` that:
   - Checks `is_admin(auth.uid())`, raises P0001 if not.
   - Writes audit row `event.analytics_view`.
   - Returns a single-row record with all tile numbers.

   This is analogous to `admin_event_roster_for()` and keeps the app code simple (one RPC call instead of 7 subqueries). Also makes the audit story clean: one "analytics view" audit row per page load, same as roster. **Recommend shipping this in the analytics migration.** Effort: M (SQL function with a CTE per metric).

   Similarly `admin_cross_event_analytics(p_window_days int)` for the rollup. Returns one row with all window aggregates. **Recommend.**

5. **No event-category or event-type column.** The request mentions "hackathons vs workshops" but we don't tag events by type. Out of scope — we can't slice by something we don't store. A later migration could add `events.kind text`.

### 3.1 Proposed analytics migration

File: `supabase/migrations/20260426000100_event_analytics.sql`
Contents:
- `create index events_ends_at_idx on public.events (ends_at) where status in ('published', 'cancelled', 'archived');`
- `admin_event_analytics_for(p_event_id uuid)` — SECURITY DEFINER, admin-only, returns the tile numbers as a JSONB record. Audit-logs each call.
- `admin_cross_event_analytics(p_window_days int)` — SECURITY DEFINER, admin-only, returns the rollup aggregates for a window. Audit-logs each call.

No new tables. No materialized views in MVP. If the RPCs run >500ms consistently, add a materialized view in a follow-up migration.

## 4. Privacy review

Question: does analytics surface data beyond `admin_event_roster_for()`?

Audit of what each section shows:

- **Tile counts (§1.2)**: aggregate only. No per-member data. Safe.
- **RSVP breakdown table (§1.3)**: aggregate. Safe.
- **Timing (§1.4)**: `min(rsvp_at)` is effectively "when did the fastest person click RSVP" — doesn't reveal who. Safe.
- **Promoted-from-waitlist (§1.5)**: aggregate count only. Derived from audit_log, which admins already read directly (cf. `/admin/audit`). Safe.
- **Notification mini-section (§1.6)**: counts by kind × status. No per-recipient data. Safe.
- **Host info (§1.7)**: already on Details tab. Safe.
- **Cross-event rollup (§2)**: all aggregate counts across events. Safe.

Drill-downs (explicitly deferred): would surface per-member data (e.g., "list of no-shows"). If added later, back them with `admin_event_roster_for()` filtered client-side rather than a new SQL query, to keep audit-logging single-sourced.

**Verdict**: analytics stays strictly inside what admin_event_roster_for() already exposes, often less. Safe to ship without privacy-policy changes.

Audit story: every analytics-tab view writes one `event.analytics_view` audit row (via the RPC). Every rollup-page view writes one `event.cross_event_analytics_view` audit row. Consistent with existing pattern (roster_view). No PII in metadata, just event_id (per-event) or window_days (rollup).

## 5. Charts vs. numbers — library decision

Honest assessment first: **do we need charts at all?**

- Per-event tab has 4–6 tile numbers and a couple of small tables. That's all legible as numbers.
- Cross-event rollup has 4–5 numbers per time window. Three windows = 12–15 numbers total. Still legible.
- The one place charts help is "waitlist depth over time" — but we don't have the time-series data unless we derive it from audit_log, which is moderate cost and a stretch goal anyway.

**Recommendation**: ship V1 with zero chart dependencies. Tables and numbers only. Styled like the existing Activity and Guests tabs (plain HTML tables, Tailwind, muted-foreground labels).

If a chart becomes necessary later:
- No `d3`, `recharts`, `victory`, `nivo`, etc. Bringing in a chart library adds 40–150 kB of JS for what is effectively a bar chart.
- Write a 20-line SVG component inline. Bars are `<rect>`, labels are `<text>`. This is the pattern the rest of the app follows (no Chart.js, no heavy vis libs).
- If we need a real chart library later, revisit with actual requirements.

**Library added for this feature**: none.

## 6. Implementation order and effort total

Pre-flight:
- [ ] Confirm with officers: is this what they actually want? Show mock.
- [ ] Feature-flag behind `FEATURE_EVENTS_ANALYTICS` (already-established pattern) — defaulted off, flipped on for admins.

### Phase 1 — Schema + RPCs (half a day)
1. Write migration `20260426000100_event_analytics.sql`:
   - `events_ends_at_idx`
   - `admin_event_analytics_for(uuid) returns jsonb` — per-event aggregates
   - `admin_cross_event_analytics(int) returns jsonb` — rollup aggregates
2. Run `supabase db reset` locally; verify indexes and functions exist.
3. Write a tiny smoke script at `scripts/smoke-admin-analytics.ts` seeding 3 events with RSVPs/attendances and asserting the RPCs return sensible shapes.

### Phase 2 — Per-event analytics tab (1 day)
4. Add an eighth `analytics` entry to `TABS` in `app/admin/events/[id]/page.tsx`.
5. Create `app/admin/events/[id]/analytics-tab.tsx` client-free component rendering tiles + breakdown table + timing table + notifications mini-table.
6. Add `AnalyticsTabServer` helper in `page.tsx` that calls `admin.rpc('admin_event_analytics_for', { p_event_id: ev.id })` and feeds the result to the component.
7. Types in `types.ts` for the returned shape.
8. Add a link from the Activity tab's notification-failure count ("see failures in Activity") — noop wiring unless/until Activity tab gains filtering (out of scope).

### Phase 3 — Cross-event rollup page (1 day)
9. Create `app/admin/events/analytics/page.tsx`.
10. Admin gate inherited from `app/admin/layout.tsx` (same pattern as every other admin page).
11. Server-side call `admin.rpc('admin_cross_event_analytics', { p_window_days: N })` three times (30/90/365). Parallelize with `Promise.all`.
12. Render three tiled cards, one per window.
13. Header-link from `app/admin/events/page.tsx` ("Analytics →" next to "Create event").
14. Optional: sidebar link in `app/admin/layout.tsx` under Events.

### Phase 4 — Polish (half a day)
15. Tooltip copy on the denominator subtlety of attendance-rate (see §1.2 tile 2).
16. "Updated: now" freshness indicator on the rollup page.
17. Empty-state copy: "No events ran in this window."
18. Cancellation lead-time formatting (`2d 4h in advance` vs `6h after start`).
19. Write follow-up unit test in `app/admin/events/[id]/analytics-tab.test.tsx` style if the test runner is set up for component tests; else, skip (the smoke script already covers the SQL).

### Total effort
3 days of engineering work for MVP. All items in §1 and §2 except:
- capacity-reached timestamp (nice, needs events column + trigger update)
- most-active-members leaderboard (later, cross-member query)
- drill-down tables (later, re-uses admin_event_roster_for)
- materialized view for rollup performance (later, only if measured slow)

### 6.1 Follow-up backlog (post-MVP, in priority order)

1. **Capacity-reached timestamp**: add `events.capacity_reached_at` + stamp it in `rsvp_to_event`. Read is then free. 1 day.
2. **Drill-down tables**: clicking a tile opens a filtered roster (backed by `admin_event_roster_for()`). 1 day.
3. **Materialized view** `event_analytics_summary`: refreshed on a nightly cron. 1 day. Gate behind observed p95 of rollup page > 500 ms.
4. **Most-active-members leaderboard**: cross-event query, admin-only view. 0.5 day. Ship only on explicit request.

## 7. Open questions for the implementing engineer

1. **Tab ordering**: does "Analytics" go between "Check-in" and "Activity", or at the end next to "Review"? Recommend the former — check-in → analytics → activity → review is a narrative flow from operations to retrospection.
2. **Analytics RPC audit row**: some admins may find "analytics.view" audit spam excessive (every page open → one audit row). Current roster view has the same property and we haven't heard complaints. Keep behavior consistent with roster.
3. **Mobile**: the per-event tab has 4–6 tiles in a row. At mobile widths, wrap to 2 columns. Cross-event rollup has 3 windows; stack vertically on mobile. Follow existing Tailwind patterns in `guests-tab.tsx`.
4. **Cache**: per-event RPC output could be cached for 60 seconds (Next.js `revalidate`) since the numbers don't change second-to-second and it's the same admin hitting refresh. However, that hides live roster changes during a check-in session, which is when admins are most likely to look. Recommend **no caching** — let the SQL run on every request, it's cheap.

## 8. Out of scope (noted for future)

- Per-event public share link. Requires a new public surface, new privacy review, member-card-level attention. Route idea: `/events/[slug]/report` with redacted counts only, gated behind `FEATURE_EVENTS_PUBLIC_ANALYTICS`. Not in this plan.
- CSV export of analytics. Roster export (via `admin_event_roster_for()` rendered through `/admin/export` or similar) already exists in spirit. If analytics export is later requested, it's a ~1-hour add: render the RPC output to CSV in a new server action.
- Event categories / kinds (`events.kind`). Requires product decision on taxonomy. Add when event volume justifies slicing.
- "Funnel" analytics (view → RSVP → attend). We don't track event-page views. Would need a new analytics events table. Out of scope.
- Comparison across events (this event vs last event, this quarter vs last quarter). Possible with current schema but layout becomes complex. Defer.
