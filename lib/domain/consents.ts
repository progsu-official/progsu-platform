import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type ActionResult, err, ok } from "@/lib/actions/result";
import {
  CONSENT_TYPES,
  REQUIRED_CONSENT_TYPES,
  type ConsentType,
  type RecordConsentsInput,
  recordConsentsSchema,
} from "@/lib/actions/consent-schemas";

// Shared by the web server action and POST /api/mobile/v1/me/consents.
// `supabase` must be a client acting as `userId` (cookie session or bearer),
// so the consents insert runs under RLS as that user.
export async function recordConsentsFor(
  supabase: SupabaseClient,
  user: { id: string },
  rawInput: RecordConsentsInput,
  meta: { ip: string | null; userAgent: string | null }
): Promise<ActionResult<{ recorded: ConsentType[] }>> {
  const parsed = recordConsentsSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }
  const { acceptances } = parsed.data;


  // Every required consent must be true.
  for (const t of REQUIRED_CONSENT_TYPES) {
    if (!acceptances[t]) {
      return err(
        "INVALID_INPUT",
        `Please accept ${t.replace(/_/g, " ")} to continue.`,
        { field: t }
      );
    }
  }

  // SMS interlock (reconciliation #15): if they're opting into SMS, require phone.
  if (acceptances.sms_marketing) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", user.id)
      .single();
    const phone = profile?.phone_number ?? "";
    if (!phone || phone.length < 7) {
      return err(
        "INVALID_INPUT",
        "Add a phone number to your profile before opting into SMS updates.",
        { field: "sms_marketing" }
      );
    }
  }

  // Look up current versions.
  const { data: versionRows, error: versionErr } = await supabase
    .from("consent_versions")
    .select("consent_type, version");
  if (versionErr || !versionRows) return err("INTERNAL", "No versions loaded");
  const versions = new Map<string, string>();
  for (const row of versionRows) versions.set(row.consent_type as string, row.version as string);

  const { ip, userAgent } = meta;

  // Build rows — one per consent type the user has an opinion about.
  const rows = CONSENT_TYPES
    .filter((t) => t in acceptances)
    .map((t) => {
      const version = versions.get(t);
      if (!version) throw new Error(`No current version for ${t}`);
      return {
        user_id: user.id,
        consent_type: t,
        accepted: Boolean(acceptances[t]),
        version,
        ip_address: ip,
        user_agent: userAgent,
      };
    });

  const { error: insertErr } = await supabase.from("consents").insert(rows);
  if (insertErr) return err("INTERNAL", insertErr.message);

  // Write a single audit row summarizing what the user accepted.
  await supabase.rpc("write_audit", {
    p_action: "consents_recorded",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: { accepted: acceptances },
  });

  return ok({ recorded: rows.map((r) => r.consent_type as ConsentType) });
}
