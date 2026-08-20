# R2 Member Card Projection — Implementation Spec

Version: R2-spec-v1
Author: R2 planning synth (2026-04-22)
Status: Proposed — awaits owner sign-off on §16 Q6 (recommended: separate setting) and the open questions at the end
Canon this builds on: `docs/09-events-platform-plan.md` §3.2, §5, §6, §8.2, §8.4, §9.4, §10.5, §11.3, §13, §14.3, §15
Prerequisite release: R1 (events core) must be landed and in GA before R2 starts.

## 0. Scope and non-schema prerequisites

R2 introduces **opt-in peer-visible member cards** without touching `profiles`. It gates everything behind two independent switches: the `FEATURE_MEMBER_DIRECTORY` kill switch (env) and each member's `profile_visibility_settings.discoverable` opt-in. Both must be on for a card to appear.

### Non-schema prerequisites (per plan §8.4)

These block R2 merge, independent of the migration:

1. **Privacy policy update** — `/privacy` must be revised to describe (a) the new peer-visible projection, (b) the exact allow-list of fields visible to peers, (c) that admins always see member data regardless of visibility, and (d) that audit rows are written on peer views.
2. **Terms update, if counsel deems necessary**.
3. **Re-acceptance flow for the new privacy version** — see §6. Users must have accepted the bumped `privacy_policy` version before `discoverable=true` takes effect.
4. **Owner sign-off on §16 Q6** — this spec recommends **separate setting**. See §9.

If any of 1–4 slip, ship the migration but keep `FEATURE_MEMBER_DIRECTORY=false` in production.

---

## 1. Tables to add

Migration filename: `20260424xxxxxx_member_cards.sql`.

### 1.1 `profile_visibility_settings`

One row per member, 1:1 with `profiles`. Created lazily — absence of a row = `discoverable=false`.

```sql
create table public.profile_visibility_settings (
  user_id                            uuid primary key
                                     references public.profiles(id) on delete cascade,

  discoverable                       boolean not null default false,
  share_attended_events              boolean not null default false,
  share_shared_event_counts          boolean not null default false,  -- reserved for R3

  profile_slug                       text
                                     check (
                                       profile_slug is null
                                       or profile_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
                                     ),

  last_discoverability_change_at     timestamptz,

  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now()
);

comment on table public.profile_visibility_settings is
  'R2: per-member visibility controls for the member-card projection. Lazy-created on first settings write. Never modified directly by clients — use set_profile_visibility() and set_profile_slug().';
```

### 1.2 Indexes and uniqueness

```sql
-- Global slug uniqueness only among discoverable rows.
create unique index profile_visibility_settings_slug_discoverable_idx
  on public.profile_visibility_settings (profile_slug)
  where discoverable = true and profile_slug is not null;

create index profile_visibility_settings_discoverable_idx
  on public.profile_visibility_settings (discoverable)
  where discoverable = true;

create trigger profile_visibility_settings_set_updated_at
  before update on public.profile_visibility_settings
  for each row execute function public.set_updated_at();
```

### 1.3 `display_name_override` — DO NOT ADD

Reuse `profiles.preferred_name` falling back to `profiles.first_name`.

### 1.4 `member_directory_audit` — DO NOT ADD

Reuse `public.audit_log` via `write_audit()`. Actions:
- `member.visibility_changed` — actor = target = self; metadata = `{before, after, privacy_version}`.
- `member.slug_set` — metadata = `{slug, granted, reason}`.
- `member.card_view` — actor = viewer, target = card owner; metadata = `{slug, is_self: false, is_admin}`. Self-views NOT audited.
- `member.card_attended_events_view` — metadata = `{slug, event_count}`.

### 1.5 Feature flag lives in env, not DB

Flag off = 404 at the route layer. Helpers continue to honor `discoverable` regardless, so re-enabling the flag never reintroduces people who opted out.

---

## 2. View: `member_cards` (SECURITY INVOKER)

Sanitized projection. No `auth.uid()` gating in the view itself — gating lives in the helpers.

```sql
create or replace view public.member_cards
with (security_invoker = true)
as
select
  p.id                               as user_id,
  pvs.profile_slug                   as profile_slug,

  coalesce(nullif(trim(p.preferred_name), ''), p.first_name)
                                     as display_name,

  p.avatar_url                       as avatar_url,
  p.school                           as school,
  p.class_standing                   as class_standing,
  p.grad_term                        as grad_term,
  p.grad_year                        as grad_year,
  p.interested_roles                 as interested_roles,
  pvs.share_attended_events          as share_attended_events,
  pvs.last_discoverability_change_at as visible_since

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;
```

### Fields never in this view

`google_email`, `student_email`, `phone_number`, any resume data, consent rows, `student_email_verified(_at)`, `verification_method`, `is_admin`, `is_archived` (used as a filter, not exposed), `open_to_recruiters`, `profile_completed`, `linkedin_url`, `github_url`, `portfolio_url`, `major`, `minor`.

`linkedin_url` / `major` are deliberately deferred to R3 — adding them is a spec amendment with a privacy-policy diff, not just a view edit.

### View is SECURITY INVOKER

Peers should never call `select * from member_cards` directly. All peer reads go through `member_card_for_viewer()` (SECURITY DEFINER). Admin reads work because the existing `profiles_select_admin` policy permits it.

---

## 3. Helpers

All SECURITY DEFINER unless noted; all `set search_path = public`; all `revoke all … from public; grant execute … to authenticated, service_role;`.

### 3.1 `can_view_member_card(viewer_id uuid, target_id uuid) returns boolean`

Returns true iff ALL of:
- `is_fully_onboarded(viewer_id)` is true.
- Target has `profile_visibility_settings.discoverable = true`.
- AND one of:
  - `viewer_id = target_id` (self-view is always allowed once fully onboarded, even if not discoverable — this is preview mode).
  - `is_admin(viewer_id) = true`.
  - Otherwise fall through: any fully onboarded peer can view a discoverable target.

Stable; no audit write.

### 3.2 `member_card_for_viewer(viewer_id uuid, target_slug text) returns setof public.member_cards`

- SECURITY DEFINER, reads past RLS on `profile_visibility_settings` and `profiles`.
- Resolves slug → user_id. If not found or `can_view_member_card` is false: return empty set (the caller renders 404 for both cases, so peers cannot probe slug existence).
- Non-self + non-admin view: writes `member.card_view` audit row.
- Admin view: writes `member.card_view` with `is_admin: true` metadata.
- Self view: no audit write.

No rate-sampling in R2. Add throttle via `consume_rate_limit('member.card_view', actor, 20, 60)` only if volume becomes a problem.

### 3.3 `member_card_attended_events_for_viewer(viewer_id uuid, target_id uuid) returns table(...)`

Gates:
- `can_view_member_card(viewer_id, target_id)` must be true.
- Target has `share_attended_events = true`.

Event filter:
- Exclude `is_sensitive = true`.
- Exclude `visibility = 'private_invite'`.
- Exclude `status = 'draft'`.
- Include `status in ('published', 'cancelled', 'archived')`.
- Only rows from `event_attendances` for `target_id` (attended, not just RSVP'd).

Returned columns: `event_id, event_slug, event_title, starts_at, ends_at, cover_image_path, checked_in_at`.

Writes `member.card_attended_events_view` audit on non-self calls.

### 3.4 `set_profile_visibility(p_payload jsonb) returns void`

Self-only (asserts `auth.uid()` non-null). Payload shape:

```json
{
  "discoverable": bool,
  "share_attended_events": bool,
  "share_shared_event_counts": bool
}
```

Behavior:
1. Require `is_fully_onboarded(auth.uid())`.
2. If flipping `discoverable` false→true: verify latest accepted `privacy_policy` consent version equals current `consent_versions.privacy_policy`. If not, raise `ERR_REACCEPT_PRIVACY`.
3. Load existing row (or default to all-false with no slug).
4. Merge payload keys.
5. If flipping to discoverable and no slug, auto-generate via the §3.5 derivation.
6. Upsert; set `last_discoverability_change_at = now()` if `discoverable` changed.
7. Write `member.visibility_changed` audit with before/after snapshot + `privacy_version`.

### 3.5 `set_profile_slug(p_desired_slug text) returns text`

Self-only. Returns granted slug (may differ on first opt-in if collision forces a suffix).

1. Normalize: `lower(trim(…))`.
2. Validate regex `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`.
3. Load or lazy-create row.
4. If desired = current: no-op.
5. Collision check against other discoverable rows:
   - No collision: claim.
   - Collision + caller not yet discoverable (first opt-in): append 4-char base36 suffix, retry up to 5 times.
   - Collision + caller already discoverable: raise explicit "URL taken" error (no silent suffix).
6. Write `member.slug_set` audit.

Derivation seed on first opt-in: `lower(regexp_replace(coalesce(preferred_name, first_name) || '-' || last_name, '[^a-z0-9]+', '-', 'g'))` trimmed to 40. Fallback if empty: `member-<8-char-base36-of-user_id>`.

---

## 4. RLS on `profile_visibility_settings`

```sql
alter table public.profile_visibility_settings enable row level security;

create policy pvs_select_own
  on public.profile_visibility_settings for select
  to authenticated
  using (auth.uid() = user_id);

create policy pvs_select_admin
  on public.profile_visibility_settings for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy pvs_no_client_insert
  on public.profile_visibility_settings for insert
  to authenticated
  with check (false);

create policy pvs_no_client_update
  on public.profile_visibility_settings for update
  to authenticated
  using (false) with check (false);

create policy pvs_no_client_delete
  on public.profile_visibility_settings for delete
  to authenticated
  using (false);
```

No admin write policy. Force-takedown goes through a future `admin_force_set_profile_visibility` helper — not in R2.

---

## 5. Routes + UX

### 5.1 `/members` directory

- Feature-flagged; flag off → middleware 404.
- Gate: authenticated + fully onboarded (same cascade as `/profile`).
- Uses `list_member_cards(viewer, cursor, limit, search?)` helper (SECURITY DEFINER, sibling to `member_card_for_viewer`).
- Cursor pagination, page size 24, ordered `last_discoverability_change_at desc, user_id`.
- Search: name-prefix only in R2. No school/role filters.
- Empty state: "No members have opted into the directory yet."

### 5.2 `/members/[slug]`

- Feature-flagged. Authenticated + fully onboarded.
- `member_card_for_viewer(auth.uid(), params.slug)`; empty set → `notFound()`.
- If `share_attended_events = true`, also call `member_card_attended_events_for_viewer`.
- If `auth.uid() = card.user_id`, show "Preview mode" banner.
- No OG/social tags that expose private data.

### 5.3 `/profile/settings` new Profile Visibility section

- Toggle: `discoverable` — flipping to true triggers re-acceptance path if privacy version is stale.
- Toggle: `share_attended_events` — no re-acceptance needed.
- Toggle: `share_shared_event_counts` — labeled "Coming soon" (inert in R2).
- Slug input with rename affordance calling `set_profile_slug()`.
- Entire section hidden when flag is off (no disabled ghost).

### 5.4 Re-acceptance client flow

When `set_profile_visibility` returns `ERR_REACCEPT_PRIVACY`, client routes through `/privacy?reaccept=member_directory&return=/profile/settings#visibility` which writes a new `consents` row and redirects back.

---

## 6. Privacy copy + re-acceptance workflow

### 6.1 `/privacy` changes

1. New section: "Member directory and profile visibility" — lists visible fields, admin visibility, audit logging, immediate off-toggle behavior.
2. New section: "Attended events on member cards" — the second opt-in; sensitive and private-invite always excluded.
3. Update the existing "Data Visibility" section to remove "only you and admins" framing.
4. Major version bump `privacy_policy` v1 → v2. (Minor bumps do not trigger re-acceptance.)
5. Effective date.

### 6.2 Re-acceptance gate — reuse `privacy_policy` with version bump

Rationale:
- `consent_type_t` is additive-only; a new value ossifies forever.
- A dedicated `member_directory_visibility` consent type creates a second surface; peer visibility IS a privacy-policy decision.
- The existing `requiredConsentsCurrent` in `lib/auth/onboarding.ts` already handles version drift via onboarding cascade.

Edge case: admins bypass the onboarding cascade. The `set_profile_visibility` helper's re-acceptance check catches admins regardless.

---

## 7. Feature flag wiring

### 7.1 Env

```
FEATURE_MEMBER_DIRECTORY=false
```

In `lib/env.ts`, parse "true" / "1" → true; anything else → false. Optional `NEXT_PUBLIC_FEATURE_MEMBER_DIRECTORY` mirror if UX needs client-side conditional rendering.

### 7.2 Middleware

In `middleware.ts`, after admin check, before member check:

```typescript
if (isMemberDirectoryPath(pathname)) {
  if (!env.FEATURE_MEMBER_DIRECTORY) {
    // 404 rather than redirect — don't leak route existence.
    const url = request.nextUrl.clone();
    url.pathname = "/_not-found";
    return NextResponse.rewrite(url);
  }
  return supabaseResponse;
}
```

Layout at `app/members/layout.tsx` enforces fully-onboarded.

### 7.3 Helper-level flag behavior

Helpers do NOT check the flag. Kill-switch semantic: only edge checks, so re-enabling returns clean data.

`set_profile_visibility` and `set_profile_slug` also skip the flag check — users should be able to prepare opt-outs regardless.

---

## 8. Smoke test: `smoke-member-cards-visibility`

Script: `scripts/smoke-member-cards-visibility.ts`. Pattern matches `scripts/smoke-rls-self-elevate.ts`.

### 8.1 Fixtures

- Admin: `mallory-admin`.
- Members (fully onboarded):
  - `alice-opted-in` — `discoverable=true, share_attended_events=true`.
  - `bob-opted-in-no-events` — `discoverable=true, share_attended_events=false`.
  - `carol-private` — `discoverable=false`.
  - `dave-unonboarded` — `discoverable=true` but missing required profile fields.
- Events: `public-event`, `sensitive-event` (is_sensitive=true), `private-invite-event`, `draft-event`. Alice attended all except draft.

### 8.2 Scenarios

1. Self view own card → 1 row, 0 audit.
2. Peer → opted-in peer → 1 row, 1 `member.card_view` audit.
3. Peer → non-opted-in slug → 0 rows, 0 audit.
4. Peer → unknown slug → 0 rows, 0 audit.
5. Admin → any card → 1 row, audit with `is_admin: true`.
6. Unauthenticated → redirect to login.
7. Flag off → 404 on all /members routes.
8. Attended-events on `carol` (non-discoverable) → 0 rows before share check.
9. Attended-events on `bob` (share off) → 0 rows, no audit.
10. Attended-events on `alice` (share on) → only `public-event` appears; sensitive / private-invite / draft excluded.
11. Direct raw-profile peer reads denied: `phone_number`, `google_email`, `student_email`, `is_admin`, `student_email_verified` all return 0 rows via peer-authenticated client.
12. Direct `profiles` read as peer → 0 rows. `member_cards` direct select works but exposes only whitelisted columns (assert `google_email` doesn't exist on the view).
13. Slug collision on first opt-in → second user gets suffixed slug.
14. Slug rename collision → explicit error, no silent suffix.
15. Visibility flip on with stale privacy version → `ERR_REACCEPT_PRIVACY`; after re-accept → success.
16. Toggle off then on → same slug reused.
17. Admin can read `audit_log` with `action='member.card_view'` → scenarios 2 and 5 present, scenario 1 absent.

---

## 9. Recommendation for §16 Q6 — SEPARATE SETTING

**`share_attended_events` is independent of `discoverable`.**

Three reasons:

1. **Different privacy questions.** `discoverable` answers "can peers find me?" `share_attended_events` answers "can peers see my history once they do?" Coupling creates the flat-privacy trap §8.2 warns against.

2. **Urgent remediation.** If we misclassify a sensitive event, a member needs to hide history without disappearing entirely. Separate toggle = one-click fix; coupled = must go invisible.

3. **R3 parity.** R3 requires mutual opt-in on a **third** setting (`share_shared_event_counts`). Keeping R2's settings orthogonal means R3 slots in cleanly.

---

## 10. Open questions (punted to R2 kickoff)

1. Public avatar upload pipeline (new bucket) vs. reusing `profiles.avatar_url`? Recommend: reuse.
2. School/role filter chips on `/members` in R2 or defer to R3? Recommend: defer.
3. Slug rename cooldown? Recommend: none unless abuse observed.
4. OG/Twitter card meta tags for unauthenticated link previews? Recommend: no in R2.
5. Email notification "someone viewed your profile"? Recommend: no in R2.
6. Admin force-disable helper (`admin_force_set_profile_visibility`)? Recommend: add if support team asks, else defer.

---

## 11. Merge blockers restated with explicit assertions

**A. Visibility tests green.** Every scenario in §8 returns expected. CI runs `smoke-member-cards-visibility` and exits nonzero on failure.

**B. Raw-profile peer reads denied.** For a non-admin peer-authenticated Supabase client, querying the denied-field list against another user's profile row returns 0 rows. Self query returns the row with fields populated (control).

**C. Migration applies cleanly** with `supabase db reset`.

**D. Integration workflow includes R2 smoke** per plan §13.2.

**E. Privacy/terms/reaccept prerequisites** per §0 landed.

---

## 12. Files the next agent will touch

- `supabase/migrations/20260424xxxxxx_member_cards.sql` — new.
- `app/members/layout.tsx`, `app/members/page.tsx`, `app/members/[slug]/page.tsx` — new.
- `app/profile/settings/page.tsx` — add visibility section.
- `app/profile/settings/visibility-settings.tsx` — new component.
- `app/privacy/page.tsx` — copy update + version bump.
- `lib/env.ts` — add `FEATURE_MEMBER_DIRECTORY`.
- `lib/actions/members.ts` — new; wrap helpers in server actions.
- `middleware.ts` — add `/members` path handling.
- `scripts/smoke-member-cards-visibility.ts` — new smoke script.
- `.env.example` — new env var default.
