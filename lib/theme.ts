import "server-only";

import { cookies } from "next/headers";

// Member-surface theme preference. Light is the default; the .dark class is
// applied by ThemeShell when this resolves to "dark".
//
// Stored in a cookie rather than localStorage on purpose: the member layouts
// are server components, so reading it during render lets us emit the right
// class in the initial HTML. localStorage would only be readable after
// hydration, which means a flash of the wrong theme on every navigation.
//
// Admin, login, the landing page, and onboarding are deliberately excluded —
// each is styled for a fixed palette and has no theme control.

export type Theme = "light" | "dark";

export const THEME_COOKIE = "progsu-theme";
export const DEFAULT_THEME: Theme = "light";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export async function readTheme(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}
