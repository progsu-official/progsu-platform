"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-3 py-12 text-center">
      <h1 className="text-lg font-semibold">We hit an error loading your dashboard.</h1>
      <p className="text-sm text-muted-foreground">
        Retry usually works. If not, sign out and back in.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <Button onClick={reset} size="sm">Try again</Button>
    </div>
  );
}
