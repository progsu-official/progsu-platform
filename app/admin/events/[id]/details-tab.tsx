"use client";

import { useRouter } from "next/navigation";
import { Instrument_Serif } from "next/font/google";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  archiveEvent,
  cancelEvent,
  deleteDraftEvent,
  publishEvent,
} from "@/lib/actions/events";

import { EventForm } from "../_composer/event-form";
import type { EventRecord } from "./types";

// Matches the composer's one display face (app/admin/events/new/page.tsx) so
// the event title reads the same in edit mode.
const display = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

export function DetailsTab({
  event,
  coverUrl,
}: {
  event: EventRecord;
  coverUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [cancelPanel, setCancelPanel] = useState<{
    open: boolean;
    reason: string;
  }>({ open: false, reason: "" });

  function runLifecycle(
    fn: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  ) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error.message);
      else router.refresh();
    });
  }

  function openCancelPanel() {
    setError(null);
    setCancelPanel({ open: true, reason: "" });
  }

  function confirmCancel() {
    const reason = cancelPanel.reason.trim();
    if (!reason) {
      setError("Reason is required to cancel an event.");
      return;
    }
    runLifecycle(async () => {
      const r = await cancelEvent(event.id, { reason });
      if (r.ok) setCancelPanel({ open: false, reason: "" });
      return r;
    });
  }

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete this draft event? Hosts/invites/RSVPs will cascade away."
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const r = await deleteDraftEvent(event.id);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.push("/admin/events");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Details</h2>
        <div className="flex gap-2">
          {event.status === "draft" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => runLifecycle(() => publishEvent(event.id))}
              disabled={pending}
            >
              Publish
            </Button>
          ) : null}
          {event.status === "draft" || event.status === "published" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openCancelPanel}
              disabled={pending}
            >
              Cancel event
            </Button>
          ) : null}
          {event.status === "published" || event.status === "cancelled" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => runLifecycle(() => archiveEvent(event.id))}
              disabled={pending}
            >
              Archive
            </Button>
          ) : null}
          {event.status === "draft" ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              Delete draft
            </Button>
          ) : null}
        </div>
      </div>

      {event.cancellation_reason ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Cancelled</p>
          <p className="text-xs">{event.cancellation_reason}</p>
        </div>
      ) : null}

      {cancelPanel.open ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-destructive">Cancel this event?</p>
            <p className="text-xs text-muted-foreground">
              Everyone with a going, waitlisted, or attended record will receive
              a cancellation email. The event will disappear from discovery but
              stay visible to people with RSVPs.
            </p>
          </div>
          <div>
            <Label htmlFor="cancel-reason" className="text-xs">
              Reason (shown to members)
            </Label>
            <textarea
              id="cancel-reason"
              value={cancelPanel.reason}
              onChange={(e) =>
                setCancelPanel((p) => ({ ...p, reason: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              maxLength={2000}
              disabled={pending}
              placeholder="Venue fell through — rescheduling next week."
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={confirmCancel}
              disabled={pending || cancelPanel.reason.trim().length === 0}
            >
              Confirm cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCancelPanel({ open: false, reason: "" })}
              disabled={pending}
            >
              Keep event
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {/* Same composer used on /admin/events/new, in edit mode: prefilled from
          `event`, saves in place via updateEvent instead of creating + redirecting.
          `relative isolate` gives the composer's absolutely-positioned theme
          layer a positioned ancestor scoped to this tab instead of the whole
          admin page. */}
      <div
        className={`${display.variable} relative isolate overflow-hidden rounded-2xl bg-[#2E1240] p-6 lg:p-10`}
      >
        <EventForm event={event} coverUrl={coverUrl} recentLocations={[]} />
      </div>
    </div>
  );
}
