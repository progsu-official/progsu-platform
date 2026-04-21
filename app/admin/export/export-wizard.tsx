"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { adminPreviewRecruiterExport } from "@/lib/actions/export";

export function ExportWizard() {
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setError(null);
    startTransition(async () => {
      const r = await adminPreviewRecruiterExport();
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setCount(r.data.total);
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Eligible now
        </p>
        <p className="mt-1 text-3xl font-semibold">
          {count === null ? (pending ? "…" : "—") : count}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={refresh} disabled={pending}>
          Refresh count
        </Button>
        <Button
          asChild
          disabled={count === null || count === 0}
        >
          <a href="/api/admin/export">Download CSV</a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Downloads audit: each export is recorded with your user ID, the export ID,
        and the row count. Resume URLs inside the CSV expire 15 minutes after
        download.
      </p>
    </div>
  );
}
