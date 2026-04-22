import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function CheckInSuccessPage({
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
    .select("id, slug, title, starts_at, ends_at, location_text")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const title = event.title as string;
  const eventId = event.id as string;
  const endsAt = event.ends_at as string;
  const locationText = (event.location_text as string | null) ?? null;

  const [{ data: attendance }, { data: hosts }] = await Promise.all([
    supabase
      .from("event_attendances")
      .select("checked_in_at")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("event_hosts")
      .select("display_name, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true }),
  ]);
  const checkedInAt = (attendance as { checked_in_at: string } | null)?.checked_in_at ?? null;
  const hostNames = (hosts ?? [])
    .map((h) => (h as { display_name: string }).display_name)
    .filter(Boolean);

  const eventOngoing = new Date(endsAt).getTime() > Date.now();

  return (
    <div className="max-w-xl space-y-6">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-6 text-emerald-900 dark:text-emerald-200">
        <p className="text-lg font-semibold">
          <span aria-hidden>✓</span> Checked in to {title}
        </p>
        {checkedInAt ? (
          <p className="mt-1 text-xs opacity-80">
            Checked in at {new Date(checkedInAt).toLocaleString()}
          </p>
        ) : null}
        <p className="mt-2 text-sm">
          You&apos;re all set. Thanks for being here.
        </p>
      </div>

      {hostNames.length > 0 ? (
        <div className="rounded-md border bg-muted/20 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Hosted by
          </p>
          <p className="mt-1 text-sm">{hostNames.join(" · ")}</p>
        </div>
      ) : null}

      {eventOngoing && locationText ? (
        <div className="rounded-md border px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Location
          </p>
          <p className="mt-1">{locationText}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/events/${slug}`}>Back to event</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/events?tab=my-plans">My plans</Link>
        </Button>
      </div>
    </div>
  );
}
