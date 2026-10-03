import { anonClient } from "@/lib/mobile/auth";
import { loadGuide, loadActiveEdition } from "@/lib/mobile/hacklanta-guide";
import { fail, json, mobileRoute } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("hacklanta.guide", async ({ requestId }) => {
  const supabase = anonClient();
  const edition = await loadActiveEdition(supabase);
  if (!edition) fail("not_found", "No published Hacklanta guide.");
  return json(await loadGuide(supabase, edition), requestId);
});
