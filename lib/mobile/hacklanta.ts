import "server-only";

import { requireHacklantaSource } from "@/lib/env";
import { hacklantaClient } from "@/lib/sms/hacklanta-sync";

// Read-only access to the Hacklanta II project. Every query is keyed to one
// application (by email for the link start, by id for status) and returns
// only that applicant's own data plus first names of their team.

export function hacklantaConfigured(): boolean {
  return Boolean(process.env.HACKLANTA_SUPABASE_URL && process.env.HACKLANTA_SUPABASE_SECRET_KEY);
}

function client() {
  const { url, secretKey } = requireHacklantaSource();
  return hacklantaClient(url, secretKey);
}

export async function findApplicationIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await client()
    .from("applications")
    .select("id")
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(2);
  if (error) throw new Error(`hacklanta lookup: ${error.message}`);
  // Two applications on one email: refuse to guess which one is theirs.
  if (!data || data.length !== 1) return null;
  return String(data[0].id);
}

export type HacklantaApplicationStatus = {
  status: "pending" | "accepted" | "waitlisted" | "rejected";
  attendanceConfirmed: boolean;
  team: { name: string | null; memberFirstNames: string[] } | null;
};

export async function readApplication(applicationId: string): Promise<HacklantaApplicationStatus | null> {
  const hack = client();
  const { data, error } = await hack
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(`hacklanta read: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const status = String(row.review_status ?? "pending");

  // Team shape in the Hacklanta project is not part of the contract we were
  // given; read it defensively and degrade to null rather than guess.
  let team: HacklantaApplicationStatus["team"] = null;
  const teamId = row.team_id;
  if (typeof teamId === "string" && teamId.length > 0) {
    const [{ data: t }, { data: mates }] = await Promise.all([
      hack.from("teams").select("name").eq("id", teamId).maybeSingle(),
      hack.from("applications").select("first_name").eq("team_id", teamId).limit(10),
    ]);
    team = {
      name: (t as { name?: string } | null)?.name ?? null,
      memberFirstNames: ((mates ?? []) as Array<{ first_name?: string }>)
        .map((m) => (m.first_name ?? "").trim())
        .filter((n) => n.length > 0),
    };
  }

  return {
    status: (["pending", "accepted", "waitlisted", "rejected"].includes(status)
      ? status
      : "pending") as HacklantaApplicationStatus["status"],
    attendanceConfirmed: Boolean(row.attendance_confirmed_at),
    team,
  };
}
