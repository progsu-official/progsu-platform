# 14.03 — Profile-Completion Ring

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning.

---

## 1. Field set

The ring counts **exactly the fields a fully recruiter-eligible profile needs**, minus the ones covered by the hard signup gate. Flat 1-per-field weights (no weighting — simple math, explainable to the user).

**Denominator = 10.** Ordered by impact on recruiter visibility, top-to-bottom.

| # | Field | Counts toward ring? | Satisfies recruiter gate? | Source column(s) |
|---|---|---|---|---|
| 1 | Resume uploaded | yes | yes (already gated) | `resumes.is_current AND status='active'` |
| 2 | Verified student email | yes | yes (already gated) | `profiles.student_email_verified` |
| 3 | `grad_year` | yes | **yes (new threshold C)** | `profiles.grad_year` |
| 4 | `class_standing` | yes | **yes (new threshold C)** | `profiles.class_standing` |
| 5 | `grad_term` | yes | **yes (new threshold C)** | `profiles.grad_term` |
| 6 | `interested_roles` non-empty | yes | **yes (new threshold C)** | `cardinality(profiles.interested_roles) > 0` |
| 7 | `open_to_recruiters` + `recruiter_resume_sharing` consent both affirmative | yes | yes (already gated) | `profiles.open_to_recruiters AND latest recruiter_resume_sharing = true` — counted as a single slot |
| 8 | `linkedin_url` | yes | no | `profiles.linkedin_url` |
| 9 | `github_url` | yes | no | `profiles.github_url` |
| 10 | `portfolio_url` | yes | no | `profiles.portfolio_url` |

**Not counted**: `preferred_name`, `minor`, `phone_number` (already in hard gate), `first_name`/`last_name`/`school`/`major` (in hard gate). Adding these to the ring would conflate "you finished signup" with "your profile is discoverable"; the ring's job is the latter.

### Ring states

- `0/10 .. 6/10`: member is NOT recruiter-eligible. Top CTA: "Complete your profile to appear in recruiter searches."
- `7/10`: right at the threshold-C line (items 1–7 all yes). Member IS recruiter-eligible. Top CTA: "Add links to stand out to recruiters" (items 8-10).
- `10/10`: no nudges; ring collapses to a small "Profile complete" badge instead of a card.

The recruiter-eligibility threshold is items **1–7 all present**. Items 8–10 are polish, not gates.

---

## 2. Where the ring lives

Route: `/dashboard` page, top-of-page placement, above the existing events summary card.

Component: `app/dashboard/profile-completion-ring.tsx` (new). Server component that takes `OnboardingState` + a small query for the extra columns (grad_year, linkedin_url, etc.) not already on `OnboardingState`.

Rendering:
- Desktop: horizontal card ~96px tall. Ring (SVG circle, ~72×72) on the left, count "7/10" centered in the ring, a heading + the top 2 nudge lines stacked on the right with a "See all" link when there are more than 2 missing.
- Mobile: ring stacks above the nudge list, same content.
- At 10/10: render a thin `Profile complete` badge row instead of the full card.

Interaction:
- Each nudge line is a `<Link>` to `/dashboard/settings?tab=profile#<anchor>` where anchor maps to the relevant form section. Anchors: `resume`, `verify-email`, `academic`, `roles`, `recruiter`, `links`.
- The ring itself is also clickable (`aria-label="Profile 7 of 10 complete. Open profile settings."`) and goes to `/dashboard/settings?tab=profile`.
- A muted "Why complete it?" text link next to the heading opens a tooltip: "A complete profile helps recruiters and event hosts find you. You control what's shared."

Loading:
- Server-rendered; no client hydration spinner.
- If any of the queries fail, render a minimal "Your profile" card with a "Manage" link instead of the ring. No error toast. The ring is a nudge, not a feature.

---

## 3. Nudge copy (in display order)

Each line ≤ ~45 characters so they fit on mobile. Action-led, subject-first, no emojis.

| Slot | Missing when… | Copy | Link anchor |
|---|---|---|---|
| 1 | No current active resume | "Upload your resume" | `#resume` |
| 2 | `student_email_verified = false` | "Verify your student email" | `#verify-email` |
| 3 | `grad_year is null` | "Set your graduation year" | `#academic` |
| 4 | `class_standing is null` | "Pick your class standing" | `#academic` |
| 5 | `grad_term is null` | "Set your graduation term" | `#academic` |
| 6 | `interested_roles` empty | "Choose roles you're open to" | `#roles` |
| 7 | `open_to_recruiters = false` OR no current `recruiter_resume_sharing` accepted | "Turn on recruiter visibility" | `#recruiter` |
| 8 | No `linkedin_url` | "Add your LinkedIn" | `#links` |
| 9 | No `github_url` | "Add your GitHub" | `#links` |
| 10 | No `portfolio_url` | "Add your portfolio or website" | `#links` |

Slot 7 compresses two booleans (an opt-in flag + a consent row) into one CTA. The settings page explains the distinction; the ring doesn't.

Only the top 2 unfilled slots render inline in the card. The rest live behind a "See all (N)" expander link. Rationale: 8 simultaneously-visible CTAs is visual noise; 2 feels approachable.

---

## 4. Order-by-impact rationale

Items 3–6 (academic fields + interested_roles) are ahead of LinkedIn/GitHub because they're the four we are *newly* making part of the recruiter gate. That's the most consequential ordering call in this doc — we want the user to finish these first so they become recruiter-visible.

LinkedIn/GitHub are last because they don't affect the hard gate; they only beef up the card for recruiters who do see the profile.

Resume is #1 despite already being a soft step because it's the single highest-impact thing a recruiter looks at.

---

## 5. Data plumbing

The ring needs data the current `OnboardingState` does not expose. New helper:

```ts
// lib/auth/profile-completion.ts (new file)
export type ProfileCompletion = {
  slots: Array<{ key: string; label: string; href: string; done: boolean }>;
  completed: number;
  total: number;
  recruiterEligible: boolean; // items 1–7 all done (matches public.recruiter_eligible_members)
};

export async function loadProfileCompletion(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileCompletion> { /* one profile row + one resume row + consent latest-per-type */ }
```

Called from `app/dashboard/page.tsx`. Two extra round-trips is acceptable — `/dashboard` already does several.

No new RPC needed; all reads are already permitted to the caller (own profile, own resumes, own consents).

---

## 6. Settings page anchors

File: `app/dashboard/settings/page.tsx` (existing). Needs a `?tab=profile` tab and in-section anchor targets (`id="resume"`, `id="verify-email"`, `id="academic"`, etc.) so the deep links in the ring land users at the right control.

No change to the settings action surface — `updateProfile` already accepts all these fields. Just UX grouping.

---

## 7. Admin-facing mirror

Admins viewing a member profile at `/admin/members/[id]` should see the same ring (read-only, with an "Incomplete" badge on each missing slot). Helpful for officer coaching: "you're at 6/10 — let me help you finish". This is a small addition, low-risk, and the same `loadProfileCompletion()` helper works with a target user ID.

Component reuse: `<ProfileCompletionRing variant="admin" userId={memberId} />`. Defer implementation to the same PR as the member-facing ring; the admin-facing mirror is additive.
