"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selfCheckIn } from "@/lib/actions/events";

export function CheckInForm({
  eventId,
  eventSlug,
}: {
  eventId: string;
  eventSlug: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rawCode, setRawCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = rawCode.trim();
    if (code.length < 4) {
      setError("Enter the code shared at the door.");
      return;
    }
    startTransition(async () => {
      const res = await selfCheckIn(eventId, code);
      if (!res.ok) {
        // RATE_LIMITED gets a friendlier copy; everything else surfaces the
        // server-provided message (which already carries the specific
        // reason: invalid code / expired / already checked in / etc).
        if (res.error.code === "RATE_LIMITED") {
          setError("Too many attempts. Try again in a minute.");
        } else {
          setError(res.error.message);
        }
        return;
      }
      router.push(`/events/${eventSlug}/check-in/success`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="check-in-code">Check-in code</Label>
        <Input
          id="check-in-code"
          name="code"
          value={rawCode}
          onChange={(e) => setRawCode(e.target.value)}
          minLength={4}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          disabled={pending}
          placeholder="ABC123"
          className="text-center text-xl font-mono uppercase tracking-widest"
        />
        <p className="text-xs text-muted-foreground">
          Letters and numbers only. Case matters.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Checking in…" : "Check in"}
        </Button>
      </div>
    </form>
  );
}
