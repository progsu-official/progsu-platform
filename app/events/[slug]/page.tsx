import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrl } from "@/lib/events/cover-url";
import { Button } from "@/components/ui/button";

import { EventDate } from "../_components/event-date";
import { EventDescription } from "./_components/event-description";
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
};
type AttendanceRow = { checked_in_at: string; method: string };

const CHECK_IN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h before start to 2h after end.

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
  if (!user) notFound();

  const { data: eventRaw } = await supabase
    .from("events")
    .select(
      "id, slug, title, description_md, status, visibility, starts_at, ends_at, location_text, location_url, capacity, waitlist_enabled, cover_image_path, cancelled_at, cancellation_reason"
    )
    .eq("slug", slug)
    .maybeSingle();
  // RLS on events gates visibility; rows the user can't view simply return null.
  if (!eventRaw) notFound();

  const event = eventRaw as unknown as EventRecord;

  const [
    { data: hostsRaw },
    { data: rsvpRaw },
    { data: attendanceRaw },
    { count: goingCount },
    { count: waitlistedCount },
  ] = await Promise.all([
    supabase
      .from("event_hosts")
      .select("display_name, sort_order")
      .eq("event_id", event.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("event_rsvps")
      .select("status, waitlisted_at")
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
  ]);

  const hosts = ((hostsRaw ?? []) as HostRow[]).map((h) => ({
    display_name: h.display_name,
    sort_order: h.sort_order,
  }));
  const rsvp = (rsvpRaw as RsvpRow | null) ?? null;
  const attendance = (attendanceRaw as AttendanceRow | null) ?? null;

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

  const coverUrl = await resolveCoverUrl(supabase, event.cover_image_path);
  const nowMs = Date.now();
  const startMs = new Date(event.starts_at).getTime();
  const endMs = new Date(event.ends_at).getTime();
  const inCheckInWindow =
    nowMs >= startMs - CHECK_IN_WINDOW_MS &&
    nowMs <= endMs + CHECK_IN_WINDOW_MS;

  // RSVPs close when the event is over, cancelled, archived, or still a
  // draft. The DB also enforces this — hide the form so we don't tease a
  // button that will 400.
  const rsvpOpen = event.status === "published" && startMs > nowMs;

  const hostList = hosts.map((h) => h.display_name).join(" · ");

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/events" className="hover:underline">
          &larr; All events
        </Link>
      </nav>

      {event.status === "cancelled" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
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

      {coverUrl ? (
        <div className="aspect-[3/1] w-full overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {event.title}
        </h1>
        {hostList ? (
          <p className="text-sm text-muted-foreground">{hostList}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          <EventDate startsAt={event.starts_at} endsAt={event.ends_at} />
        </p>
        {event.location_text || event.location_url ? (
          <p className="text-sm text-muted-foreground">
            {event.location_url ? (
              <a
                href={event.location_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4"
              >
                {event.location_text ?? event.location_url}
              </a>
            ) : (
              event.location_text
            )}
          </p>
        ) : null}
      </header>

      {attendance ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          <span aria-hidden>✓</span> Checked in at{" "}
          {new Date(attendance.checked_in_at).toLocaleString()}.
        </div>
      ) : null}

      {!attendance && rsvp?.status === "going" && inCheckInWindow ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm text-foreground">
            You&apos;re going — time to check in.
          </p>
          <Button asChild>
            <Link href={`/events/${event.slug}/check-in`}>Check in</Link>
          </Button>
        </div>
      ) : null}

      <RsvpPanel
        eventId={event.id}
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

      <section className="rounded-md border p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Event capacity
        </h2>
        <p className="mt-1 text-sm">
          {event.capacity === null ? (
            <>{goingCount ?? 0} going</>
          ) : (
            <>
              {goingCount ?? 0} of {event.capacity} going
              {event.waitlist_enabled ? ` · Waitlist: ${waitlistedCount ?? 0}` : ""}
            </>
          )}
        </p>
      </section>

      {event.description_md ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            About this event
          </h2>
          <EventDescription md={event.description_md} />
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

