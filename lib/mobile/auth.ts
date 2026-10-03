import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { loadOnboardingState, type OnboardingState } from "@/lib/auth/onboarding";
import { fail } from "./http";

export type MobileAuth = {
  user: User;
  token: string;
  // Acts as the caller: every query runs under RLS with their JWT.
  supabase: SupabaseClient;
};

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/);
  return m ? m[1] : null;
}

export function userScopedClient(token: string | null): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}

// Verifies with the Auth server (signature, expiry, revocation/sign-out),
// never by decoding locally.
async function verify(token: string): Promise<MobileAuth | null> {
  const supabase = userScopedClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token, supabase };
}

export async function requireUser(req: NextRequest): Promise<MobileAuth> {
  const token = bearer(req);
  if (!token) fail("unauthenticated", "Sign in required.");
  const auth = await verify(token);
  if (!auth) fail("unauthenticated", "Session expired. Sign in again.");
  return auth;
}

// Public routes: a missing bearer is fine, a bad one is still a 401 so the
// app knows to refresh rather than silently showing the signed-out view.
export async function optionalUser(req: NextRequest): Promise<MobileAuth | null> {
  const token = bearer(req);
  if (!token) return null;
  const auth = await verify(token);
  if (!auth) fail("unauthenticated", "Session expired. Sign in again.");
  return auth;
}

export async function requireOnboarded(auth: MobileAuth): Promise<OnboardingState> {
  const state = await loadOnboardingState(auth.supabase, auth.user.id);
  if (!state.fullyOnboarded) fail("not_onboarded", "Finish setting up your profile first.");
  return state;
}

export function anonClient(): SupabaseClient {
  return userScopedClient(null);
}
