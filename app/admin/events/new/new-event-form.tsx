"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEvent } from "@/lib/actions/events";
import {
  EVENT_VISIBILITIES,
  type EventVisibility,
} from "@/lib/actions/event-schemas";

type HostRow = { display_name: string; profile_id: string };

type State = {
  slug: string;
  title: string;
  description_md: string;
  visibility: EventVisibility;
  starts_at: string; // datetime-local value
  ends_at: string;
  location_text: string;
  location_url: string;
  capacity: string;
  waitlist_enabled: boolean;
  is_sensitive: boolean;
  send_rsvp_email: boolean;
  send_reminder_email: boolean;
  hosts: HostRow[];
};

const initial: State = {
  slug: "",
  title: "",
  description_md: "",
  visibility: "members",
  starts_at: "",
  ends_at: "",
  location_text: "",
  location_url: "",
  capacity: "",
  waitlist_enabled: false,
  is_sensitive: false,
  send_rsvp_email: true,
  send_reminder_email: true,
  hosts: [],
};

function toIso(local: string): string {
  // `datetime-local` yields "YYYY-MM-DDTHH:mm" without TZ info; the browser
  // parses it in local TZ and we normalise to ISO-UTC.
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

export function NewEventForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>(initial);
  const [error, setError] = useState<{ message: string; field?: string } | null>(
    null
  );

  function setField<K extends keyof State>(key: K, value: State[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function addHost() {
    setState((s) => ({
      ...s,
      hosts: [...s.hosts, { display_name: "", profile_id: "" }],
    }));
  }

  function removeHost(i: number) {
    setState((s) => ({
      ...s,
      hosts: s.hosts.filter((_, idx) => idx !== i),
    }));
  }

  function updateHost(i: number, patch: Partial<HostRow>) {
    setState((s) => ({
      ...s,
      hosts: s.hosts.map((h, idx) => (idx === i ? { ...h, ...patch } : h)),
    }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createEvent({
        slug: state.slug,
        title: state.title,
        description_md: state.description_md || null,
        visibility: state.visibility,
        starts_at: toIso(state.starts_at),
        ends_at: toIso(state.ends_at),
        location_text: state.location_text || null,
        location_url: state.location_url || null,
        capacity: state.capacity || null,
        waitlist_enabled: state.waitlist_enabled,
        is_sensitive: state.is_sensitive,
        send_rsvp_email: state.send_rsvp_email,
        send_reminder_email: state.send_reminder_email,
        cover_image_path: null,
        hosts: state.hosts
          .map((h) => ({
            display_name: h.display_name.trim(),
            profile_id: h.profile_id.trim() || null,
          }))
          .filter((h) => h.display_name.length > 0),
      });
      if (!result.ok) {
        setError({
          message: result.error.message,
          field: result.error.field,
        });
        return;
      }
      router.push(`/admin/events/${result.data.eventId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Title"
          required
          error={error?.field === "title" ? error.message : null}
        >
          <Input
            value={state.title}
            onChange={(e) => setField("title", e.target.value)}
            maxLength={200}
            required
            disabled={pending}
          />
        </Field>
        <Field
          label="Slug"
          required
          hint="Lowercase letters, numbers, dashes. Used in URLs."
          error={error?.field === "slug" ? error.message : null}
        >
          <Input
            value={state.slug}
            onChange={(e) => setField("slug", e.target.value)}
            placeholder="winter-kickoff-2026"
            required
            disabled={pending}
          />
        </Field>
        <Field
          label="Starts"
          required
          error={error?.field === "starts_at" ? error.message : null}
        >
          <Input
            type="datetime-local"
            value={state.starts_at}
            onChange={(e) => setField("starts_at", e.target.value)}
            required
            disabled={pending}
          />
        </Field>
        <Field
          label="Ends"
          required
          error={error?.field === "ends_at" ? error.message : null}
        >
          <Input
            type="datetime-local"
            value={state.ends_at}
            onChange={(e) => setField("ends_at", e.target.value)}
            required
            disabled={pending}
          />
        </Field>
        <Field label="Visibility" required>
          <select
            className={selectClass}
            value={state.visibility}
            onChange={(e) =>
              setField("visibility", e.target.value as EventVisibility)
            }
            disabled={pending}
          >
            {EVENT_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v === "members" ? "All members" : "Private invite"}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Capacity (optional)"
          hint="Leave blank for no limit."
          error={error?.field === "capacity" ? error.message : null}
        >
          <Input
            type="number"
            min={0}
            value={state.capacity}
            onChange={(e) => setField("capacity", e.target.value)}
            disabled={pending}
          />
        </Field>
      </section>

      <Field label="Description (Markdown)">
        <textarea
          className={textareaClass}
          value={state.description_md}
          onChange={(e) => setField("description_md", e.target.value)}
          rows={6}
          maxLength={20000}
          disabled={pending}
        />
      </Field>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Location text">
          <Input
            value={state.location_text}
            onChange={(e) => setField("location_text", e.target.value)}
            placeholder="Klaus Advanced Computing Building 1447"
            disabled={pending}
          />
        </Field>
        <Field
          label="Location URL"
          error={error?.field === "location_url" ? error.message : null}
        >
          <Input
            type="url"
            value={state.location_url}
            onChange={(e) => setField("location_url", e.target.value)}
            placeholder="https://maps.google.com/…"
            disabled={pending}
          />
        </Field>
      </section>

      <p className="text-xs text-muted-foreground">
        You can upload a cover image after creating the event.
      </p>

      <section className="space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Hosts (optional)</h2>
          <Button type="button" size="sm" variant="outline" onClick={addHost}>
            Add host
          </Button>
        </div>
        {state.hosts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hosts listed.</p>
        ) : (
          <div className="space-y-2">
            {state.hosts.map((h, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
              >
                <Input
                  placeholder="Display name"
                  value={h.display_name}
                  onChange={(e) =>
                    updateHost(i, { display_name: e.target.value })
                  }
                  disabled={pending}
                />
                <Input
                  placeholder="Profile id (optional)"
                  value={h.profile_id}
                  onChange={(e) =>
                    updateHost(i, { profile_id: e.target.value })
                  }
                  disabled={pending}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeHost(i)}
                  disabled={pending}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-md border p-4 sm:grid-cols-2">
        <Check
          label="Enable waitlist (when capacity is set)"
          checked={state.waitlist_enabled}
          onChange={(v) => setField("waitlist_enabled", v)}
          disabled={pending}
        />
        <Check
          label="Mark as sensitive (excluded from shared-history surfaces later)"
          checked={state.is_sensitive}
          onChange={(v) => setField("is_sensitive", v)}
          disabled={pending}
        />
        <Check
          label="Send RSVP confirmation email"
          checked={state.send_rsvp_email}
          onChange={(v) => setField("send_rsvp_email", v)}
          disabled={pending}
        />
        <Check
          label="Send reminder email"
          checked={state.send_reminder_email}
          onChange={(v) => setField("send_reminder_email", v)}
          disabled={pending}
        />
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error.message}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/admin/events")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create draft event"}
        </Button>
      </div>
    </form>
  );
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  );
}
