import type { SupabaseClient } from "@supabase/supabase-js";

// Profile-completion ring data source (docs/14-low-friction-signup §3).
// Returns a flat 11-slot checklist with recruiter-eligibility threshold = all
// of slots 1..7 satisfied. The rest are polish and must stay
// countsTowardRecruiter:false — that set gates the recruiter CSV export.

export type CompletionSlot = {
  key: string;
  label: string;
  href: string;
  done: boolean;
  countsTowardRecruiter: boolean;
};

export type ProfileCompletion = {
  slots: CompletionSlot[];
  completed: number;
  total: number;
  recruiterEligible: boolean;
  recruiterSlotsDone: number;
  recruiterSlotsTotal: number;
};

type ProfileRow = {
  id: string;
  school: string | null;
  student_email_verified: boolean;
  grad_year: number | null;
  grad_term: string | null;
  class_standing: string | null;
  interested_roles: string[] | null;
  open_to_recruiters: boolean;
  avatar_url: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
};

type ConsentRow = {
  consent_type: string;
  accepted: boolean;
  version: string;
  accepted_at: string;
  id: string;
};

type ConsentVersionRow = { consent_type: string; version: string };

export async function loadProfileCompletion(
  supabase: SupabaseClient,
  userId: string
): Promise<ProfileCompletion> {
  const [{ data: profile }, { data: resume }, { data: consents }, { data: versions }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, school, student_email_verified, grad_year, grad_term, class_standing, interested_roles, open_to_recruiters, avatar_url, linkedin_url, github_url, portfolio_url"
        )
        .eq("id", userId)
        .single<ProfileRow>(),
      supabase
        .from("resumes")
        .select("id")
        .eq("user_id", userId)
        .eq("is_current", true)
        .maybeSingle(),
      supabase
        .from("consents")
        .select("consent_type, accepted, version, accepted_at, id")
        .eq("user_id", userId)
        .eq("consent_type", "recruiter_resume_sharing"),
      supabase
        .from("consent_versions")
        .select("consent_type, version")
        .eq("consent_type", "recruiter_resume_sharing"),
    ]);

  const p = profile;
  const hasResume = Boolean(resume?.id);
  const recruiterConsentOk = recruiterSharingCurrent(
    (consents ?? []) as ConsentRow[],
    (versions ?? []) as ConsentVersionRow[]
  );

  const slots: CompletionSlot[] = [
    {
      key: "resume",
      label: "Upload your resume",
      href: "/profile/settings/resume",
      done: hasResume,
      countsTowardRecruiter: true,
    },
    {
      key: "verify-email",
      label: "Verify your student email",
      href: "/onboarding/verify-email",
      done: !!p?.student_email_verified,
      countsTowardRecruiter: true,
    },
    {
      key: "grad-year",
      label: "Set your graduation year",
      href: "/profile/settings#academic",
      done: p?.grad_year != null,
      countsTowardRecruiter: true,
    },
    {
      key: "class-standing",
      label: "Pick your class standing",
      href: "/profile/settings#academic",
      done: !!p?.class_standing,
      countsTowardRecruiter: true,
    },
    {
      key: "grad-term",
      label: "Set your graduation term",
      href: "/profile/settings#academic",
      done: !!p?.grad_term,
      countsTowardRecruiter: true,
    },
    {
      key: "roles",
      label: "Choose roles you're open to",
      href: "/profile/settings#roles",
      done: (p?.interested_roles ?? []).length > 0,
      countsTowardRecruiter: true,
    },
    {
      key: "recruiter-visibility",
      label: "Turn on recruiter visibility",
      href: "/profile/settings/notifications",
      done: !!p?.open_to_recruiters && recruiterConsentOk,
      countsTowardRecruiter: true,
    },
    {
      key: "photo",
      label: "Add a profile photo",
      href: "/profile/settings#photo",
      done: !!p?.avatar_url,
      countsTowardRecruiter: false,
    },
    {
      key: "linkedin",
      label: "Add your LinkedIn",
      href: "/profile/settings#links",
      done: !!p?.linkedin_url,
      countsTowardRecruiter: false,
    },
    {
      key: "github",
      label: "Add your GitHub",
      href: "/profile/settings#links",
      done: !!p?.github_url,
      countsTowardRecruiter: false,
    },
    {
      key: "portfolio",
      label: "Add your portfolio or website",
      href: "/profile/settings#links",
      done: !!p?.portfolio_url,
      countsTowardRecruiter: false,
    },
  ];

  const completed = slots.filter((s) => s.done).length;
  const recruiterSlots = slots.filter((s) => s.countsTowardRecruiter);
  const recruiterSlotsDone = recruiterSlots.filter((s) => s.done).length;

  return {
    slots,
    completed,
    total: slots.length,
    recruiterEligible: recruiterSlotsDone === recruiterSlots.length,
    recruiterSlotsDone,
    recruiterSlotsTotal: recruiterSlots.length,
  };
}

function recruiterSharingCurrent(
  consents: ConsentRow[],
  versions: ConsentVersionRow[]
): boolean {
  const currentVersion = versions.find(
    (v) => v.consent_type === "recruiter_resume_sharing"
  )?.version;
  if (!currentVersion) return false;
  const sorted = [...consents].sort((a, b) => {
    if (a.accepted_at !== b.accepted_at) {
      return b.accepted_at.localeCompare(a.accepted_at);
    }
    return b.id.localeCompare(a.id);
  });
  const latest = sorted[0];
  return !!latest && latest.accepted === true && latest.version === currentVersion;
}
