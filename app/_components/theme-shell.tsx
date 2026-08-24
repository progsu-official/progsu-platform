"use client";

import { createContext, useContext, useState } from "react";

import { setThemePreference } from "@/lib/actions/theme";

// Wraps every member surface and owns the .dark class. The server resolves the
// initial value from the cookie so the first paint is already correct; this
// component exists so the menu toggle can flip themes instantly instead of
// waiting on a server round-trip.
//
// Type is declared here rather than imported from lib/theme so nothing pulls a
// next/headers module into the client graph.
type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeShell>");
  }
  return ctx;
}

export function ThemeShell({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  function setTheme(next: Theme) {
    setThemeState(next);
    // Fire-and-forget: the class already flipped, and a failed cookie write
    // costs the user their preference on next load, not this render.
    void setThemePreference(next);
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
      }}
    >
      <div
        className={`${theme === "dark" ? "dark " : ""}relative min-h-screen overflow-x-hidden bg-background text-foreground`}
      >
        {/* Gives the glass surfaces something to refract. Without it, a
            translucent card over a flat background just reads as a lighter
            card. */}
        <div aria-hidden className="ambient-field" />
        <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
      </div>
    </ThemeContext.Provider>
  );
}
