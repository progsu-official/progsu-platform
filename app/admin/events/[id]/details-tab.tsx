"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveEvent,
  cancelEvent,
  deleteDraftEvent,
  publishEvent,
  updateEvent,
} from "@/lib/actions/events";

import { CoverUploader } from "./cover-uploader";
import type { EventRecord } from "./types";

// datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function DetailsTab({
  event,
  coverUrl,
}: {
  event: EventRecord;
  coverUrl: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [cancelPanel, setCancelPanel] = useState<{
    open: boolean;
    reason: string;
  }>({ open: false, reason: "" });

  const [form, setForm] = useState({
    title: event.title,
    description_md: event.description_md ?? "",
    starts_at: toLocalInput(event.starts_at),
    ends_at: toLocalInput(event.ends_at),
    location_text: event.location_text ?? "",
    location_url: event.location_url ?? "",
    capacity: event.capacity == null ? "" : String(event.capacity),
    waitlist_enabled: event.waitlist_enabled,
    is_sensitive: event.is_sensitive,
  });

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

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await updateEvent(event.id, {
        title: form.title,
        description_md: form.description_md,
        starts_at: toIso(form.starts_at) ?? event.starts_at,
        ends_at: toIso(form.ends_at) ?? event.ends_at,
        location_text: form.location_text,
        location_url: form.location_url,
        capacity: form.capacity === "" ? null : form.capacity,
        waitlist_enabled: form.waitlist_enabled,
        is_sensitive: form.is_sensitive,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setEditing(false);
      router.refresh();
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
          {!editing ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              Edit
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

      {!editing ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <InfoCard title="Title" value={event.title} />
          <InfoCard title="Slug" value={event.slug} />
          <InfoCard
            title="Starts"
            value={new Date(event.starts_at).toLocaleString()}
          />
          <InfoCard
            title="Ends"
            value={new Date(event.ends_at).toLocaleString()}
          />
          <InfoCard title="Location" value={event.location_text ?? "—"} />
          <InfoCard
            title="Location URL"
            value={event.location_url ?? "—"}
            mono
          />
          <InfoCard
            title="Capacity"
            value={event.capacity == null ? "Unlimited" : String(event.capacity)}
          />
          <InfoCard
            title="Waitlist"
            value={event.waitlist_enabled ? "Enabled" : "Disabled"}
          />
          <InfoCard
            title="Visibility"
            value={event.visibility === "members" ? "All members" : "Private invite"}
          />
          <InfoCard
            title="Sensitive"
            value={event.is_sensitive ? "Yes" : "No"}
          />
          <div className="md:col-span-2">
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Cover image
            </h3>
            <CoverUploader
              eventId={event.id}
              currentPath={event.cover_image_path}
              currentUrl={coverUrl}
            />
          </div>
          <InfoCard
            title="Hosts"
            value={
              event.hosts.length === 0
                ? "—"
                : event.hosts.map((h) => h.display_name).join(", ")
            }
          />
          <div className="md:col-span-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
              Description
            </h3>
            <pre className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">
              {event.description_md ?? "—"}
            </pre>
          </div>
        </div>
      ) : (
        <form onSubmit={onSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                required
                disabled={pending}
              />
            </Field>
            <Field label="Capacity (blank = unlimited)">
              <Input
                type="number"
                min={0}
                value={form.capacity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, capacity: e.target.value }))
                }
                disabled={pending}
              />
            </Field>
            <Field label="Starts">
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, starts_at: e.target.value }))
                }
                required
                disabled={pending}
              />
            </Field>
            <Field label="Ends">
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ends_at: e.target.value }))
                }
                required
                disabled={pending}
              />
            </Field>
            <Field label="Location text">
              <Input
                value={form.location_text}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location_text: e.target.value }))
                }
                disabled={pending}
              />
            </Field>
            <Field label="Location URL">
              <Input
                type="url"
                value={form.location_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location_url: e.target.value }))
                }
                disabled={pending}
              />
            </Field>
            <div className="space-y-2 pt-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.waitlist_enabled}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      waitlist_enabled: e.target.checked,
                    }))
                  }
                  disabled={pending}
                />
                Enable waitlist
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.is_sensitive}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      is_sensitive: e.target.checked,
                    }))
                  }
                  disabled={pending}
                />
                Mark as sensitive
              </label>
            </div>
          </div>
          <Field label="Description (Markdown)">
            <textarea
              className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description_md}
              onChange={(e) =>
                setForm((f) => ({ ...f, description_md: e.target.value }))
              }
              disabled={pending}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Discard
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function InfoCard({
  title,
  value,
  mono,
}: {
  title: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className={mono ? "mt-0.5 break-all font-mono text-xs" : "mt-0.5 text-sm"}>
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
