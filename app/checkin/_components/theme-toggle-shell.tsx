"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";

// /checkin has no member ThemeShell — lib/theme.ts explicitly excludes
// fixed-palette surfaces like login/admin from the cookie-backed toggle. This
// is a local, unpersisted toggle just for this page: defaults to dark on
// every load, no cookie, no server round-trip.
export function CheckinThemeShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dark, setDark] = useState(true);

  return (
    <div
      className={`${dark ? "dark " : ""}min-h-screen bg-background text-foreground antialiased`}
    >
      <button
        type="button"
        onClick={() => setDark((d) => !d)}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="fixed right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card text-foreground shadow-sm transition-colors hover:bg-accent/10"
      >
        {dark ? (
          <Moon size={16} strokeWidth={1.75} aria-hidden />
        ) : (
          <Sun size={16} strokeWidth={1.75} aria-hidden />
        )}
      </button>
      {children}
    </div>
  );
}
