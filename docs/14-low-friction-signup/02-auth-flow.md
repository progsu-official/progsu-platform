# 14.02 — Auth + Onboarding Flow

Owner: Onboarding refactor lead
Last revised: 2026-04-24
Status: Planning.

---

## 1. New minimal signup flow (fresh user)

```
Google OAuth
  └─> /auth/callback
        └─> handle_new_user() trigger creates profiles row with google_email, first_name, last_name, avatar_url
              └─> nextOnboardingStep() resolves to: profile
                    └─> /onboarding/profile            <-- minimal form: first/last/phone/major
                          └─> nextOnboardingStep() → verify-email
                                └─> /onboarding/verify-email (soft step)  <-- writes profiles.school on success
                                      └─> nextOnboardingStep() → consent
                                            └─> /onboarding/consent       <-- 3 required consents
                                                  └─> /profile          <-- ring shown, recruiter gate evaluated
```

Note: step order in the funnel is `profile → verify-email (soft) → consent`. The step indicator currently shows all four including resume; resume is no longer in the redirect chain (unchanged from `20260426000200`). The profile step moves in front of verify-email because:
1. The new profile form doesn't need `school` anymore — verify-email will set it.
2. Completing profile fields first gets the user past the "will this take forever" anxiety before the OTP step.
3. It mirrors what we already do for admins (who skip the whole funnel but would logically fill profile before identity if they didn't).

If owner disagrees with the reorder, leaving verify-email first also works — verify-email still writes `school` the same way; the new profile form just won't pre-select a school (user can leave it null and the ring will nudge them later). **Recommendation: reorder to profile-first.** Fewer fields visible before we ask for the OTP = less cognitive load.

---

## 2. The new minimal profile form

File: `app/onboarding/profile/profile-form.tsx` (rewritten; not new).

Visible fields:

| Field | Control | Required? | Notes |
|---|---|---|---|
| `first_name` | text input | yes | Prefilled from Google. |
| `last_name` | text input | yes | Prefilled from Google. |
| `phone_number` | tel input | yes | Unchanged validation (`^\+?[0-9\-\(\) ]{7,20}$`). |
| `major` | select dropdown | yes | Options fetched from `majors` where `is_active = true`, sorted by `sort_order`. |
| `major_other_text` | text input | yes *when `major = 'other'`* | Hidden by default, appears when dropdown hits "Other". Max 100 chars. |

**Removed from this form** (moved to `/profile/settings` profile section):
- `preferred_name`
- `school` (auto-populated by verify-email)
- `minor`
- `class_standing`
- `grad_year`
- `grad_term`
- `interested_roles`
- `linkedin_url`, `github_url`, `portfolio_url`

The removed fields are not deleted from `profiles`; they become "later" in the ring. `updateProfile` server action still accepts them all — it's called from settings too.

### Validation at the trust boundary

`lib/actions/profile-schemas.ts` grows a stricter `minimalSignupProfileSchema` used only by the onboarding profile form:

```ts
minimalSignupProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName:  z.string().trim().min(1).max(100),
  phoneNumber: z.string().trim().regex(/^\+?[0-9\-\(\) ]{7,20}$/),
  major: z.string().trim().min(1).max(100),     // server-side checked against majors.slug
  majorOtherText: z.string().trim().min(1).max(100).nullable().optional(),
}).refine(
  (v) => v.major !== "other" || (v.majorOtherText && v.majorOtherText.trim().length > 0),
  { message: "Tell us your major", path: ["majorOtherText"] }
);
```

The major-slug allow-list is fetched inside `updateProfile` at call time (not baked into the zod schema literal) so admins can add majors without a redeploy. Zod validates shape; the server action validates membership. If the slug isn't in `majors` at call time, return `{ok:false, error:{code:'INVALID_INPUT', field:'major', message:'Pick a major from the list'}}`.

### Server action: `updateProfile` handling of the new shape

- If the caller sends `major` AND the slug exists in `majors`, write `major = slug`, `major_other_text = null`.
- If the caller sends `major = 'other'` with `majorOtherText`, write `major = 'other'`, `major_other_text = trimmed value`.
- If the caller sends a legacy free-text `major` that isn't a slug (because they're an existing user editing from settings), reject with `INVALID_INPUT` — settings UI will show the dropdown the same way as onboarding.
- Nothing else in `updateProfile` changes.

---

## 3. Verify-email step changes

File: `lib/actions/verification.ts#verifyStudentEmailCode`.

The change is **one line in the existing transaction** (see `01-schema-changes.md` §1 for the SQL). Behavior:
- On successful OTP match, in addition to the existing `UPDATE profiles SET student_email_verified=true, ...`, also set `school = (school_name from school_domains where domain = <verified domain> and is_active)`.
- If `school_domains` has no matching active row, leave `school` unchanged (coalesce).
- If `school` was previously set by the user in settings and they now verify a new email from a different school, `school` is overwritten with the new school_name. This is documented behavior; users can edit it back in settings.

Copy update on `/onboarding/verify-email`: the existing subtitle ("Verification isn't required to save your profile…") stays valid since verify-email is still a soft step. Add one line: "Verifying also sets your school on your profile automatically — you can edit it in settings."

### Layout `StepIndicator`

File: `app/onboarding/_components/step-indicator.tsx`. Needs a label/order swap so the visual steps read `Profile → Verify email → Consent` (with Resume still shown grayed out as a later step). The step keys in `OnboardingStep` type (`"verify-email" | "profile" | "resume" | "consent"`) don't change — only the visual order.

---

## 4. Consent step

Unchanged. `/onboarding/consent` continues to collect the three required consents at their current versions. No privacy-policy bump in this refactor (see `00-overview.md` §4).

---

## 5. After the funnel: `/profile`

On a fresh user's first dashboard load:

- `fullyOnboarded = true` (profile has name/phone/major + consents accepted; school was written by verify-email).
- Profile-completion ring shows something like 4/10 (they have first/last/major, and verify-email gave them school and student_email_verified counts if we count it, but 4/10 is the ballpark for a user who went through only the minimum).
- A "Complete your profile" card is the top CTA, with the first 1-2 ring nudges inline.
- Event listings, member cards, etc. are unchanged in behavior.

See `03-profile-completion-ring.md` for the ring details.

---

## 6. Backward-compatibility notes for existing users

- Returning user with the old completed profile has all 10 fields set → ring = 10/10, nothing changes.
- Returning user who filled the old-gate profile but never uploaded a resume → ring = 9/10, recruiter eligibility unchanged (still gated by resume).
- Returning user mid-funnel before this ships: they are on the OLD fields, so `is_fully_onboarded()` will return true the moment they finish the NEW minimum (since the new gate is a subset of the old). They'll get kicked forward to `/profile` and see a high ring count.

No data migrations required. No downtime.
