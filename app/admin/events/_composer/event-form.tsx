"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  BellRing,
  CalendarDays,
  EyeOff,
  Mail,
  Pencil,
  Users,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/browser";
import {
  createEvent,
  createEventCoverUploadUrl,
  deleteEventCover,
  updateEvent,
} from "@/lib/actions/events";
import {
  EVENT_COVER_MIME_TYPES,
  type EventVisibility,
} from "@/lib/actions/event-schemas";
import type { EventRecord } from "../[id]/types";

import { DEFAULT_THEME, type ThemeSpec, themeStyle } from "./event-theme";
import {
  addMinutesToTime,
  browserTimeZone,
  nextHalfHour,
  utcInstantToWallTime,
  wallTimeToUtcIso,
} from "./datetime";
import { CoverField } from "./_components/cover-field";
import { ThemePicker } from "./_components/theme-picker";
import { DatePicker } from "./_components/date-picker";
import { DescriptionField } from "./_components/description-modal";
import { HostsPicker, type HostRow } from "./_components/hosts-picker";
import { LocationPicker, type LocationValue } from "./_components/location-picker";
import { OptionRow } from "./_components/option-row";
import { Popover } from "./_components/popover";
import { Switch } from "./_components/switch";
import { TimePicker } from "./_components/time-picker";
import { TimezonePicker } from "./_components/timezone-picker";
import { VisibilityPicker } from "./_components/visibility-picker";

const EVENT_COVERS_BUCKET = "event-covers";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

type Props = {
  recentLocations: string[];
  /** Present in edit mode: prefills every field and switches submit from
   * createEvent to updateEvent. Omitted on the /new composer. */
  event?: EventRecord;
  /** Signed URL for the event's already-persisted cover, if any. Edit mode only. */
  coverUrl?: string | null;
};

export function EventForm({ recentLocations, event, coverUrl = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = event != null;

  const [title, setTitle] = useState(event?.title ?? "");
  const [slug, setSlug] = useState(event?.slug ?? "");
  // An existing event's slug was already chosen deliberately, so title edits
  // shouldn't silently re-slugify it the way they do while first typing a name.
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [visibility, setVisibility] = useState<EventVisibility>(
    event?.visibility ?? "members"
  );
  const [description, setDescription] = useState(event?.description_md ?? "");
  const [location, setLocation] = useState<LocationValue>({
    text: event?.location_text ?? "",
    url: event?.location_url ?? "",
  });
  const [hosts, setHosts] = useState<HostRow[]>(
    event?.hosts.map((h) => ({
      display_name: h.display_name,
      profile_id: h.profile_id ?? "",
    })) ?? []
  );
  const [capacity, setCapacity] = useState(
    event?.capacity == null ? "" : String(event.capacity)
  );
  const [waitlist, setWaitlist] = useState(event?.waitlist_enabled ?? false);
  const [sensitive, setSensitive] = useState(event?.is_sensitive ?? false);
  const [rsvpEmail, setRsvpEmail] = useState(event?.send_rsvp_email ?? true);
  const [reminderEmail, setReminderEmail] = useState(
    event?.send_reminder_email ?? true
  );
  const [theme, setTheme] = useState<ThemeSpec>(DEFAULT_THEME);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  // Only meaningful in edit mode: admin removed the persisted cover and
  // hasn't staged a replacement, so save should clear it server-side.
  const [coverRemoved, setCoverRemoved] = useState(false);

  // "Now" only exists in the browser. Resolving it during render would emit
  // the server's clock and zone into the HTML and mismatch on hydration.
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [timeZone, setTimeZone] = useState("");

  const [error, setError] = useState<{ message: string; field?: string } | null>(
    null
  );
  const [created, setCreated] = useState<{ id: string; note: string } | null>(
    null
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    const zone = browserTimeZone();
    setTimeZone(zone);
    if (event) {
      // The DB only stores the UTC instant, not the zone it was scheduled in,
      // so re-derive wall time in the browser's current zone — the same
      // implicit assumption the old plain `datetime-local` form made.
      const start = utcInstantToWallTime(Date.parse(event.starts_at), zone);
      const end = utcInstantToWallTime(Date.parse(event.ends_at), zone);
      setStartDate(start.date);
      setStartTime(start.time);
      setEndDate(end.date);
      setEndTime(end.time);
    } else {
      const start = nextHalfHour(new Date());
      const end = addMinutesToTime(start.date, start.time, 60);
      setStartDate(start.date);
      setStartTime(start.time);
      setEndDate(end.date);
      setEndTime(end.time);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const ready = timeZone !== "";
  const instantMs = ready && startDate ? Date.parse(`${startDate}T12:00:00Z`) : 0;

  /** Keep the end at or after the start when the start moves forward. */
  function moveStart(nextDate: string, nextTime: string) {
    setStartDate(nextDate);
    setStartTime(nextTime);
    const startMs = Date.parse(`${nextDate}T${nextTime}`);
    const endMs = Date.parse(`${endDate}T${endTime}`);
    if (!Number.isFinite(endMs) || endMs <= startMs) {
      const bumped = addMinutesToTime(nextDate, nextTime, 60);
      setEndDate(bumped.date);
      setEndTime(bumped.time);
    }
  }

  /** Only runs when the admin actually chose a file. */
  async function uploadCover(eventId: string): Promise<string | null> {
    const blob = coverFile;
    if (!blob) return null;
    const contentType = blob.type as (typeof EVENT_COVER_MIME_TYPES)[number];

    const signed = await createEventCoverUploadUrl({
      eventId,
      contentType,
      fileSize: blob.size,
    });
    if (!signed.ok) return signed.error.message;

    const supabase = createBrowserClient();
    const { error: uploadErr } = await supabase.storage
      .from(EVENT_COVERS_BUCKET)
      .uploadToSignedUrl(signed.data.path, signed.data.token, blob, {
        contentType,
      });
    if (uploadErr) return uploadErr.message;

    const upd = await updateEvent(eventId, {
      cover_image_path: signed.data.path,
    });
    return upd.ok ? null : upd.error.message;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedNotice(null);
    const hostsPayload = hosts
      .map((h) => ({
        display_name: h.display_name.trim(),
        profile_id: h.profile_id.trim() || null,
      }))
      .filter((h) => h.display_name.length > 0);
    const sharedFields = {
      slug: effectiveSlug,
      title,
      description_md: description || null,
      visibility,
      starts_at: wallTimeToUtcIso(startDate, startTime, timeZone),
      ends_at: wallTimeToUtcIso(endDate, endTime, timeZone),
      location_text: location.text || null,
      location_url: location.url || null,
      capacity: capacity || null,
      waitlist_enabled: waitlist,
      is_sensitive: sensitive,
      send_rsvp_email: rsvpEmail,
      send_reminder_email: reminderEmail,
      hosts: hostsPayload,
    };

    startTransition(async () => {
      if (isEdit) {
        const result = await updateEvent(event.id, sharedFields);
        if (!result.ok) {
          setError({ message: result.error.message, field: result.error.field });
          return;
        }

        if (coverFile) {
          const coverError = await uploadCover(event.id);
          if (coverError) {
            setError({
              message: `Saved, but the cover didn't upload: ${coverError}`,
            });
            return;
          }
          setCoverFile(null);
        } else if (coverRemoved) {
          const coverResult = await deleteEventCover(event.id);
          if (!coverResult.ok) {
            setError({ message: coverResult.error.message });
            return;
          }
          setCoverRemoved(false);
        }

        setSavedNotice("Saved.");
        router.refresh();
        return;
      }

      const result = await createEvent({ ...sharedFields, cover_image_path: null });

      if (!result.ok) {
        setError({ message: result.error.message, field: result.error.field });
        return;
      }

      // The event exists now, so a cover failure is recoverable on the detail
      // page. Say so instead of throwing the admin back to a blank form.
      const coverError = await uploadCover(result.data.eventId);
      if (coverError) {
        setCreated({
          id: result.data.eventId,
          note: `Event created, but the cover didn't upload: ${coverError}`,
        });
        return;
      }

      router.push(`/admin/events/${result.data.eventId}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-8 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-10"
    >
      {/* The theme dresses the page, not the cover. Painted here rather than in
          the server component because the picker changes it live; `absolute`
          resolves to the page wrapper, which is the full-bleed element. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 transition-[background-color] duration-500 motion-reduce:transition-none"
        style={themeStyle(theme)}
      />

      <div className="space-y-3 lg:sticky lg:top-8 lg:self-start">
        <CoverField
          file={coverFile}
          onFileChange={setCoverFile}
          existingUrl={coverRemoved ? null : coverUrl}
          onRemoveExisting={() => setCoverRemoved(true)}
          theme={theme}
          disabled={pending}
        />
        <ThemePicker theme={theme} onChange={setTheme} disabled={pending} />
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 rounded-full bg-white/[0.1] py-1.5 pl-1.5 pr-4">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500 text-xs font-bold text-white"
            >
              P
            </span>
            <span className="text-[15px] font-medium text-white">
              Progsu events
            </span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/80">
              {event?.status ?? "Draft"}
            </span>
          </span>
          <VisibilityPicker
            value={visibility}
            onChange={setVisibility}
            disabled={pending}
          />
        </div>

        <div>
          <label htmlFor="event-title" className="sr-only">
            Event name
          </label>
          <input
            id="event-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            disabled={pending}
            autoComplete="off"
            placeholder="Event name"
            className={cn(
              "w-full bg-transparent font-serif text-5xl leading-tight tracking-tight text-white sm:text-6xl",
              "placeholder:text-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
            )}
          />
          <div className="mt-1 flex items-baseline gap-1 text-sm text-white/40">
            <span aria-hidden>/events/</span>
            <label htmlFor="event-slug" className="sr-only">
              URL slug
            </label>
            <input
              id="event-slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              disabled={pending}
              placeholder="winter-kickoff"
              className="min-w-0 flex-1 bg-transparent text-white/60 placeholder:text-white/25 focus:text-white focus:outline-none"
            />
          </div>
          {error?.field === "title" || error?.field === "slug" ? (
            <p role="alert" className="mt-1 text-sm text-rose-300">
              {error.message}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="space-y-1 rounded-xl bg-white/[0.08] p-2">
            <TimeRow
              label="Start"
              first
              date={startDate}
              time={startTime}
              onDate={(d) => moveStart(d, startTime)}
              onTime={(t) => moveStart(startDate, t)}
              disabled={pending || !ready}
            />
            <TimeRow
              label="End"
              date={endDate}
              time={endTime}
              onDate={setEndDate}
              onTime={setEndTime}
              disabled={pending || !ready}
            />
          </div>
          {ready ? (
            <TimezonePicker
              value={timeZone}
              onChange={setTimeZone}
              instantMs={instantMs}
              disabled={pending}
            />
          ) : (
            <div className="rounded-xl bg-white/[0.08]" />
          )}
        </div>
        {error?.field === "ends_at" || error?.field === "starts_at" ? (
          <p role="alert" className="text-sm text-rose-300">
            {error.message}
          </p>
        ) : null}

        <LocationPicker
          value={location}
          onChange={setLocation}
          recent={recentLocations}
          disabled={pending}
          error={error?.field === "location_url" ? error.message : null}
        />

        <DescriptionField
          value={description}
          onChange={setDescription}
          disabled={pending}
        />

        <div className="pt-2">
          <h2 className="mb-2 text-sm font-medium text-white/60">
            Event options
          </h2>
          <div className="rounded-xl bg-white/[0.08]">
            <OptionRow icon={Users} label="Capacity">
              <CapacityEditor
                value={capacity}
                onChange={(next) => {
                  setCapacity(next);
                  if (!next) setWaitlist(false);
                }}
                disabled={pending}
              />
            </OptionRow>
            <OptionRow
              icon={UsersRound}
              label="Waitlist when full"
              hint={capacity ? undefined : "Needs a capacity"}
            >
              <Switch
                label="Waitlist when full"
                checked={waitlist}
                onChange={setWaitlist}
                disabled={pending || !capacity}
              />
            </OptionRow>
            <OptionRow icon={CalendarDays} label="Hosts">
              <HostsPicker
                hosts={hosts}
                onChange={setHosts}
                disabled={pending}
              />
            </OptionRow>
            <OptionRow icon={Mail} label="RSVP confirmation email">
              <Switch
                label="RSVP confirmation email"
                checked={rsvpEmail}
                onChange={setRsvpEmail}
                disabled={pending}
              />
            </OptionRow>
            <OptionRow
              icon={BellRing}
              label="Reminder email"
              hint={
                event?.reminder_sent_at
                  ? `Last sent ${new Date(event.reminder_sent_at).toLocaleString()}`
                  : undefined
              }
            >
              <Switch
                label="Reminder email"
                checked={reminderEmail}
                onChange={setReminderEmail}
                disabled={pending}
              />
            </OptionRow>
            <OptionRow
              icon={EyeOff}
              label="Sensitive event"
              hint="Kept out of shared attendance history"
            >
              <Switch
                label="Sensitive event"
                checked={sensitive}
                onChange={setSensitive}
                disabled={pending}
              />
            </OptionRow>
          </div>
        </div>

        {error && !error.field ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-400/30 bg-rose-500/15 px-4 py-3 text-sm text-rose-100"
          >
            {error.message}
          </p>
        ) : null}

        {created ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-300/30 bg-amber-400/15 px-4 py-3 text-sm text-amber-100"
          >
            <p>{created.note}</p>
            <button
              type="button"
              onClick={() => router.push(`/admin/events/${created.id}`)}
              className="mt-2 font-semibold underline underline-offset-2"
            >
              Go to the event
            </button>
          </div>
        ) : null}

        {savedNotice ? (
          <p
            role="status"
            className="rounded-xl border border-emerald-300/30 bg-emerald-400/15 px-4 py-3 text-sm text-emerald-100"
          >
            {savedNotice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || !ready}
          className={cn(
            "w-full rounded-xl bg-white px-6 py-4 text-base font-semibold text-[#1B0E2B] transition-colors",
            "hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2E1240]",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {pending
            ? isEdit
              ? "Saving…"
              : "Creating…"
            : isEdit
              ? "Save changes"
              : "Create event"}
        </button>
      </div>
    </form>
  );
}

function TimeRow({
  label,
  first,
  date,
  time,
  onDate,
  onTime,
  disabled,
}: {
  label: string;
  first?: boolean;
  date: string;
  time: string;
  onDate: (next: string) => void;
  onTime: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pl-2">
      <span className="flex w-16 shrink-0 items-center gap-2.5 text-[15px] text-white/85">
        <span
          aria-hidden
          className={cn(
            "relative h-2 w-2 rounded-full",
            first ? "bg-white/80" : "ring-1 ring-white/60",
            first &&
              "after:absolute after:left-1/2 after:top-3 after:h-6 after:-translate-x-1/2 after:border-l after:border-dashed after:border-white/30"
          )}
        />
        {label}
      </span>
      <div className="ml-auto flex min-w-0 gap-1.5">
        <div className="w-40 shrink-0">
          <DatePicker
            value={date}
            onChange={onDate}
            disabled={disabled}
            label={`${label} date`}
          />
        </div>
        <div className="w-32 shrink-0">
          <TimePicker
            value={time}
            onChange={onTime}
            disabled={disabled}
            label={`${label} time`}
          />
        </div>
      </div>
    </div>
  );
}

function CapacityEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover
      align="end"
      panelClassName="w-64"
      trigger={({ ref, props }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-[15px] text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {value ? `${value} spots` : "Unlimited"}
          <Pencil size={14} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-3 p-4">
          <label
            htmlFor="event-capacity"
            className="block text-sm font-medium text-white"
          >
            Maximum guests
          </label>
          <input
            id="event-capacity"
            type="number"
            min={0}
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                close();
              }
            }}
            placeholder="Unlimited"
            className="w-full rounded-lg bg-white/[0.07] px-3 py-2 text-[15px] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/50"
          />
          <p className="text-xs text-white/45">
            Members past the limit are waitlisted when the waitlist is on.
          </p>
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
                close();
              }}
              className="text-sm font-medium text-white/70 underline underline-offset-2 transition-colors hover:text-white"
            >
              Remove limit
            </button>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
