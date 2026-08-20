"use server";

import "server-only";

import { cookies } from "next/headers";

import { ok, err, type ActionResult } from "@/lib/actions/result";
import { THEME_COOKIE, isTheme, type Theme } from "@/lib/theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Persists the member-surface theme. The client flips the class optimistically
// and calls this to make the choice survive a reload, so there's nothing to
// revalidate — re-rendering the tree here would only undo the instant switch.
export async function setThemePreference(
  theme: Theme
): Promise<ActionResult<{ theme: Theme }>> {
  if (!isTheme(theme)) {
    return err("INVALID_INPUT", "Unknown theme.");
  }

  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  return ok({ theme });
}
