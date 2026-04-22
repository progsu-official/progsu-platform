"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rotateCheckInCode } from "@/lib/actions/events";

import type { EventRecord } from "./types";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function CheckInTab({ event }: { event: EventRecord }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rawCode, setRawCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(
    toLocalInput(event.check_in_code_expires_at)
  );
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const hasCode = !!event.check_in_code_hash;
  const expired =
    !!event.check_in_code_expires_at &&
    new Date(event.check_in_code_expires_at).getTime() <= Date.now();

  function onRotate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!expiresAt) {
      setError("Set an expiration.");
      return;
    }
    const iso = new Date(expiresAt).toISOString();
    startTransition(async () => {
      const r = await rotateCheckInCode(event.id, {
        raw_code: rawCode,
        expires_at: iso,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setOk("Code rotated. Hand it out at the door.");
      setRawCode("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Check-in
        </h2>
        <Link
          href={`/admin/events/${event.id}/check-in`}
          className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent/10"
        >
          Open day-of roster &rarr;
        </Link>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <p className="font-medium">Current code</p>
        {hasCode ? (
          <p className="text-xs text-muted-foreground">
            Configured (stored as bcrypt hash).{" "}
            {event.check_in_code_expires_at
              ? `Expires ${new Date(event.check_in_code_expires_at).toLocaleString()}${expired ? " (expired)" : ""}.`
              : "No expiration."}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No code configured yet. Self check-in will be rejected.
          </p>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          {ok}
        </div>
      ) : null}

      <form onSubmit={onRotate} className="space-y-3 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Rotate code</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="check-in-raw-code">Raw code (4-20 chars)</Label>
            <Input
              id="check-in-raw-code"
              value={rawCode}
              onChange={(e) => setRawCode(e.target.value)}
              minLength={4}
              maxLength={20}
              required
              disabled={pending}
              placeholder="KICKOFF26"
            />
            <p className="text-xs text-muted-foreground">
              Code is bcrypt-hashed at the DB; it&apos;s never stored in plaintext.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="check-in-expires">Expires at</Label>
            <Input
              id="check-in-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
              disabled={pending}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Rotating…" : "Rotate"}
          </Button>
        </div>
      </form>
    </div>
  );
}
