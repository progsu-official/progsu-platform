"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { type ActionResult, err, ok } from "./result";
import {
  type MinimalSignupProfileInput,
  type UpdateProfileInput,
  minimalSignupProfileSchema,
  updateProfileSchema,
} from "./profile-schemas";

export async function updateProfile(
  rawInput: UpdateProfileInput
): Promise<ActionResult<{ updated: true }>> {
  const parsed = updateProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const data = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  // Map camelCase input to snake_case columns. RLS enforces self-update + blocks
  // writes to is_admin / student_email_verified / verification_method /
  // is_archived so we don't need to redundantly strip them here.
  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: data.firstName,
      last_name: data.lastName,
      preferred_name: data.preferredName ?? null,
      school: data.school,
      major: data.major,
      minor: data.minor ?? null,
      class_standing: data.classStanding,
      grad_year: data.gradYear,
      grad_term: `${data.gradTerm} ${data.gradYear}`,
      interested_roles: data.interestedRoles,
      linkedin_url: data.linkedinUrl ?? null,
      github_url: data.githubUrl ?? null,
      portfolio_url: data.portfolioUrl ?? null,
      phone_number: data.phoneNumber,
    })
    .eq("id", user.id);

  if (error) {
    return err("INTERNAL", error.message);
  }

  revalidatePath("/onboarding/profile");
  revalidatePath("/dashboard");
  return ok({ updated: true });
}

// Minimal onboarding write (docs/14-low-friction-signup). Validates major
// against the live majors table at call time so admins can add majors without
// a redeploy. When major='other', writes major='other' + major_other_text.
// Everything the old gate used to require (class_standing, grad_year,
// grad_term, interested_roles) is left untouched and lives in the profile-
// completion ring on the dashboard.
export async function updateMinimalProfile(
  rawInput: MinimalSignupProfileInput
): Promise<ActionResult<{ updated: true }>> {
  const parsed = minimalSignupProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const data = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  // Membership check against majors. Free-text slugs not in the table are
  // rejected — the only way to store a custom string is via major='other'
  // + major_other_text.
  const { data: majorRow, error: majorErr } = await supabase
    .from("majors")
    .select("slug")
    .eq("slug", data.major)
    .eq("is_active", true)
    .maybeSingle();
  if (majorErr) return err("INTERNAL", majorErr.message);
  if (!majorRow) {
    return err("INVALID_INPUT", "Pick a major from the list.", {
      field: "major",
    });
  }

  const isOther = data.major === "other";
  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: data.firstName,
      last_name: data.lastName,
      school: data.school,
      phone_number: data.phoneNumber,
      major: data.major,
      major_other_text: isOther ? (data.majorOtherText ?? null) : null,
    })
    .eq("id", user.id);

  if (error) return err("INTERNAL", error.message);

  revalidatePath("/onboarding/profile");
  revalidatePath("/dashboard");
  return ok({ updated: true });
}
