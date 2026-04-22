import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

import { DayOfRoster } from "./day-of-roster";

export const dynamic = "force-dynamic";

type RosterRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  student_email: string | null;
  google_email: string | null;
  rsvp_status: string | null;
  attended: boolean;
  checked_in_at: string | null;
};

export default async function AdminEventCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("events")
    .select("id, title, slug, starts_at, ends_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();

  const { data: roster } = await admin.rpc("admin_event_roster_for", {
    p_event_id: id,
  });

  // Focused day-of view: show everyone who's "going" plus anyone already
  // attended (e.g. walk-ins). Drop waitlisted/declined — they go through the
  // full Guests tab.
  const rawRoster = (roster ?? []) as Array<Record<string, unknown>>;
  const rows: RosterRow[] = rawRoster
    .filter((r) => r.rsvp_status === "going" || r.attended === true)
    .map((r) => ({
      user_id: r.user_id as string,
      first_name: (r.first_name as string | null) ?? null,
      last_name: (r.last_name as string | null) ?? null,
      preferred_name: (r.preferred_name as string | null) ?? null,
      student_email: (r.student_email as string | null) ?? null,
      google_email: (r.google_email as string | null) ?? null,
      rsvp_status: (r.rsvp_status as string | null) ?? null,
      attended: !!r.attended,
      checked_in_at: (r.checked_in_at as string | null) ?? null,
    }));

  const attendedCount = rows.filter((r) => r.attended).length;
  const goingCount = rows.length;

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link
          href={`/admin/events/${event.id}`}
          className="hover:underline"
        >
          &larr; Back to event
        </Link>
      </nav>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {event.title} — Check-in
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date(event.starts_at as string).toLocaleString()} &rarr;{" "}
            {new Date(event.ends_at as string).toLocaleString()}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{attendedCount}</span>{" "}
          / {goingCount} checked in
        </p>
      </header>

      <DayOfRoster eventId={event.id as string} rows={rows} />
    </div>
  );
}
