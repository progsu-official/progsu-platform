import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// Return leg of supabase.auth.linkIdentity({ provider: "discord" }) — the
// member is already signed in; this just attaches a Discord identity to
// their existing account (see 20260817000300_discord_identity_link.sql).
// Separate from /auth/callback, which is sign-in only and routes through
// the onboarding cascade; a link has no onboarding to route through.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");
  const origin = env.NEXT_PUBLIC_SITE_URL;
  const settingsUrl = new URL("/dashboard/settings#visibility", origin);

  if (errorParam || !code) {
    settingsUrl.searchParams.set(
      "discord_error",
      errorParam ?? "missing_code"
    );
    return NextResponse.redirect(settingsUrl);
  }

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    settingsUrl.searchParams.set("discord_error", "exchange_failed");
    return NextResponse.redirect(settingsUrl);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const discordIdentity = user?.identities?.find((i) => i.provider === "discord");
  // Supabase normalizes Discord's raw OAuth response into an OIDC-ish shape —
  // there's no top-level `id`/`username`. The real snowflake is provider_id
  // (same value as sub); the cleanest display name is full_name (no #0
  // discriminator, unlike `name`), falling back to custom_claims.global_name.
  const identityData = discordIdentity?.identity_data as
    | {
        provider_id?: string;
        sub?: string;
        full_name?: string;
        name?: string;
        custom_claims?: { global_name?: string };
      }
    | undefined;
  const discordId = identityData?.provider_id ?? identityData?.sub;
  const rawUsername =
    identityData?.full_name ??
    identityData?.custom_claims?.global_name ??
    identityData?.name ??
    "";
  // discord_username has a check constraint (lowercase letters/digits/./_,
  // 2-32 chars) since it used to be hand-typed; global_name in particular can
  // contain spaces/emoji/caps, so sanitize rather than let the update fail.
  const sanitized = rawUsername.toLowerCase().replace(/[^a-z0-9._]/g, "");
  const discordUsername = sanitized.length >= 2 ? sanitized.slice(0, 32) : null;

  if (user && discordId) {
    await supabase
      .from("profiles")
      .update({
        discord_user_id: discordId,
        discord_username: discordUsername,
      })
      .eq("id", user.id);
    settingsUrl.searchParams.set("discord_connected", "1");
  } else {
    settingsUrl.searchParams.set("discord_error", "identity_missing");
  }

  const response = NextResponse.redirect(settingsUrl);
  const store = await cookies();
  for (const c of store.getAll()) {
    response.cookies.set(c.name, c.value);
  }
  return response;
}
