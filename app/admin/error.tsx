"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-3 py-12 text-center">
      <h1 className="text-lg font-semibold">Admin page failed to load.</h1>
      <p className="text-sm text-muted-foreground">
        Check the server logs. The error reference is below.
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
