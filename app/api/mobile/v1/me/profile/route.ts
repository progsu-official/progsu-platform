import { isValidUsPhone, US_PHONE_ERROR } from "@/lib/phone";
import { requireUser } from "@/lib/mobile/auth";
import { updateProfileBody } from "@/lib/mobile/contracts";
import { loadMe } from "@/lib/mobile/data";
import { fail, json, mobileRoute, pgError, readJson } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same field rules as the web onboarding/profile forms: major must be an
// active majors slug, 'other' needs major_other_text, phone is a US number.
// The row update runs under the member's own JWT (profiles_update_own RLS).
export const PATCH = mobileRoute("me.profile", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const body = await readJson(req, updateProfileBody);

  if (body.phoneNumber !== undefined && !isValidUsPhone(body.phoneNumber)) {
    fail("invalid_input", US_PHONE_ERROR, { field: "phoneNumber" });
  }
  if (body.major) {
    const { data } = await auth.supabase
      .from("majors")
      .select("slug")
      .eq("slug", body.major)
      .eq("is_active", true)
      .maybeSingle();
    if (!data) fail("invalid_input", "Pick a major from the list.", { field: "major" });
    if (body.major === "other" && !body.majorOtherText?.trim()) {
      fail("invalid_input", "Tell us your major", { field: "majorOtherText" });
    }
  }

  const blankToNull = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim();
  const patch: Record<string, unknown> = {};
  if (body.firstName !== undefined) patch.first_name = body.firstName;
  if (body.lastName !== undefined) patch.last_name = body.lastName;
  if (body.preferredName !== undefined) patch.preferred_name = blankToNull(body.preferredName);
  if (body.affiliation !== undefined) patch.affiliation = body.affiliation;
  if (body.institutionName !== undefined) patch.institution_name = blankToNull(body.institutionName);
  if (body.school !== undefined) patch.school = blankToNull(body.school);
  if (body.major !== undefined) {
    patch.major = blankToNull(body.major);
    if (body.major !== "other") patch.major_other_text = null;
  }
  if (body.majorOtherText !== undefined && body.major === "other") {
    patch.major_other_text = blankToNull(body.majorOtherText);
  }
  if (body.minor !== undefined) patch.minor = blankToNull(body.minor);
  if (body.phoneNumber !== undefined) patch.phone_number = body.phoneNumber;
  if (Object.keys(patch).length === 0) fail("invalid_input", "Nothing to update.");

  const { error } = await auth.supabase.from("profiles").update(patch).eq("id", auth.user.id);
  if (error) throw pgError(error);
  return json(await loadMe(auth.supabase, auth.user.id), requestId);
});
