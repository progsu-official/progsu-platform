"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { type ActionResult, err, ok } from "./result";

export async function adminPreviewRecruiterExport(): Promise<
  ActionResult<{ total: number }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data, error } = await supabase.rpc("admin_recruiter_eligible_count");
  if (error) {
    if (error.code === "P0001") return err("FORBIDDEN", "Admins only.");
    return err("INTERNAL", error.message);
  }
  return ok({ total: (data as number) ?? 0 });
}
