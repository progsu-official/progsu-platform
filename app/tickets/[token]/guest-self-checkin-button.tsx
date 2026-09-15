"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { guestSelfCheckIn } from "@/lib/actions/events";

// The self-serve counterpart to "show this at the door and staff will scan
// you in": the token in this page's own URL is already the guest's proof of
// identity (same trust model as the QR itself), so there is no reason to
// make them find a staff member at all if they'd rather just tap a button.
export function GuestSelfCheckInButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await guestSelfCheckIn(token);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="h-11 w-full rounded-full"
      >
        <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />
        {pending ? "Checking you in…" : "Check me in"}
      </Button>
      {error ? (
        <p role="alert" className="text-center text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
