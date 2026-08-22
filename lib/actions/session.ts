"use server";

import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  isPublicEventDetailPath,
  isPublicEventsListPath,
} from "@/lib/events/public-path";
import { isPublicPath } from "@/middleware";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Land back on the page they were on, now in its signed-out view. Only
  // fall back to the landing page if that page has no signed-out view
  // (requires auth) — never bounce to /login, that's an explicit sign-in
  // choice, not a logout side effect.
  const referer = (await headers()).get("referer");
  const pathname = referer ? new URL(referer).pathname : "/";
  const hasSignedOutView =
    isPublicPath(pathname) ||
    isPublicEventDetailPath(pathname) ||
    isPublicEventsListPath(pathname);

  redirect(hasSignedOutView ? pathname : "/");
}
