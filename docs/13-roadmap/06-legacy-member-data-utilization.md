# 06 — Legacy member data: use what's still sitting unused

**Status**: Stub. Not spec'd in implementation detail, captured for future reference.
**Priority**: None assigned. Current claim-backfill (phone_number only) is complete and shipped on its own; nothing here blocks it.
**Deferred from**: Legacy member import (PR #9, 2026-08-19), which imported 1075 real people into `legacy_members` from the master sheet + Luma export. Most of that data isn't used by anything today.

## What's actually in the table vs. what's used

Field completeness across the 1075 imported rows:

| Field | Rows with data |
|---|---|
| Full name | 1075 (100%) |
| First name | 1053 |
| Last name | 1002 |
| Phone number | 759 |
| Campus email | 762 |
| Personal email | 698 |
| SMS interest = yes | 633 |
| SMS interest = no | 396 |
| SMS interest = unknown (never answered) | 46 |

The claim-backfill trigger (`handle_new_user()`, `20260816000200_legacy_claim_backfill.sql`) only reads `phone_number`. Everything else sits there unused once a legacy row gets claimed.

## Ideas, not specced

1. **Surface the SMS-interest signal to admins.** 633 people said yes to something SMS-related in the old data. There's no `profiles` column for it and it must never auto-grant consent (staging data never implies consent, this is load-bearing, not a suggestion), but a simple admin-facing list ("these people expressed interest, might be worth a manual outreach") would use a real signal that's currently invisible. Needs its own read-only surface, not a consent bypass.
2. **Name/email fallback, low value.** Google OAuth already reliably provides first/last name on sign-in, so legacy name data is mostly redundant. Campus/personal email intentionally aren't auto-trusted, campus email verification goes through its own OTP flow by design, silently trusting a legacy value would defeat the point of that flow. Worth revisiting only if a real gap shows up (e.g., Google's name field empty for some provider edge case).
3. **Retroactive backfill for pre-existing accounts.** The claim-backfill trigger only fires on `handle_new_user()`, i.e. brand-new `auth.users` rows. All 192 members who signed up before `legacy_members` existed (April–June 2026) will never get backfilled, the trigger has nothing to check at creation time for them. If that data matters for existing members too, this needs a one-off admin script (not a trigger) that matches existing `profiles` rows against `legacy_members` by email and fills the same way, same "never overwrite" rule.

## Why deferred

Regression + a UI-level smoke test for the current phone-only backfill shipped in PR #10 (2026-08-19), including confirmation the "Welcome back" banner actually renders. None of the three ideas above are needed for that to work correctly, they're pure additions on top.
