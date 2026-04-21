"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { type ActionResult, err, ok } from "./result";

const toggleSchema = z.object({ open: z.boolean() });

export async function setOpenToRecruiters(input: {
  open: boolean;
}): Promise<ActionResult<{ open: boolean }>> {
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return err("INVALID_INPUT", "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const { error } = await supabase
    .from("profiles")
    .update({ open_to_recruiters: parsed.data.open })
    .eq("id", user.id);
  if (error) return err("INTERNAL", error.message);

  revalidatePath("/dashboard");
  return ok({ open: parsed.data.open });
}
