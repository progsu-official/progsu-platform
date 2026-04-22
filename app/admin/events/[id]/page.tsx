import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

import { DetailsTab } from "./details-tab";
import { AccessTab } from "./access-tab";
import { GuestsTab } from "./guests-tab";
import { NotificationsTab } from "./notifications-tab";
import { CheckInTab } from "./check-in-tab";
import { ActivityTab } from "./activity-tab";
import { TabNav } from "./tab-nav";
import type { EventRecord, RosterRow } from "./types";

export const dynamic = "force-dynamic";

type TabKey =
  | "details"
  | "access"
  | "guests"
  | "notifications"
  | "check-in"
  | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "details", label: "Details" },
  { key: "access", label: "Access" },
  { key: "guests", label: "Guests" },
  { key: "notifications", label: "Notifications" },
  { key: "check-in", label: "Check-in" },
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
      "id, slug, title, description_md, status, visibility, starts_at, ends_at, location_text, location_url, capacity, waitlist_enabled, is_sensitive, cover_image_path, check_in_code_hash, check_in_code_expires_at, send_rsvp_email, send_reminder_email, reminder_sent_at, cancellation_reason, cancelled_at, published_at, archived_at, created_at, updated_at"
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
    check_in_code_hash: (event.check_in_code_hash as string | null) ?? null,
    check_in_code_expires_at:
      (event.check_in_code_expires_at as string | null) ?? null,
    send_rsvp_email: !!event.send_rsvp_email,
    send_reminder_email: !!event.send_reminder_email,
    reminder_sent_at: (event.reminder_sent_at as string | null) ?? null,
    cancellation_reason: (event.cancellation_reason as string | null) ?? null,
    cancelled_at: (event.cancelled_at as string | null) ?? null,
    published_at: (event.published_at as string | null) ?? null,
    archived_at: (event.archived_at as string | null) ?? null,
    created_at: event.created_at as string,
    updated_at: event.updated_at as string,
    hosts: (hosts ?? []).map((h) => ({
      display_name: h.display_name as string,
      profile_id: (h.profile_id as string | null) ?? null,
      sort_order: (h.sort_order as number | null) ?? 0,
    })),
  };

  let coverUrl: string | null = null;
  if (ev.cover_image_path) {
    const { data: signed } = await admin.storage
      .from("event-covers")
      .createSignedUrl(ev.cover_image_path, 60 * 60);
    coverUrl = signed?.signedUrl ?? null;
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/events" className="hover:underline">
          &larr; All events
        </Link>
      </nav>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ev.title}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{ev.slug}</span> ·{" "}
            <StatusText status={ev.status} /> ·{" "}
            {new Date(ev.starts_at).toLocaleString()} &rarr;{" "}
            {new Date(ev.ends_at).toLocaleString()}
          </p>
        </div>
        <Link
          href={`/admin/events/${ev.id}/check-in`}
          className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent/10"
        >
          Day-of check-in &rarr;
        </Link>
      </header>

      <TabNav tabs={TABS} active={tab} eventId={ev.id} />

      <section className="mt-4">
        {tab === "details" ? (
          <DetailsTab event={ev} coverUrl={coverUrl} />
        ) : null}
        {tab === "access" ? <AccessTabServer eventId={ev.id} event={ev} /> : null}
        {tab === "guests" ? <GuestsTabServer eventId={ev.id} /> : null}
        {tab === "notifications" ? <NotificationsTab event={ev} /> : null}
        {tab === "check-in" ? <CheckInTab event={ev} /> : null}
        {tab === "activity" ? <ActivityTabServer eventId={ev.id} /> : null}
      </section>
    </div>
  );
}

function StatusText({ status }: { status: string }) {
  const tone =
    status === "published"
      ? "text-primary"
      : status === "cancelled"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span className={`font-medium uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  );
}

// Access tab loads invite list before rendering the client body.
async function AccessTabServer({
  eventId,
  event,
}: {
  eventId: string;
  event: EventRecord;
}) {
  const admin = createAdminClient();
  const { data: invites } = await admin
    .from("event_invites")
    .select(
      "user_id, invited_by, invited_at, revoked_at, profiles!event_invites_user_id_fkey(first_name, last_name, google_email, student_email)"
    )
    .eq("event_id", eventId)
    .order("invited_at", { ascending: false });

  type ProfileRef = {
    first_name: string | null;
    last_name: string | null;
    google_email: string | null;
    student_email: string | null;
  };
  const rows = (invites ?? []).map((i) => {
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

  return <AccessTab event={event} invites={rows} />;
}

async function GuestsTabServer({ eventId }: { eventId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_event_roster_for", {
    p_event_id: eventId,
  });
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
    user_id: r.user_id as string,
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
  }));

  return <GuestsTab eventId={eventId} rows={rows} />;
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
