"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { updateEvent } from "@/lib/actions/events";

import type { EventRecord } from "./types";

export function NotificationsTab({ event }: { event: EventRecord }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sendRsvp, setSendRsvp] = useState(event.send_rsvp_email);
  const [sendReminder, setSendReminder] = useState(event.send_reminder_email);

  const dirty =
    sendRsvp !== event.send_rsvp_email ||
    sendReminder !== event.send_reminder_email;

  function onSave() {
    setError(null);
    startTransition(async () => {
      const r = await updateEvent(event.id, {
        send_rsvp_email: sendRsvp,
        send_reminder_email: sendReminder,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Notifications
      </h2>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-3 rounded-md border p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={sendRsvp}
            onChange={(e) => setSendRsvp(e.target.checked)}
            disabled={pending}
          />
          <div>
            <p className="font-medium">Send RSVP confirmation emails</p>
            <p className="text-xs text-muted-foreground">
              Members get a confirmation email after they RSVP going or land on
              the waitlist.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={sendReminder}
            onChange={(e) => setSendReminder(e.target.checked)}
            disabled={pending}
          />
          <div>
            <p className="font-medium">Send reminder emails</p>
            <p className="text-xs text-muted-foreground">
              Reminder cron will fan out to the going roster before the event.
              {event.reminder_sent_at
                ? ` Last sent ${new Date(event.reminder_sent_at).toLocaleString()}.`
                : " Not yet sent."}
            </p>
          </div>
        </label>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
