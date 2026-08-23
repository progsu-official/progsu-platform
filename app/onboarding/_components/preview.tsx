"use client";

import { createContext, useContext } from "react";

// Lets /dev/screens drive the real funnel components without a session or a
// database behind them.
//
// The alternative was a second set of mock forms, which would have drifted
// from these within a week and made the gallery a liar. Instead each form asks
// whether it is in preview and, if so, skips exactly one thing — the server
// action — and navigates as it otherwise would. Everything else is untouched:
// the same validation, the same transitions, the same reveal animations, the
// same phase swaps.
//
// `null` outside a provider, so production pays a context read and nothing
// else.
export type PreviewValue = {
  // Called with the path the form would normally push. The gallery maps it to
  // its own route so the walkthrough stays inside the walkthrough.
  advance: (onboardingPath: string) => void;
};

const PreviewContext = createContext<PreviewValue | null>(null);

export function usePreview() {
  return useContext(PreviewContext);
}

export function PreviewProvider({
  value,
  children,
}: {
  value: PreviewValue;
  children: React.ReactNode;
}) {
  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}
