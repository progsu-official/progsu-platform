"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { adminGetSignedResumeUrl } from "@/lib/actions/admin";

type Resume = {
  id: string;
  file_name: string;
  file_size: number;
  status: string;
  is_current: boolean;
  uploaded_at: string;
  deleted_at: string | null;
};

export function ResumeHistory({ resumes }: { resumes: Resume[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(resumeId: string) {
    setError(null);
    startTransition(async () => {
      const r = await adminGetSignedResumeUrl({ resumeId });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      if (typeof window !== "undefined") {
        window.open(r.data.url, "_blank", "noopener,noreferrer");
      }
    });
  }

  if (resumes.length === 0) {
    return <p className="text-sm text-muted-foreground">No resumes uploaded.</p>;
  }

  return (
    <div className="space-y-2">
      {resumes.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium" title={r.file_name}>
              {r.file_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {(r.file_size / 1024).toFixed(0)} KB ·{" "}
              {new Date(r.uploaded_at).toLocaleDateString()} · {r.status}
              {r.is_current ? " · current" : ""}
              {r.deleted_at ? " · deleted" : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => open(r.id)}
            disabled={pending || r.status === "deleted"}
          >
            {pending ? "Opening…" : "View"}
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
