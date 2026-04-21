"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { adminSetManualVerification } from "@/lib/actions/admin";

export function ManualVerifyToggle({
  userId,
  verified,
}: {
  userId: string;
  verified: boolean;
}) {
  const [isVerified, setIsVerified] = useState(verified);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(target: boolean) {
    if (!reason.trim()) {
      setError("Give a reason — this is recorded in the audit log.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await adminSetManualVerification({
        userId,
        verified: target,
        reason: reason.trim(),
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setIsVerified(target);
      setOpen(false);
      setReason("");
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant={isVerified ? "outline" : "default"}
        onClick={() => setOpen((o) => !o)}
      >
        {isVerified ? "Un-verify" : "Manually verify"}
      </Button>
      {open ? (
        <div className="w-80 space-y-2 rounded-md border bg-background p-3 shadow-sm">
          <label className="text-xs text-muted-foreground">
            Reason (required — written to audit log)
          </label>
          <textarea
            className="h-20 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => submit(!isVerified)}
              disabled={pending}
            >
              {pending ? "Saving…" : `Confirm ${isVerified ? "un-verify" : "verify"}`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
