import { env, walletConfig, apnsConfig } from "@/lib/env";
import { appleRevocationConfigured } from "@/lib/mobile/apple";
import { anonClient } from "@/lib/mobile/auth";
import { loadActiveEdition, editionSummary } from "@/lib/mobile/hacklanta-guide";
import { json, mobileRoute } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("config", async ({ requestId }) => {
  const edition = await loadActiveEdition(anonClient());
  const minBuild = Number(process.env.MOBILE_MIN_SUPPORTED_BUILD ?? "1");
  return json(
    {
      minSupportedBuild: Number.isInteger(minBuild) && minBuild > 0 ? minBuild : 1,
      features: {
        events: env.FEATURE_EVENTS,
        hacklanta: edition !== null,
        wallet: walletConfig() !== null,
        push: apnsConfig() !== null,
        appleRevocation: appleRevocationConfigured(),
      },
      hacklanta: edition ? editionSummary(edition) : null,
    },
    requestId
  );
});
