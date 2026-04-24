import type { SupabaseClient } from "@supabase/supabase-js";

// Canonical onboarding state contract (docs/07-implementation-plan.md §1.1).
// Derived from the profile row + latest consents + current resume — do NOT gate on
// the legacy `profile_completed` boolean alone.

export type OnboardingStep =
  | "verify-email"
  | "profile"
  | "resume"
  | "consent"
  | null; // null = fully onboarded

export type OnboardingState = {
  userId: string;
  isAdmin: boolean;
  studentEmailVerified: boolean;
  profileFieldsComplete: boolean;
  hasCurrentResume: boolean;
  requiredConsentsCurrent: boolean;
  fullyOnboarded: boolean;
  nextStep: OnboardingStep;
};

// Required profile fields for `profile_fields_complete`. Matches the V0 allow-list
// in docs/07-implementation-plan.md §1.1 minus optional extras (preferred_name, minor,
// linkedin_url, github_url, portfolio_url, phone_number, open_to_recruiters).
const REQUIRED_PROFILE_FIELDS: Array<
  keyof ProfileRow
> = [
  "first_name",
  "last_name",
  "school",
  "major",
  "class_standing",
  "grad_year",
  "grad_term",
];

// Required-to-finish-onboarding consent types per reconciliation #12 + decision D3.
// Age 18+ gate is tracked as its own consent row so it appears in the audit trail
// independently of ToS/Privacy.
const REQUIRED_CONSENTS = [
  "privacy_policy",
  "terms_of_service",
  "age_confirmation",
] as const;

type ProfileRow = {
  id: string;
  is_admin: boolean;
  student_email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  school: string | null;
  major: string | null;
  class_standing: string | null;
  grad_year: number | null;
  grad_term: string | null;
  interested_roles: string[] | null;
};

export async function loadOnboardingState(
  supabase: SupabaseClient,
  userId: string
): Promise<OnboardingState> {
  const [{ data: profile }, { data: resume }, { data: consents }, { data: versions }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, is_admin, student_email_verified, first_name, last_name, school, major, class_standing, grad_year, grad_term, interested_roles"
        )
        .eq("id", userId)
        .single(),
      supabase
        .from("resumes")
        .select("id")
        .eq("user_id", userId)
        .eq("is_current", true)
        .maybeSingle(),
      supabase
        .from("consents")
        .select("consent_type, accepted, version, accepted_at, id")
        .eq("user_id", userId),
      supabase.from("consent_versions").select("consent_type, version"),
    ]);

  if (!profile) {
    // Should not happen — handle_new_user() creates the row on auth insert. Fall
    // through to "start at profile" so the user isn't stuck.
    return {
      userId,
      isAdmin: false,
      studentEmailVerified: false,
      profileFieldsComplete: false,
      hasCurrentResume: false,
      requiredConsentsCurrent: false,
      fullyOnboarded: false,
      nextStep: "profile",
    };
  }

  const p = profile as ProfileRow;
  const profileFieldsComplete =
    REQUIRED_PROFILE_FIELDS.every((f) => {
      const v = p[f];
      if (typeof v === "string") return v.trim().length > 0;
      return v !== null && v !== undefined;
    }) && (p.interested_roles ?? []).length > 0;

  const hasCurrentResume = Boolean(resume?.id);

  const currentVersions = new Map<string, string>();
  for (const row of versions ?? []) {
    currentVersions.set(
      (row as { consent_type: string }).consent_type,
      (row as { version: string }).version
    );
  }

  // Latest row per (consent_type, version) = max (accepted_at, id). We take the newest
  // per type and confirm it's an accepted row at the current version.
  const latestByType = new Map<string, { version: string; accepted: boolean }>();
  for (const raw of consents ?? []) {
    const r = raw as {
      consent_type: string;
      accepted: boolean;
      version: string;
      accepted_at: string;
      id: string;
    };
    const key = r.consent_type;
    const prev = latestByType.get(key);
    if (!prev) {
      latestByType.set(key, { version: r.version, accepted: r.accepted });
    }
    // Iteration order isn't guaranteed ordering by accepted_at — refetch sorted below.
  }

  // Re-run with deterministic sort (accepted_at desc, id desc) since Supabase JS doesn't
  // preserve order guarantees with .select() alone. Cheap — consents are small.
  const sorted = [...(consents ?? [])].sort((a, b) => {
    const ra = a as { accepted_at: string; id: string };
    const rb = b as { accepted_at: string; id: string };
    if (ra.accepted_at !== rb.accepted_at) {
      return rb.accepted_at.localeCompare(ra.accepted_at);
    }
    return rb.id.localeCompare(ra.id);
  });
  latestByType.clear();
  for (const raw of sorted) {
    const r = raw as {
      consent_type: string;
      accepted: boolean;
      version: string;
    };
    if (!latestByType.has(r.consent_type)) {
      latestByType.set(r.consent_type, {
        version: r.version,
        accepted: r.accepted,
      });
    }
  }

  const requiredConsentsCurrent = REQUIRED_CONSENTS.every((type) => {
    const latest = latestByType.get(type);
    const currentVersion = currentVersions.get(type);
    if (!latest || !currentVersion) return false;
    return latest.accepted === true && latest.version === currentVersion;
  });

  // Resume and student email verification are *soft* requirements: users can
  // finish the member funnel without them, but recruiter exports exclude both
  // (enforced separately in public.recruiter_eligible_members, which inner-joins
  // on a current resume and on student_email_verified=true). Profile fields and
  // required consents remain hard gates.
  const fullyOnboarded = profileFieldsComplete && requiredConsentsCurrent;

  // Sequential flow is still "profile → resume → consent", but resume is
  // skippable. If consent is already at current version, the user has reached
  // the final step (either by uploading OR skipping resume), so we don't
  // bounce them back. If consent is missing AND resume is missing, we route
  // to /onboarding/resume so the user at least sees the skip affordance once
  // on their first pass.
  const nextStep: OnboardingStep = !profileFieldsComplete
    ? "profile"
    : !requiredConsentsCurrent
      ? !hasCurrentResume
        ? "resume"
        : "consent"
      : null;

  return {
    userId,
    isAdmin: p.is_admin,
    studentEmailVerified: p.student_email_verified,
    profileFieldsComplete,
    hasCurrentResume,
    requiredConsentsCurrent,
    fullyOnboarded,
    nextStep,
  };
}

export function onboardingPathFor(step: OnboardingStep): string | null {
  if (step === null) return null;
  return `/onboarding/${step}`;
}
