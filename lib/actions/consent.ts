"use server";

import "server-only";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { recordConsentsFor } from "@/lib/domain/consents";
import { type ActionResult, err } from "./result";
import type { ConsentType, RecordConsentsInput } from "./consent-schemas";

export async function recordConsents(
  rawInput: RecordConsentsInput
): Promise<ActionResult<{ recorded: ConsentType[] }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  const userAgent = h.get("user-agent") ?? null;
  return recordConsentsFor(supabase, user, rawInput, { ip, userAgent });
}
