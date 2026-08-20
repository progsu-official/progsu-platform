# 02 — Member-Facing UX Polish (R1)

Owner: TBD (pilot-stage engineer)
Status: Planned, ready to execute before Phase B
Depends on: R1 merged + deployed + migrations applied (all satisfied as of 2026-04-22)

## Polish Philosophy

R1 shipped a functional MVP for every member surface listed in `docs/09-events-platform-plan.md` §11.2. This doc is the deliberate second pass: close the visual and functional distance between `/admin/events` (which has received more iteration) and `/events` (which was treated as "ship the basic shape, move on"). Phase B of the pilot runbook will put real members on these screens for the first time; rough edges surface as confusion, not as charm.

Five rules keep this pass cheap:

1. **Reuse existing primitives.** `components/ui/{button,input,label}.tsx`, the local `Badge` in `app/events/page.tsx`, the existing `EventDate` formatter, Tailwind tone utilities already in the file. No new UI framework. No new package unless a concrete requirement demands it.
2. **Match admin surface density where it helps.** The admin tab table has `StatusBadge`, going/waitlist counts, and capacity already in `app/admin/events/page.tsx` lines 205-221. Extract and mirror.
3. **Keep server-rendered.** Every page in `/events` is already `dynamic = "force-dynamic"`; nothing here requires client JS except the three existing client islands (`rsvp-panel`, `check-in-form`, `events-nav`). Markdown rendering is server-side for both performance and HTML sanitization.
4. **Don't regress privacy.** No surface introduced here may show a peer's name, email, or attendance status to another member. The check-in page proposal (§8) threads this needle by showing only admin/officer-hosted identities (which are already public content via `event_hosts.display_name`).
5. **Feature-flag nothing new.** Every item is a same-flag improvement — `FEATURE_EVENTS` already gates the whole surface.

Total estimated effort: **~11-14 hours** (670-830 minutes). Priority column answers: do before Phase B, nice-to-have, or defer to R1 GA retrospect.

---

## Gap 1 — `/profile` Upcoming Events Card is Bare-Bones

### Current state

`app/profile/page.tsx` lines 210-289 define `UpcomingEventsCard`. Each row shows only the event title, a `new Date(starts_at).toLocaleString()` timestamp, and a going/waitlisted pill. The data fetch at line 43-49 selects only `event_id, slug, title, starts_at, rsvp_status` from `self_event_history`.

Missing: location, status badge (is this event still published or was it cancelled?), cover thumbnail, no way to change RSVP without clicking through, waitlist position for the waitlisted state.

### Exact files to touch

- `app/profile/page.tsx` lines 41-50 (expand the `select`), lines 210-289 (rewrite `UpcomingEventsCard`).

### Specific code changes

1. **Expand the `self_event_history` select** (line 44): add `ends_at, status, location_text, waitlisted_at`. These columns exist in the view per `20260423000400_event_views_notifications.sql` lines 68-90. Keep the `rsvp_status in ('going','waitlisted')` filter; add `status in ('published','cancelled')` so we don't stall on archived rows.
2. **Fetch cover paths in the same pass.** `self_event_history` does NOT expose `cover_image_path` (verified in the view definition). Two options:
   - Option A (recommended): add `cover_image_path` to the `self_event_history` view definition in a follow-up migration — non-sensitive, already-visible content. Zero extra query on the dashboard.
   - Option B (if no migration desired this pass): a second `supabase.from('events').select('id, cover_image_path').in('id', eventIds)` after the history query, mapped by id. Adds one query with O(3) rows; acceptable.
   Prefer A for long-term cleanliness; B is the zero-migration path.
3. **Resolve signed URLs server-side in the card.** Mirror the existing `resolveCoverUrl` helper at `app/events/[slug]/page.tsx` lines 270-282. Call in parallel via `Promise.all` so three rows = one awaited batch.
4. **Card layout**: thumbnail on the left (w-16 h-16 rounded, `object-cover`), title + `EventDate` (reuse the component) + location underneath, RSVP pill on the right, plus a small "Change" secondary link pointing to `/events/[slug]`. For cancelled rows, show the existing `Badge tone="destructive"` with "Cancelled".
5. **Waitlist position in the card.** If `rsvp_status === 'waitlisted'`, pass the position via a batch `rpc('my_waitlist_position')` call per event — but cap the loop to 3 (the limit). Show "#N on waitlist" inline.

### Rationale

Plan §11.2 says the dashboard card should surface "next Progsu plans." At MVP density the user cannot tell a cancelled event from a live one, and must click through to change an RSVP. The admin `/admin/events` table at lines 150-195 shows going/waitlist plus visibility and status in the same row; the dashboard can afford a lighter analog. Cover thumbnails convert "text rows" into "event tiles" at zero cost once signed URLs resolve.

### Effort estimate

80-100 minutes. Most of it is the migration decision (A vs B) and the batched signed-URL Promise.all.

### Priority

**Must-have before Phase B.** The dashboard is where most members will land first and decide whether the events surface feels real.

---

## Gap 2 — Markdown Description Rendering

### Current state

`app/events/[slug]/page.tsx` lines 249-259 render `event.description_md` inside a `<div className="whitespace-pre-wrap text-sm text-foreground">`. The comment at line 254 explicitly defers markdown. Raw URLs don't become clickable links; `**bold**` and `# heading` syntax render as literal asterisks and pounds; the admin write surface `app/admin/events/[id]/details-tab.tsx` presents a multiline textarea that implies markdown because the column is `description_md`.

### Package options (server-side, no new client JS)

I checked `package.json`. Available today: `react-dom`, `react`, `@react-email/components`, plus the Radix slot. Nothing that renders markdown. Options:

- **`react-markdown` + `rehype-sanitize`**: industry default. React components; works in RSC. Adds ~50kb gzipped across both deps, but tree-shaken on the server path. License: MIT.
- **`marked` + `dompurify`**: lighter (~15kb combined server side), but DOMPurify needs a DOM or `jsdom` shim on the server path. Avoid.
- **`micromark` + a custom renderer**: too much bespoke work for the polish budget.
- **Roll-our-own minimal renderer**: regex for newlines, URL auto-linking, bold/italic, headings. Cheap (~50 lines), but we will regret it the first time someone pastes a real list.

Recommendation: **`react-markdown@9` + `rehype-sanitize@6`**. Tree-shaken to the server. The RSC path renders static HTML; no client hydration cost. Allow-list a minimal schema: `p, br, strong, em, a, ul, ol, li, h2, h3, h4, blockquote, code, pre`. Explicitly strip `img, iframe, script, style`. Add `rel="noopener noreferrer"` + `target="_blank"` to anchors via `rehype-react` component override (or a `transformLinkUri` callback). Cap description length to 10,000 chars at the DB level already — no perf concern.

### Exact files to touch

- `app/events/[slug]/page.tsx` lines 249-259.
- New file `app/events/[slug]/_components/event-description.tsx` — a server component wrapping `react-markdown` + the sanitizer schema.
- `package.json`: add `react-markdown`, `rehype-sanitize`.
- Optional: `lib/markdown/sanitize-schema.ts` to centralize the allow-list if we also render markdown on admin preview tabs.

### Specific code changes

1. Add `"react-markdown": "^9.0.0"` and `"rehype-sanitize": "^6.0.0"` to dependencies.
2. Create `app/events/[slug]/_components/event-description.tsx` exporting `EventDescription({ md }: { md: string })` that returns `<ReactMarkdown rehypePlugins={[[rehypeSanitize, schema]]} components={{ a: ExternalLink }}>`. Wrap in `<div className="prose prose-sm max-w-none">`. If Tailwind Typography plugin is not installed (it isn't per package.json), substitute explicit class tuning: `[&>p]:my-2 [&>h2]:text-base [&>h2]:font-semibold [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 text-sm text-foreground`.
3. `ExternalLink` component: enforces `target="_blank" rel="noopener noreferrer"` on all rendered `<a>` tags, adds `className="text-primary underline underline-offset-4"`.
4. Replace the `<div className="whitespace-pre-wrap...">` block with `<EventDescription md={event.description_md} />`.
5. Keep the `<section>` wrapper and "About this event" heading; they're outside the component.

### Rationale

Plan §9.2 names the column `description_md` — the `_md` suffix is a contract that markdown will eventually render. Phase B members will paste URLs ("RSVP here", "Zoom link"); clickable anchors are the minimum expected behavior in 2026. Server-rendering + sanitization aligns with plan §10.3 "privileged writes go through server path" — we are consuming content server-side with a strict allow-list.

### Effort estimate

90 minutes (dependency + component + wire-in + verify against three sample markdown strings).

### Priority

**Must-have before Phase B.** Any pilot event that lists a meeting link in the description will render as plain text today, forcing manual copy-paste — a highly visible MVP smell.

---

## Gap 3 — Cover Image Loading Strategy

### Current state

`app/events/[slug]/page.tsx` line 120 calls `resolveCoverUrl` for every render. Because `dynamic = "force-dynamic"`, every member visit to an event page re-issues a `createSignedUrl` call (line 278) with 3600s TTL. There is no in-memory cache; Next.js's route cache is disabled; Supabase signs a fresh URL every time.

Practical measurements: for a ~30-attendee pilot event visited maybe 100 times over a week, this is ~100 signed URL requests — well under Supabase limits. Not a perf fire. But it's architecturally sloppy and the 1h TTL is longer than a typical session.

No fallback exists. If `createSignedUrl` returns `error` (expired token reused from cache, bucket misconfigured), `coverUrl` is `null` and the cover area silently disappears. A member who saw a cover in list view but none on detail will read that as "something broke."

The member list view at `app/events/page.tsx` does NOT fetch `cover_image_path` at all — line 123 selects `"id, slug, title, starts_at, ends_at, location_text, capacity, waitlist_enabled, going_count, waitlisted_count, hosts"`. So covers exist only on detail; list cards are text-only.

### Exact files to touch

- `app/events/[slug]/page.tsx` lines 120, 163-172, 270-282.
- `app/events/page.tsx` line 122-127 (select) + lines 162-177 (UpcomingTab render) + 236-272 (MyPlansTab) + 375-394 (PastTab).
- New: `lib/events/cover-url.ts` — shared `resolveCoverUrl` helper used by dashboard, list, detail.

### Specific code changes

1. **Extract `resolveCoverUrl` to `lib/events/cover-url.ts`.** Keep the signature `(supabase, path) => Promise<string | null>`. This kills the duplication between `app/events/[slug]/page.tsx` line 270 and `app/admin/events/[id]/page.tsx` line 99.
2. **Add cover_image_path to list selects.** `app/events/page.tsx` line 122: change the `member_visible_events` select to add `cover_image_path`. The view at `supabase/migrations/20260423000400_event_views_notifications.sql` line 25 already exposes it. Same for the history query (line 189) and the invites fallback (line 285) — see Gap 1 note about extending `self_event_history` or using a second query batch.
3. **Batch signed URLs for list views.** In `UpcomingTab`, after mapping rows, do:
   ```
   const coverUrls = await Promise.all(rows.map(r => resolveCoverUrl(supabase, r.cover_image_path)));
   ```
   Pass `coverUrls[i]` to each `EventCard`. Supabase signs in parallel — same latency as one call for ~25 rows.
4. **Thumbnail in `EventCard`.** Extend `EventCard` to accept `coverUrl: string | null`. Render a `w-full aspect-[3/1] rounded-t-md border-b bg-muted` banner at the top of the card; fall back to a muted gradient (`bg-gradient-to-br from-muted to-accent/20`) when `coverUrl === null`. Preserves card dimensions.
5. **Fallback on detail page.** When `coverUrl === null` and `event.cover_image_path != null`, render a muted placeholder instead of dropping the banner. This tells the viewer "there was meant to be an image, but it couldn't load," and keeps layout stable.
6. **Reduce TTL where possible.** 3600s is generous; `createSignedUrl(path, 600)` (10 min) is enough for a single session and reduces how long a leaked URL is valid. Non-sensitive but courteous.
7. **Keep `no-store` semantics.** The page is already `force-dynamic`; no Next.js revalidation cache. The signed URL regen per request is acceptable. If we later introduce `fetch cache: 'force-cache'` for cover URLs, keyed by `cover_image_path`, revisit TTL to avoid serving stale URLs.

### Rationale

Plan §7.2 on the `event-covers` bucket says "private." That means a signed URL is the only safe way to render in-browser. But covers also convert the list into a visually scannable feed — that's the primary Phase B win. The detail page falls back gracefully, which avoids "did I break something?" moments.

### Effort estimate

90-110 minutes. Most is the card rebuild + layout QA on narrow viewports.

### Priority

**Must-have before Phase B** for the list-view addition. The detail-page fallback is nice-to-have; it's a one-hour polish after the list ships.

---

## Gap 4 — `/events` List Design

### Current state

`app/events/page.tsx` lines 162-177, 236-272, 375-394 render flat `EventCard` components in a 2-column grid (md+). The card layout (lines 423-471) is: optional "Cancelled" preheader, title, optional hosts, date, optional location, optional footer (badge or capacity line). No cover. Going/waitlist counts only show in the Upcoming tab via `CapacityLine`.

Contrast with `/admin/events` page.tsx lines 137-198: a dense table with columns for title, slug, start, status, visibility, going/waitlist, capacity. Much more scannable, but too dense for members.

### Exact files to touch

- `app/events/page.tsx` lines 118-178 (UpcomingTab, rebuild `EventCard` consumption), 180-273 (MyPlansTab), 332-395 (PastTab), 423-471 (EventCard itself).
- `app/events/_components/event-date.tsx` — add a smaller variant or reuse.

### Specific code changes

1. **Restructure `EventCard` as a flexbox column** with a 3:1-aspect cover banner at the top (see Gap 3), then padded content below. Keep the grid at 2 cols on md+, but now each card is visually richer.
2. **Add a "going X · waitlisted Y" inline badge row below the date.** Already computed in the view. For Upcoming tab, pull `going_count` and `waitlisted_count` from the fetched row; pass to `EventCard` via a `counts: {going: number, waitlisted: number, capacity: number | null, waitlistEnabled: boolean}` prop. Render using a dedicated sub-component `<CapacityBadge counts={counts} />` that outputs small pills: `X going` (primary tone), `· full` or `· N waitlisted` in muted tone when applicable.
3. **Stronger RSVP state visualization in My Plans.** Today, the only difference between "Going" and "Invited" rows is a tiny badge. Instead:
   - "Going" rows: left border accent (`border-l-4 border-l-primary`) + filled primary-tone badge.
   - "Waitlisted" rows: amber left border + amber badge + "#N on waitlist" in the card body.
   - "Invited (no response)" rows: muted left border + "Invited" badge + a ghost "RSVP" button on the card.
4. **Location with icon.** Tiny `MapPin` from `lucide-react` (already in deps per package.json line 24) at `size={12}` beside `ev.location_text`. Same for date — `CalendarDays` icon for a visual anchor. Both nest left of their text with `flex items-center gap-1.5`.
5. **Status strip for edge states.** When `status === 'cancelled'`, overlay a `bg-destructive/10` horizontal strip across the cover banner rather than a small preheader — hard to miss. For private-invite events visible to invitees, show a subtle "Invite only" hairline badge in the corner of the cover.
6. **Responsive tweak.** On small viewports, cards stack full-width. Today they already do via the `md:grid-cols-2`. Confirm the banner aspect doesn't dominate at `w < 400px` — cap banner height at `max-h-40`.

### Rationale

Plan §11.2 prescribes "tabs: Upcoming, My Plans, Past" but gives latitude on presentation. The admin table shows counts because admins are ops-focused; members want "is this full, should I RSVP right now, where is it." Accent borders for RSVP state read like Google Calendar event chips — familiar and glanceable. Icons make a card feel like an event, not a todo row.

### Effort estimate

120-150 minutes. Most of it is polishing the banner at multiple viewports.

### Priority

**Must-have before Phase B.** The list is the first screen after the dashboard. A row of text-only cards feels like a spreadsheet.

---

## Gap 5 — Private-Invite Event Discovery

### Current state

`app/events/page.tsx` lines 180-273 (MyPlansTab). Pending invites are loaded via `loadInvitedPending` at lines 275-330. Verification of the data flow:

- Line 283-287: queries `event_invites` with inner-join on events, filters to non-revoked. RLS policy `event_invites_select_own` at `20260423000200_event_rsvps_invites.sql` line 51-54 allows members to read their own non-revoked invite rows.
- Line 317: filters to `published` events, drops past events (`starts_at < nowIso`).
- Line 222-224: de-dupes against history (members who already RSVP'd won't double-appear).
- Line 259-270: renders pending invites with `<Badge tone="muted">Invited</Badge>`.

**This logic works as spec'd** (plan Q3 "invited members land in My Plans with Invited badge" → ✓). Evidence: the test path in `app/events/page.tsx` only filters to non-revoked; the pending invite has a revoked_at of null on creation; the card with `"Invited"` badge renders.

### Real gaps

1. **No CTA on the invite card.** Members see "Invited" and a card, but there's no "RSVP" button — they must click through to the detail page to respond. That's one extra click of friction for the privileged invite flow.
2. **No "Declined invite" visibility.** A member who declines an invite loses all visibility of it. If they change their mind, they can't find the event unless the admin re-invites (which rotates `invited_at`). Spec §7.2 says `declined` is a terminal state per user decision, so this may be intentional — but there's no UX note on it.
3. **No email trigger on invite.** Outside the scope of this polish doc; leave to follow-up.
4. **"Invited" badge looks identical to "Waitlisted" badge at first glance.** Both are muted/amber-ish. Distinguish visually.

### Exact files to touch

- `app/events/page.tsx` lines 259-270 (invite card render), lines 495-518 (Badge component tone addition).

### Specific code changes

1. **Add a quick-RSVP button on pending invite cards.** Rebuild the card for `pendingInvites` to show "RSVP to invite" as a small primary button. Clicking it doesn't need a new page — reuse the existing `RsvpPanel` semantics via `rsvpToEvent` server action (line 42 of `rsvp-panel.tsx`). But the card must not become a client component; the button links to `/events/[slug]#rsvp` with the page scrolling to the RsvpPanel.
2. **Add an anchor `id="rsvp"` to the RsvpPanel** at `app/events/[slug]/_components/rsvp-panel.tsx` line 70 so the deep link works.
3. **Distinguish "Invited" badge.** Change the tone in line 268 from `"muted"` to a new tone `"invite"` (indigo or purple) added to the `Badge` component — `bg-indigo-500/15 text-indigo-700 dark:text-indigo-400`. Reads as "special case, not a passive state."
4. **Add a "From [invited_by preferred name]" line if we extend `loadInvitedPending`.** `invited_by` is a column on `event_invites` but we don't expose it today. The plan's privacy rules (§8.1 "no peer names" in R1) may argue against this. **Defer this one** — not worth the privacy-review delta.
5. **Order invites before history rows.** Today the grid interleaves in fetch order. Invites should bubble to the top of My Plans so members see what needs a response first.

### Rationale

Plan Q3 explicitly flagged this as an open question. The implementation landed on "My Plans with badge," but the UX doesn't make the badge actionable. Since every invite strictly requires a response or it rots, surface the action.

### Effort estimate

50 minutes.

### Priority

**Must-have before Phase B if any pilot event uses `visibility = 'private_invite'`.** The pilot runbook (`docs/12-events-pilot-runbook.md`) doesn't explicitly mandate a private-invite test, but R1 supports it and officers will stumble onto it. Reclassify as nice-to-have if Phase B only uses `members` visibility.

---

## Gap 6 — Empty State Copy

### Current state

`app/events/page.tsx` lines 520-543 define a shared `EmptyState` component with optional CTA. Usage:

- Upcoming tab line 154-159: "Nothing scheduled — yet" + body, no CTA.
- My Plans tab line 227-233: "No upcoming plans" + body + CTA to browse.
- Past tab line 367-372: "No past events" + body, no CTA.

The shape is already good. What's weak is the copy tone and the lack of visual anchoring.

### Exact files to touch

- `app/events/page.tsx` lines 520-543 (EmptyState component), 154-159, 227-233, 367-372 (usages).

### Specific code changes

1. **Upgrade EmptyState visually.** Add a decorative icon slot at the top (default: `CalendarDays` from lucide-react, but accept an icon prop). 48px rounded-full muted background circle with the icon at `size={20}`. The `rounded-md border border-dashed p-8 text-center` stays; add the icon above the title with `mb-4`.
2. **Rewrite Upcoming empty state.**
   ```
   title: "Nothing scheduled yet"
   body: "Officers publish events here. Check back, or subscribe to updates from your dashboard."
   icon: CalendarDays
   cta: undefined (nothing for the user to do)
   ```
3. **Rewrite My Plans empty state.** (Already has a CTA — improve copy.)
   ```
   title: "You haven't RSVP'd to anything yet"
   body: "When you RSVP or get invited, it'll show up here so you don't miss it."
   cta: { href: "/events?tab=upcoming", label: "Browse upcoming events" }
   icon: CalendarPlus
   ```
4. **Rewrite Past empty state.**
   ```
   title: "No event history yet"
   body: "Events you attend will appear here after they end."
   cta: { href: "/events?tab=upcoming", label: "See what's coming up" }
   icon: History
   ```
5. **Dashboard UpcomingEventsCard empty state** (Gap 1 overlap). Today line 244-254 just has a muted paragraph. Upgrade to the same `EmptyState` pattern but compact — half height, no icon, keep the inline "Browse events" link.

### Rationale

Empty states are the moment where a user either bounces or understands the surface. Adding an icon + CTA moves the emotional read from "is this broken?" to "ok, here's what to do." Every adjacent product (Notion, Linear, Figma) does this. The cost is ~15 lines of React.

### Effort estimate

40 minutes.

### Priority

**Must-have before Phase B.** Members without plans will hit empty tabs on first visit — the runbook Phase B has them landing on `/events` specifically.

---

## Gap 7 — Member RSVP Panel UX

### Current state

`app/events/[slug]/_components/rsvp-panel.tsx` — 268 lines. Handles all four states (null, going, waitlisted, declined/cancelled). Key observations:

- **Waitlist position copy (line 163-168):** shows "#N" when available but the context "— you're #3" reads ambiguously. Is that 3 ahead or 3rd in line? Needs a clearer format.
- **Cancel RSVP affordance (line 99-112, going path):** shows two buttons — "Change to Declined" (outline) and "Cancel RSVP" (ghost). Both mean "I'm not going" from a member's perspective but map to different DB states. Members can't tell them apart; spec-wise, declined is "I was asked and I pass," cancelled is "I was in, I pulled out."
- **Going → Waitlisted transition:** not handled. If a member is `going` but others promoted-waitlist past capacity, the DB would prevent over-capacity from the next RSVP attempt. But an already-going member never gets bumped in R1 (plan D4: manual promotion only). So this is technically fine — the bug wasn't real. Clarify copy instead.
- **No transition copy on going / capacityReached change mid-session.** If someone loads the page while the event has 1 slot left and someone else claims it before they click "I'm going," the server action will return "This event is full" (via `mapPgError` in `lib/actions/events.ts`). The panel correctly surfaces the error. But the button still says "I'm going" not "Join waitlist" — `capacityReached` is computed from stale server-render data.

### Exact files to touch

- `app/events/[slug]/_components/rsvp-panel.tsx` lines 99-124 (button copy & two-button confusion), 149-180 (`CurrentStateLine` copy), 39-58 (submit refresh behavior).

### Specific code changes

1. **Collapse "Change to Declined" and "Cancel RSVP" into one button for going state.** Both are rare (most users just show up or forget). Use `"I can't make it"` (outline) calling `submit("cancelled")`. The `declined` state only matters for invite-flow completeness (declining an invite you never RSVP'd going to); on the going path, `cancelled` is the right semantic. Keep `declined` as an explicit action on the initial no-response form (line 220-229 already does this correctly as "Not going").
2. **Rewrite waitlist position copy.** Line 161-168, change to:
   ```
   "You're on the waitlist — position #N. We'll email if a spot opens."
   ```
   If position is null (pre-refresh race), fall back to "You're on the waitlist — hang tight, we'll email if a spot opens." Never mention "manual promotion only" — members don't need to know the ops model.
3. **Refresh state after transition to waitlisted.** Line 51-54 already router.refreshes but the client-side `current.waitlistPosition` is set to `null`. After refresh, the server component re-renders with the real position but this component's `useState` ignores it on subsequent renders. Fix: pass `initial` as a key reset via `key={JSON.stringify(initial)}` on the panel, OR accept `initial` on every re-render and sync via `useEffect`. Simplest: rekey the component from the parent.
4. **Add disambiguation for full+waitlist-off case.** Line 230-234: "This event is full" is fine but cold. Change to: "This event is full and the waitlist is closed. Officers may reopen if capacity changes." Less sterile.
5. **Show capacity fill progress.** Small progress bar under "Your RSVP" header: `{goingCount}/{capacity}` as a w-full h-1 muted bar with primary fill. Skip for uncapped events. Purely ambient — gives members intuition about how tight this is.
6. **Disable double-click on transitions.** `pending` already disables the buttons. Also disable the textarea on `pending` (line 213 does this). Confirmed good.

### Rationale

Plan §11.2 member UX: "RSVP area." MVP-level RSVP works, but the decline/cancel confusion wastes user attention. Plan Q4 explicitly asked "should waitlist position be shown in R1?" — the code already does. Improve the copy so the answer is uncontroversially yes.

### Effort estimate

75 minutes.

### Priority

**Must-have before Phase B.** This is the single most-used interaction on the surface.

---

## Gap 8 — Check-in Page Layout

### Current state

`app/events/[slug]/check-in/page.tsx` lines 32-57 already shows event title, date, and a small instruction line. That's better than the gap title implied. Remaining issues:

- **After success, the page redirects to `/events/[slug]/check-in/success`** (line 44 of `check-in-form.tsx`, success page at `app/events/[slug]/check-in/success/page.tsx`). The success page is clean but isolated — it shows no event context beyond title. Could add the checked-in timestamp.
- **No "you're already checked in" handling on the form page.** If a member revisits `/events/[slug]/check-in` after checking in, they'd enter the code again and get a server error ("already checked in" per `mapPgError` in `lib/actions/events.ts` line 78). The page should short-circuit: show the success state directly.
- **No "other admins/officers who checked in" signal.** Plan §8.1 says "no attendee lists in R1, no peer names in R1." But the plan also says `event_hosts.display_name` is explicit public content (plan §5.3, §8.1 "if host identity is shown, it comes from the explicit host-display model"). Showing hosts who've checked in is a gray area: hosts opt-in by being named. Safer to show hosts on the check-in page **regardless of their attendance** — a reassuring "These are the Progsu officers running this event" card — not "X checked in Y minutes ago."
- **No code input UX polish.** `autoCapitalize="characters"` is set (line 61 of check-in-form.tsx), good. But the input is small and doesn't suggest "this is a short code, like 6 chars." No `text-xl font-mono tracking-widest` styling.

### Exact files to touch

- `app/events/[slug]/check-in/page.tsx` lines 17-25 (fetch attendance state), lines 30-57 (render branches).
- `app/events/[slug]/check-in/check-in-form.tsx` line 50-65 (code input styling).
- `app/events/[slug]/check-in/success/page.tsx` lines 17-45 (expand success state).

### Specific code changes

1. **Short-circuit on already-checked-in.** In the server component at `page.tsx`:
   ```
   const { data: attendance } = await supabase
     .from("event_attendances")
     .select("checked_in_at, method")
     .eq("event_id", event.id).eq("user_id", user.id).maybeSingle();
   if (attendance) render the success UI inline, with a "Back to event" button.
   ```
   This replaces the form entirely for checked-in members.
2. **Add hosts card to both check-in and success pages.** Fetch `event_hosts.display_name` via the admin client (no — use invoker client, hosts are not RLS-restricted for members). Render "Hosted by: Alex · Priya · Jonah" below the event title. Safe per §5.3: host display names are event content, not auth actors.
3. **Beef up the code input.** `check-in-form.tsx` line 53-65, add `className="text-xl font-mono tracking-widest text-center uppercase"` — suggests "this is a 6-char code" typography.
4. **Expand the success page.** After attending:
   ```
   <h1>You're checked in to {title}</h1>
   <p>Checked in at {attendance.checked_in_at formatted}</p>
   ```
   Show the hosts card. Show location if the event is still ongoing (and `ends_at > now`). Adds zero privacy surface — all this is already on the event detail page.
5. **Auto-redirect to success after success.** Already done via `router.push` at line 44. Verify it carries the check-in method param or add a simple `?success=1` query to give the success page one source of truth about what just happened.

### Rationale

Plan §11.2: "check-in CTA during the valid event window." The MVP input works but feels transactional. Hosts card converts "lonely form" into "event context." Short-circuit avoids the 400 error on double-submission.

### Effort estimate

80 minutes.

### Priority

**Must-have before Phase B.** Phase B explicitly tests self-check-in with a real code at a real event (`docs/12-events-pilot-runbook.md` Phase B3). The MVP form is functional but if it errors on a re-load, members will message officers mid-event.

---

## Ordered Implementation Sequence

Execute in this order. Each step is a standalone PR — merge and deploy between steps so rollback is surgical.

1. **Extract `lib/events/cover-url.ts`** (20 min). Pure refactor, no behavior change. Zero risk. Unblocks Gap 1 and Gap 3.
2. **Gap 6 — Empty States** (40 min). Lowest risk visual improvement; entire output is inside a dashed-border box. Can ship first to build confidence.
3. **Gap 2 — Markdown Rendering** (90 min). Adds a dependency; isolated to one component. Smoke the allow-list against `# h1`, `[link](url)`, `**bold**`, raw `https://…`. Verify admin still writes raw markdown fine.
4. **Gap 4 — List Card Redesign + Gap 3 — Covers in List** (150+110 = 260 min). Do together — rebuilding the card means touching cover wiring. Deploy before Gap 1 so the dashboard pattern matches the list.
5. **Gap 1 — Dashboard Card Upgrade** (100 min). Now the `resolveCoverUrl` helper exists and the visual language matches the list.
6. **Gap 7 — RSVP Panel Polish** (75 min). Client-island change; isolated.
7. **Gap 8 — Check-in Page Layout** (80 min). Shipped last because Phase B's check-in testing is the last thing officers do.
8. **Gap 5 — Invite Card CTA + Badge Tone** (50 min). Can ship any time; low risk. If Phase B doesn't use private-invite, defer to R1 GA retrospect.

**Hard ordering constraint:** step 1 must precede steps 3, 4, 5 (they all consume `resolveCoverUrl`). Everything else is independently shippable.

---

## Total Effort Estimate

| Gap | Minutes |
|---|---|
| 0 (cover-url extract) | 20 |
| 1 (dashboard card) | 100 |
| 2 (markdown) | 90 |
| 3 (covers in list) | 110 |
| 4 (list redesign) | 150 |
| 5 (invite CTA) | 50 |
| 6 (empty states) | 40 |
| 7 (RSVP panel) | 75 |
| 8 (check-in page) | 80 |
| **Total** | **~715 min ≈ 12 hours of focused work** |

Budget 14-16 hours calendar time accounting for review + viewport QA + smoke pass. Fits in a two-day window for one engineer before Phase B announcement.

---

## Out of Scope (intentionally deferred)

- Real-time attendee count updates via Supabase Realtime (would need channels on `event_rsvps`; possible later but not for polish).
- Markdown rendering in admin preview (the admin detail-tab can show a "Preview" toggle post-R1).
- Email templates visual polish (separate workstream in `lib/email/events`).
- Invite declined-recovery flow (privacy question; defer to R2 discussion).
- Shared-events count badge on past events (R3 territory).
- ~~QR code display for check-in (plan §4 non-goal #10)~~ — reopened as plan §7.5/D12, 2026-08-16. Tracked in `docs/09-events-platform-plan.md`, not this polish doc, since it's schema + RPC work, not UI polish.
