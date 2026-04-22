import Link from "next/link";
import { notFound } from "next/navigation";

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

      <CheckInForm eventId={eventId} eventSlug={eventSlug} />
    </div>
  );
}
