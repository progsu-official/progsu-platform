import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { EventDate } from "../../_components/event-date";
import { CheckInForm } from "./check-in-form";

export const dynamic = "force-dynamic";

export default async function MemberCheckInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: event } = await supabase
    .from("events")
    .select("id, slug, title, starts_at, ends_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const eventId = event.id as string;
  const eventTitle = event.title as string;
  const eventSlug = event.slug as string;
  const startsAt = event.starts_at as string;
  const endsAt = event.ends_at as string;

  // Short-circuit if the member is already checked in. Avoids a P0001
  // "already checked in" on re-submission and gives them a friendly state.
  const { data: attendance } = await supabase
    .from("event_attendances")
    .select("checked_in_at")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Hosts are already member-visible via event_hosts RLS; loading them here
  // gives the "who's running this" context on both check-in states.
  const { data: hosts } = await supabase
    .from("event_hosts")
    .select("display_name, sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  const hostNames = (hosts ?? [])
    .map((h) => (h as { display_name: string }).display_name)
    .filter(Boolean);

  if (attendance) {
    const checkedInAt = (attendance as { checked_in_at: string }).checked_in_at;
    return (
      <div className="max-w-xl space-y-6">
        <nav className="text-xs text-muted-foreground">
          <Link href={`/events/${eventSlug}`} className="hover:underline">
            &larr; Back to event
          </Link>
        </nav>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            You&apos;re checked in — {eventTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            <EventDate startsAt={startsAt} endsAt={endsAt} />
          </p>
          <p className="text-xs text-muted-foreground">
            Checked in at {new Date(checkedInAt).toLocaleString()}
          </p>
        </header>

        {hostNames.length > 0 ? (
          <HostsCard names={hostNames} />
        ) : null}

        <Link
          href={`/events/${eventSlug}`}
          className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-accent/10"
        >
          Back to event
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link
          href={`/events/${eventSlug}`}
          className="hover:underline"
        >
          &larr; Back to event
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check in — {eventTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          <EventDate startsAt={startsAt} endsAt={endsAt} />
        </p>
        <p className="text-xs text-muted-foreground">
          Enter the code shared by the hosts at the door.
        </p>
      </header>

      {hostNames.length > 0 ? <HostsCard names={hostNames} /> : null}

      <CheckInForm eventId={eventId} eventSlug={eventSlug} />
    </div>
  );
}

function HostsCard({ names }: { names: string[] }) {
  return (
    <div className="rounded-md border bg-muted/20 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Hosted by
      </p>
      <p className="mt-1 text-sm">{names.join(" · ")}</p>
    </div>
  );
}
