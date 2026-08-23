"use server";

import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import {
  GUEST_CLAIM_COOKIE,
  GUEST_CLAIM_TTL_SECONDS,
} from "@/lib/events/guest-claim";

// Arms the claim link, then the caller sends the browser to Google.
//
// SameSite=Lax rather than Strict — the return leg from Google is a top-level
// cross-site GET navigation, which Strict would not send, and the whole
// mechanism would silently no-op.
export async function stageGuestClaim(rawToken: string): Promise<void> {
  const parsed = z.string().uuid().safeParse(rawToken);
  if (!parsed.success) return;

  const store = await cookies();
  store.set(GUEST_CLAIM_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_CLAIM_TTL_SECONDS,
  });
}
