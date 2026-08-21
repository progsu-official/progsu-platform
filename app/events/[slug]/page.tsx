import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrl } from "@/lib/events/cover-url";
import { getRequestOnboardingState } from "@/lib/auth/request-cache";
import { onboardingPathFor } from "@/lib/auth/onboarding";

import { EVENT_TIME_ZONE, formatTimeRange } from "../_components/event-date";
import { EventDescription } from "./_components/event-description";
import { EventTicket } from "./_components/event-ticket";
import { RsvpPanel } from "./_components/rsvp-panel";

export const dynamic = "force-dynamic";

type EventRecord = {
  id: string;
  slug: string;
  title: string;
  description_md: string | null;
  status: "draft" | "published" | "cancelled" | "archived";
  visibility: "members" | "private_invite";
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  location_url: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  cover_image_path: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

type HostRow = { display_name: string; sort_order: number };
type RsvpRow = {
  status: "going" | "waitlisted" | "declined" | "cancelled";
  waitlisted_at: string | null;
  checkin_token: string | null;
};
type AttendanceRow = { checked_in_at: string; method: string };

const CHECK_IN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h before start to 2h after end.

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const monthShortFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
});
const dayNumberFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  day: "numeric",
});

export default async function MemberEventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let event: EventRecord;
  let hosts: HostRow[];
  let rsvp: RsvpRow | null;
  let attendance: AttendanceRow | null;
  let goingCount: number | null;
  let waitlistedCount: number | null;
  let holderRaw: Record<string, unknown> | null;

  if (!user) {
    // Anonymous visitor, per the 2026-08-20 RSVP-first decision: read through
    // the narrow public_event_by_slug() projection instead of the base
    // `events` table — RLS on `events`/`event_hosts` stays authenticated-only
    // (see supabase/migrations/20260820180000_public_event_by_slug.sql for
    // why). Only published + members-visibility events come back, which
    // already excludes draft/archived/cancelled/private_invite exactly like
    // can_view_event() would for a signed-in member with no relationship to
    // the event.
    const { data: publicEventRaw } = await supabase
      .rpc("public_event_by_slug", { p_slug: slug })
      .maybeSingle();
    if (!publicEventRaw) notFound();
    const p = publicEventRaw as {
      id: string;
      slug: string;
      title: string;
      description_md: string | null;
      starts_at: string;
      ends_at: string;
      location_text: string | null;
      location_url: string | null;
      capacity: number | null;
      waitlist_enabled: boolean;
      cover_image_path: string | null;
      going_count: number;
      waitlisted_count: number;
      hosts: HostRow[];
    };
    event = {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description_md: p.description_md,
      status: "published",
      visibility: "members",
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      location_text: p.location_text,
      location_url: p.location_url,
      capacity: p.capacity,
      waitlist_enabled: p.waitlist_enabled,
      cover_image_path: p.cover_image_path,
      cancelled_at: null,
      cancellation_reason: null,
    };
    hosts = p.hosts ?? [];
    rsvp = null;
    attendance = null;
    goingCount = p.going_count ?? 0;
    waitlistedCount = p.waitlisted_count ?? 0;
    holderRaw = null;
  } else {
    const { data: eventRaw } = await supabase
      .from("events")
      .select(
        "id, slug, title, description_md, status, visibility, starts_at, ends_at, location_text, location_url, capacity, waitlist_enabled, cover_image_path, cancelled_at, cancellation_reason"
      )
      .eq("slug", slug)
      .maybeSingle();
    // RLS on events gates visibility; rows the user can't view simply return null.
    if (!eventRaw) notFound();

    event = eventRaw as unknown as EventRecord;

    const [
      { data: hostsRaw },
      { data: rsvpRaw },
      { data: attendanceRaw },
      { count: going },
      { count: waitlisted },
      { data: holder },
    ] = await Promise.all([
      supabase
        .from("event_hosts")
        .select("display_name, sort_order")
        .eq("event_id", event.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("event_rsvps")
        .select("status, waitlisted_at, checkin_token")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("event_attendances")
        .select("checked_in_at, method")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("event_rsvps")
        .select("*", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("status", "going"),
      supabase
        .from("event_rsvps")
        .select("*", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("status", "waitlisted"),
      supabase
        .from("profiles")
        .select("preferred_name, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    hosts = ((hostsRaw ?? []) as HostRow[]).map((h) => ({
      display_name: h.display_name,
      sort_order: h.sort_order,
    }));
    rsvp = (rsvpRaw as RsvpRow | null) ?? null;
    attendance = (attendanceRaw as AttendanceRow | null) ?? null;
    goingCount = going;
    waitlistedCount = waitlisted;
    holderRaw = holder as Record<string, unknown> | null;
  }

  // Waitlist position via SECURITY DEFINER helper — RLS on event_rsvps is
  // self-only, so a direct count ahead-of-me is impossible from a user-context
  // client. my_waitlist_position() reads past RLS and returns a single int.
  let waitlistPosition: number | null = null;
  if (rsvp?.status === "waitlisted") {
    const { data: positionData } = await supabase.rpc("my_waitlist_position", {
      p_event_id: event.id,
    });
    const parsed =
      typeof positionData === "number" ? positionData : Number(positionData);
    waitlistPosition = Number.isFinite(parsed) ? parsed : null;
  }

  // Fully-onboarded state drives whether a successful RSVP nudges the user
  // into the onboarding funnel right after (2026-08-20 RSVP-first decision) —
  // that funnel already lands on /profile's existing completion band, which
  // already carries the "finish your profile → recruiters see you" framing,
  // so there is no new copy to write here.
  const onboardingState = user ? await getRequestOnboardingState(user.id) : null;
  const postRsvpOnboardingPath =
    onboardingState && !onboardingState.isAdmin && !onboardingState.fullyOnboarded
      ? onboardingPathFor(onboardingState.nextStep)
      : null;

  const coverUrl = await resolveCoverUrl(supabase, event.cover_image_path);
  const nowMs = Date.now();
  const startDate = new Date(event.starts_at);
  const startMs = startDate.getTime();
  const endMs = new Date(event.ends_at).getTime();
  const inCheckInWindow =
    nowMs >= startMs - CHECK_IN_WINDOW_MS &&
    nowMs <= endMs + CHECK_IN_WINDOW_MS;

  // RSVPs close when the event is over, cancelled, archived, or still a
  // draft. The DB also enforces this — hide the form so we don't tease a
  // button that will 400.
  const rsvpOpen = event.status === "published" && startMs > nowMs;

  // D12: the personal ticket is the check-in entry — staff scan its QR
  // inline from /admin/events/[id] (the Members tab is the manual fallback).
  // Shown from the moment the RSVP lands on `going`; redemption is admin-only
  // server-side, so early visibility is safe.
  const holder = holderRaw as {
    preferred_name: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
  const holderName = holder
    ? [holder.preferred_name || holder.first_name, holder.last_name]
        .filter(Boolean)
        .join(" ") || null
    : null;
  const hasTicket =
    event.status === "published" &&
    rsvp?.status === "going" &&
    !!rsvp.checkin_token;

  return (
    <div className="relative">
      {/* Partiful-style ambience: the cover art itself, blown up and blurred,
          washes color behind the whole page. Falls back to a primary glow
          when the event has no cover. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-5.5rem] -z-10 h-[34rem] w-screen -translate-x-1/2 overflow-hidden"
      >
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full scale-125 object-cover opacity-35 blur-3xl saturate-150"
          />
        ) : (
          <div className="absolute left-1/2 top-0 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/55 to-background" />
      </div>

      <div className="mx-auto max-w-4xl space-y-6">
        <nav>
          <Link
            href="/events"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={15} aria-hidden />
            All events
          </Link>
        </nav>

        {event.status === "cancelled" ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
          >
            <p className="font-semibold text-destructive">
              This event was cancelled
              {event.cancelled_at
                ? ` on ${new Date(event.cancelled_at).toLocaleString()}`
                : ""}
              .
            </p>
            {event.cancellation_reason ? (
              <p className="mt-1 text-destructive/80">
                {event.cancellation_reason}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[19rem_1fr] lg:gap-12">
          {/* Left rail: cover art + hosts + crowd, Luma-style. */}
          <div className="space-y-5">
            <div className="aspect-square w-full max-w-[19rem] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-muted to-primary/20 shadow-2xl shadow-black/40">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>

            {hosts.length > 0 ? (
              <section className="space-y-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hosted by
                </h2>
                <ul className="space-y-2">
                  {hosts.map((h) => (
                    <li
                      key={`${h.sort_order}-${h.display_name}`}
                      className="flex items-center gap-2.5 text-sm text-foreground"
                    >
                      <span
                        aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold uppercase text-primary"
                      >
                        {h.display_name.charAt(0)}
                      </span>
                      {h.display_name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users size={15} strokeWidth={1.75} aria-hidden />
              {goingCount ?? 0} going
              {event.waitlist_enabled && (waitlistedCount ?? 0) > 0
                ? ` · ${waitlistedCount} waitlisted`
                : ""}
            </p>
          </div>

          {/* Right column: title, when/where, RSVP, about. */}
          <div className="min-w-0 space-y-6">
            <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
              {event.title}
            </h1>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  aria-hidden
                  className="w-11 shrink-0 overflow-hidden rounded-lg glass text-center"
                >
                  <p className="bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {monthShortFormatter.format(startDate)}
                  </p>
                  <p className="py-0.5 text-sm font-semibold tabular-nums">
                    {dayNumberFormatter.format(startDate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    <time dateTime={event.starts_at}>
                      {fullDateFormatter.format(startDate)}
                    </time>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatTimeRange(event.starts_at, event.ends_at)}
                  </p>
                </div>
              </div>

              {event.location_text || event.location_url ? (
                <div className="flex items-center gap-3">
                  <div
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg glass"
                  >
                    <MapPin
                      size={17}
                      strokeWidth={1.75}
                      className="text-muted-foreground"
                    />
                  </div>
                  <div className="min-w-0">
                    {event.location_url ? (
                      <a
                        href={event.location_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {event.location_text ?? event.location_url}
                      </a>
                    ) : (
                      <p className="text-sm font-medium text-foreground">
                        {event.location_text}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {hasTicket ? (
              <EventTicket
                eventId={event.id}
                title={event.title}
                startsAt={event.starts_at}
                token={rsvp!.checkin_token as string}
                holderName={holderName}
                checkedInAt={attendance?.checked_in_at ?? null}
                inCheckInWindow={inCheckInWindow}
              />
            ) : attendance ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                <span aria-hidden>✓</span> Checked in at{" "}
                {new Date(attendance.checked_in_at).toLocaleString()}.
              </div>
            ) : null}

            <RsvpPanel
              eventId={event.id}
              eventPath={`/events/${event.slug}`}
              signedIn={!!user}
              postRsvpOnboardingPath={postRsvpOnboardingPath}
              initial={{
                status: rsvp?.status ?? null,
                waitlistPosition,
              }}
              rsvpOpen={rsvpOpen}
              capacity={event.capacity}
              goingCount={goingCount ?? 0}
              waitlistEnabled={event.waitlist_enabled}
              waitlistedCount={waitlistedCount ?? 0}
            />

            {event.description_md ? (
              <section className="space-y-3 border-t border-border/60 pt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  About this event
                </h2>
                <EventDescription md={event.description_md} />
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
