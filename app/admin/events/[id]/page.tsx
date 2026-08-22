import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCoverUrl } from "@/lib/events/cover-url";
import { EVENT_TIME_ZONE, formatTimeRange } from "@/app/events/_components/event-date";
import { EventDescription } from "@/app/events/[slug]/_components/event-description";
import { CheckInInfoPopover } from "./_components/checkin-info-popover";
import { ScanQrButton } from "./_components/scan-qr-button";

import { DetailsTab } from "./details-tab";
import { GuestsTab } from "./guests-tab";
import { AnalyticsTab } from "./analytics-tab";
import { ActivityTab } from "./activity-tab";
import { TabNav } from "./tab-nav";
import type { EventRecord, GuestRsvpRow, RosterRow } from "./types";

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

export const dynamic = "force-dynamic";

// QR scanning opens inline via ScanQrButton below, not a separate route —
// the Attendees tab (key "guests" internally) already has the manual
// check-in/roster search a standalone check-in page would have duplicated.
// Access (invite-by-email) and Notifications (email toggles) were folded in
// here and into the Details composer respectively — see guests-tab.tsx and
// event-form.tsx.
type TabKey = "details" | "attendees" | "analytics" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "details", label: "Details" },
  { key: "attendees", label: "Attendees" },
  { key: "analytics", label: "Analytics" },
  { key: "activity", label: "Activity" },
];

function resolveTab(raw: string | undefined): TabKey {
  return (TABS.find((t) => t.key === raw)?.key ?? "details") as TabKey;
}

export default async function AdminEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab = resolveTab(rawTab);

  const admin = createAdminClient();

  const { data: event } = await admin
    .from("events")
    .select(
      "id, slug, title, description_md, status, visibility, starts_at, ends_at, location_text, location_url, capacity, waitlist_enabled, is_sensitive, cover_image_path, send_rsvp_email, send_reminder_email, reminder_sent_at, cancellation_reason, cancelled_at, published_at, archived_at, created_at, updated_at, import_source"
    )
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();

  const { data: hosts } = await admin
    .from("event_hosts")
    .select("display_name, profile_id, sort_order")
    .eq("event_id", id)
    .order("sort_order", { ascending: true });

  const ev: EventRecord = {
    id: event.id as string,
    slug: event.slug as string,
    title: event.title as string,
    description_md: (event.description_md as string | null) ?? null,
    status: event.status as EventRecord["status"],
    visibility: event.visibility as EventRecord["visibility"],
    starts_at: event.starts_at as string,
    ends_at: event.ends_at as string,
    location_text: (event.location_text as string | null) ?? null,
    location_url: (event.location_url as string | null) ?? null,
    capacity: (event.capacity as number | null) ?? null,
    waitlist_enabled: !!event.waitlist_enabled,
    is_sensitive: !!event.is_sensitive,
    cover_image_path: (event.cover_image_path as string | null) ?? null,
    send_rsvp_email: !!event.send_rsvp_email,
    send_reminder_email: !!event.send_reminder_email,
    reminder_sent_at: (event.reminder_sent_at as string | null) ?? null,
    cancellation_reason: (event.cancellation_reason as string | null) ?? null,
    cancelled_at: (event.cancelled_at as string | null) ?? null,
    published_at: (event.published_at as string | null) ?? null,
    archived_at: (event.archived_at as string | null) ?? null,
    created_at: event.created_at as string,
    updated_at: event.updated_at as string,
    import_source: (event.import_source as string | null) ?? null,
    hosts: (hosts ?? []).map((h) => ({
      display_name: h.display_name as string,
      profile_id: (h.profile_id as string | null) ?? null,
      sort_order: (h.sort_order as number | null) ?? 0,
    })),
  };

  const [
    coverUrl,
    { count: liveGoingCount },
    { count: waitlistedCount },
    { count: historicalGoingCount },
    { count: guestGoingCount },
  ] = await Promise.all([
    resolveCoverUrl(admin, ev.cover_image_path),
    admin
      .from("event_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .eq("status", "going"),
    admin
      .from("event_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .eq("status", "waitlisted"),
    admin
      .from("historical_event_attendances")
      .select("*", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .ilike("approval_status", "approved"),
    // Capacity is one shared pool across members + guests (2026-08-21
    // guest-RSVP decision), so the header count has to include guests or an
    // officer reads "0 going" on an event that already has registrations.
    // Direct table read is fine here: this is the service-role client.
    admin
      .from("event_guest_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .eq("status", "going"),
  ]);
  const goingCount =
    (liveGoingCount ?? 0) + (historicalGoingCount ?? 0) + (guestGoingCount ?? 0);

  const startDate = new Date(ev.starts_at);

  return (
    <div className="relative">
      {/* Same blown-up-cover ambience as the member detail page (see
          app/events/[slug]/page.tsx) but toned down for admin's flat, light
          "room" — a decorative wash, not the glass/ambient-field material,
          which admin surfaces deliberately don't share (DESIGN.md §0).
          `inset-x-0` instead of the member page's `w-screen`/`left-1/2` trick
          — this container sits inside the admin content column (offset by
          the fixed sidebar), not the full viewport, so centering on 100vw
          would overflow past the real right edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-2.5rem] -z-10 h-72 overflow-hidden"
      >
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full scale-125 object-cover opacity-15 blur-3xl saturate-150"
          />
        ) : (
          <div className="absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/85 to-background" />
      </div>

      <div className="space-y-6">
        <nav className="flex items-center justify-between gap-3">
          <Link
            href="/admin/events"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} aria-hidden />
            All events
          </Link>
          {/* Above the cover art, not tucked beside the title, so it's
              reachable the instant the page loads instead of after scrolling
              past the grid below. */}
          <div className="flex shrink-0 items-center gap-2">
            <ScanQrButton eventId={ev.id} />
            <CheckInInfoPopover />
          </div>
        </nav>

        <div className="grid gap-6 rounded-2xl border border-border/70 bg-card p-6 lg:grid-cols-[15rem_1fr] lg:gap-10 lg:p-8">
          {/* Left rail: cover art + hosts — mirrors the member page's left
              rail, flat instead of glassy. */}
          <div className="space-y-4">
            <div className="aspect-square w-full max-w-[15rem] overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted to-primary/20 shadow-lg shadow-black/5">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>

            {ev.hosts.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hosted by
                </h2>
                <ul className="space-y-1.5">
                  {ev.hosts.map((h) => (
                    <li
                      key={`${h.sort_order}-${h.display_name}`}
                      className="flex items-center gap-2.5 text-sm text-foreground"
                    >
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold uppercase text-primary"
                      >
                        {h.display_name.charAt(0)}
                      </span>
                      {h.display_name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {/* Right column: title, when/where, description — the "what a
              member sees" summary. Admin controls (publish/cancel/etc.) stay
              inside the Details tab below; this is read-only context. */}
          <div className="min-w-0 space-y-5">
            <div className="space-y-1">
              <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {ev.title}
              </h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users size={13} strokeWidth={1.75} aria-hidden />
                  {goingCount ?? 0} going
                  {ev.waitlist_enabled && (waitlistedCount ?? 0) > 0
                    ? ` · ${waitlistedCount} waitlisted`
                    : ""}
                </span>
                <span aria-hidden>·</span>
                <StatusText
                  status={ev.status}
                  past={
                    ev.status === "published" &&
                    new Date(ev.ends_at) < new Date()
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-3">
                <div
                  aria-hidden
                  className="w-11 shrink-0 overflow-hidden rounded-lg border border-border/70 text-center"
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
                    <time dateTime={ev.starts_at}>
                      {fullDateFormatter.format(startDate)}
                    </time>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatTimeRange(ev.starts_at, ev.ends_at)}
                  </p>
                </div>
              </div>

              {ev.location_text || ev.location_url ? (
                <div className="flex items-center gap-3">
                  <div
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/70"
                  >
                    <MapPin
                      size={17}
                      strokeWidth={1.75}
                      className="text-muted-foreground"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {ev.location_text ?? ev.location_url}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {ev.description_md ? (
              <section className="space-y-2 border-t border-border/60 pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  About this event
                </h2>
                <EventDescription md={ev.description_md} />
              </section>
            ) : null}
          </div>
        </div>

        <TabNav tabs={TABS} active={tab} eventId={ev.id} />

        <section className="mt-4">
          {tab === "details" ? (
            <DetailsTab event={ev} coverUrl={coverUrl} />
          ) : null}
          {tab === "attendees" ? <GuestsTabServer eventId={ev.id} event={ev} /> : null}
          {tab === "analytics" ? <AnalyticsTabServer eventId={ev.id} /> : null}
          {tab === "activity" ? <ActivityTabServer eventId={ev.id} /> : null}
        </section>
      </div>
    </div>
  );
}

function StatusText({
  status,
  past,
}: {
  status: string;
  past?: boolean;
}) {
  const tone =
    status === "published" && !past
      ? "text-primary"
      : status === "cancelled"
        ? "text-destructive"
        : "text-muted-foreground";
  // Same "published" -> "active"/"past" display mapping as the events list page.
  const label = status === "published" ? (past ? "past" : "active") : status;
  return (
    <span className={`text-xs font-medium uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

async function GuestsTabServer({
  eventId,
  event,
}: {
  eventId: string;
  event: EventRecord;
}) {
  const admin = createAdminClient();
  // Must use the user-context client because admin_event_roster_for()
  // checks public.is_admin(auth.uid()) server-side. Service-role has no
  // auth.uid() and the RPC would raise "admin only". The parent layout
  // has already gated on is_admin so the caller here is guaranteed admin.
  const supabase = await createClient();
  const [{ data, error }, { data: invites }, { data: guestRsvpData }] =
    await Promise.all([
      supabase.rpc("admin_event_roster_for", { p_event_id: eventId }),
      admin
        .from("event_invites")
        .select(
          "user_id, invited_by, invited_at, revoked_at, profiles!event_invites_user_id_fkey(first_name, last_name, google_email, student_email)"
        )
        .eq("event_id", eventId)
        .order("invited_at", { ascending: false }),
      // Same admin-only RPC pattern as admin_event_roster_for above.
      supabase.rpc("admin_event_guest_rsvps_for", { p_event_id: eventId }),
    ]);
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load roster: {error.message}
      </p>
    );
  }
  // RPC return isn't typed in the generated Database types, so coerce.
  const raw = (data ?? []) as Array<Record<string, unknown>>;
  const rows: RosterRow[] = raw.map((r) => ({
    user_id: (r.user_id as string | null) ?? null,
    first_name: (r.first_name as string | null) ?? null,
    last_name: (r.last_name as string | null) ?? null,
    preferred_name: (r.preferred_name as string | null) ?? null,
    google_email: (r.google_email as string | null) ?? null,
    student_email: (r.student_email as string | null) ?? null,
    rsvp_status: (r.rsvp_status as RosterRow["rsvp_status"]) ?? null,
    rsvp_comment: (r.rsvp_comment as string | null) ?? null,
    rsvp_changed_at: (r.rsvp_changed_at as string | null) ?? null,
    waitlisted_at: (r.waitlisted_at as string | null) ?? null,
    waitlist_position: (r.waitlist_position as number | null) ?? null,
    attended: !!r.attended,
    checked_in_at: (r.checked_in_at as string | null) ?? null,
    checked_in_by: (r.checked_in_by as string | null) ?? null,
    attendance_method: (r.attendance_method as string | null) ?? null,
    invited: !!r.invited,
    invited_by: (r.invited_by as string | null) ?? null,
    invited_at: (r.invited_at as string | null) ?? null,
    is_historical: !!r.is_historical,
    legacy_member_id: (r.legacy_member_id as string | null) ?? null,
    legacy_email: (r.legacy_email as string | null) ?? null,
  }));

  type ProfileRef = {
    first_name: string | null;
    last_name: string | null;
    google_email: string | null;
    student_email: string | null;
  };
  const inviteRows = (invites ?? []).map((i) => {
    // Supabase types the embedded relationship as an array; flatten it.
    const rel = i.profiles as ProfileRef | ProfileRef[] | null | undefined;
    const p: ProfileRef | null = Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
    return {
      user_id: i.user_id as string,
      invited_by: (i.invited_by as string | null) ?? null,
      invited_at: i.invited_at as string,
      revoked_at: (i.revoked_at as string | null) ?? null,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      email: p?.student_email ?? p?.google_email ?? null,
    };
  });

  const guestRsvpRows = (
    (guestRsvpData ?? []) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    phone: r.phone as string,
    status: r.status as GuestRsvpRow["status"],
    waitlisted_at: (r.waitlisted_at as string | null) ?? null,
    created_at: r.created_at as string,
    checkin_token: (r.checkin_token as string | null) ?? null,
    checked_in_at: (r.checked_in_at as string | null) ?? null,
  }));

  return (
    <GuestsTab
      eventId={eventId}
      event={event}
      rows={rows}
      invites={inviteRows}
      guestRsvps={guestRsvpRows}
    />
  );
}

async function AnalyticsTabServer({ eventId }: { eventId: string }) {
  // User-context client: admin_event_analytics_for writes an audit row via
  // write_audit(), so it must run in a POST (not a read-only) transaction
  // AND needs auth.uid() to pass the is_admin check.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_event_analytics_for", {
    p_event_id: eventId,
  });
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load analytics: {error.message}
      </p>
    );
  }
  return <AnalyticsTab data={data as Record<string, unknown>} />;
}

async function ActivityTabServer({ eventId }: { eventId: string }) {
  const admin = createAdminClient();
  // metadata->>'event_id' filter: JSON text comparison. Works for anything our
  // lifecycle helpers write. Keep the cap generous but bounded.
  const { data, error } = await admin
    .from("audit_log")
    .select("id, action, actor_user_id, target_user_id, metadata, created_at")
    .filter("metadata->>event_id", "eq", eventId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []).map((a) => ({
    id: a.id as string,
    action: a.action as string,
    actor_user_id: (a.actor_user_id as string | null) ?? null,
    target_user_id: (a.target_user_id as string | null) ?? null,
    metadata: a.metadata as unknown,
    created_at: a.created_at as string,
  }));
  return <ActivityTab rows={rows} error={error?.message ?? null} />;
}
