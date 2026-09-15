import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, CheckCircle2, XCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { selfCheckInToEvent } from "@/lib/actions/events";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// D14: landing page for the admin-projected event QR. No auth check here —
// this route lives under /events, so middleware.ts already bounces an
// unauthenticated scanner to /login?next=/events/[slug]/check-in before this
// ever renders, same as any other /events/* page. Being signed in by the
// time we get here IS the check-in credential; see self_check_in_by_event().
export default async function SelfCheckInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const result = await selfCheckInToEvent(event.id as string);

  // Three outcomes, not two: a failed RPC call (result.ok === false) is a
  // real error (unauthenticated, event not open, etc.), but result.ok with
  // rsvpd === false is the RPC working correctly and declining — no staff at
  // this surface to wave a walk-in through, so they go RSVP first instead.
  const needsRsvp = result.ok && !result.data.rsvpd;

  return (
    <div className="mx-auto max-w-sm space-y-5 py-14 text-center">
      {needsRsvp ? (
        <>
          <CalendarCheck
            size={56}
            strokeWidth={1.5}
            className="mx-auto text-primary"
            aria-hidden
          />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              RSVP to check in
            </h1>
            <p className="text-sm text-muted-foreground">
              You haven&apos;t RSVP&apos;d to {event.title as string} yet.
              RSVP on the event page, then rescan this code.
            </p>
            <p className="text-xs text-muted-foreground">
              Confirm your RSVP to boost your Progsu ranking.
            </p>
          </div>
        </>
      ) : result.ok ? (
        <>
          <CheckCircle2
            size={56}
            strokeWidth={1.5}
            className="mx-auto text-emerald-500"
            aria-hidden
          />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {result.data.already ? "Already checked in" : "You're checked in"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {event.title as string}
            </p>
            {result.data.already ? null : (
              // D14 side note: the ranking boost itself is an exec-side
              // system outside this codebase, and it's keyed off a
              // staff-confirmed check-in specifically — this self-scan is
              // provisional until staff confirms it, so say that rather than
              // imply the boost already landed.
              <p className="text-xs text-muted-foreground">
                Ranking credit finalizes once staff confirms your check-in at
                the door.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <XCircle
            size={56}
            strokeWidth={1.5}
            className="mx-auto text-destructive"
            aria-hidden
          />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Couldn&apos;t check you in
            </h1>
            <p className="text-sm text-muted-foreground">
              {result.error.message}
            </p>
          </div>
        </>
      )}

      <Button asChild variant={needsRsvp ? "default" : "outline"} className="h-11 rounded-full px-6">
        <Link href={`/events/${slug}`}>
          {needsRsvp ? null : <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />}
          {needsRsvp ? "RSVP now" : "Event page"}
        </Link>
      </Button>
    </div>
  );
}
