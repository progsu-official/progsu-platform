import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

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

  return (
    <div className="mx-auto max-w-sm space-y-5 py-14 text-center">
      {result.ok ? (
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

      <Button asChild variant="outline" className="h-11 rounded-full px-6">
        <Link href={`/events/${slug}`}>
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
          Event page
        </Link>
      </Button>
    </div>
  );
}
