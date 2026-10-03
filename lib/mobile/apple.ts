import "server-only";

import { appEncryptionKey, appleSignInConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, signEs256Jwt } from "./crypto";

// Sign in with Apple server calls. Apple requires apps that offer Sign in
// with Apple to revoke the user's grant when they delete their account; that
// needs a refresh token, which only the authorization-code exchange returns.

const APPLE = "https://appleid.apple.com";

function clientSecret(cfg: NonNullable<ReturnType<typeof appleSignInConfig>>): string {
  const now = Math.floor(Date.now() / 1000);
  return signEs256Jwt(
    { kid: cfg.keyId },
    { iss: cfg.teamId, iat: now, exp: now + 300, aud: APPLE, sub: cfg.clientId },
    cfg.privateKey
  );
}

export function appleRevocationConfigured(): boolean {
  return appleSignInConfig() !== null && appEncryptionKey() !== null;
}

export type ExchangeOutcome = "stored" | "no_refresh_token" | "rejected";

export async function exchangeAndStoreAppleCode(userId: string, code: string): Promise<ExchangeOutcome> {
  const cfg = appleSignInConfig();
  const key = appEncryptionKey();
  if (!cfg || !key) throw new Error("apple not configured");

  const res = await fetch(`${APPLE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: clientSecret(cfg),
      code,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 400) return "rejected";
  if (!res.ok) throw new Error(`apple token exchange ${res.status}`);
  const body = (await res.json()) as { refresh_token?: string };
  if (!body.refresh_token) return "no_refresh_token";

  const admin = createAdminClient();
  const { error } = await admin.from("apple_provider_tokens").upsert({
    user_id: userId,
    client_id: cfg.clientId,
    refresh_token_ciphertext: encryptSecret(body.refresh_token, key),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`store apple token: ${error.message}`);
  await admin.rpc("write_audit", {
    p_action: "apple.refresh_token_stored",
    p_actor: userId,
    p_target: userId,
    p_metadata: {},
  });
  return "stored";
}

// Returns "revoked" | "none" (nothing stored) | "skipped" (not configured).
export async function revokeStoredAppleToken(userId: string): Promise<"revoked" | "none" | "skipped"> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("apple_provider_tokens")
    .select("client_id, refresh_token_ciphertext")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`read apple token: ${error.message}`);
  if (!data) return "none";

  const cfg = appleSignInConfig();
  const key = appEncryptionKey();
  if (!cfg || !key) return "skipped";

  const refreshToken = decryptSecret(data.refresh_token_ciphertext as string, key);
  const res = await fetch(`${APPLE}/auth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: data.client_id as string,
      client_secret: clientSecret({ ...cfg, clientId: data.client_id as string }),
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`apple revoke ${res.status}`);
  await admin.from("apple_provider_tokens").delete().eq("user_id", userId);
  return "revoked";
}
