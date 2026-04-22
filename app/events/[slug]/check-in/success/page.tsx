import Link from "next/link";
import { notFound } from "next/navigation";

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

  const { data: event } = await supabase
    .from("events")
    .select("slug, title")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const title = event.title as string;

  return (
    <div className="max-w-xl space-y-6">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-6 text-emerald-900 dark:text-emerald-200">
        <p className="text-lg font-semibold">
          <span aria-hidden>✓</span> Checked in to {title}
        </p>
        <p className="mt-1 text-sm">
          You&apos;re all set. Thanks for being here.
        </p>
      </div>

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
