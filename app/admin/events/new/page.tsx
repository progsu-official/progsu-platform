import Link from "next/link";
import { Instrument_Serif } from "next/font/google";
import { ArrowLeft } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";

import { NewEventForm } from "./new-event-form";

export const dynamic = "force-dynamic";

// The composer's one display face. Loaded here rather than in the root layout
// so it only ships on this route.
const display = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const RECENT_LOCATION_LIMIT = 4;

async function recentLocations(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("events")
    .select("location_text")
    .not("location_text", "is", null)
    .order("starts_at", { ascending: false })
    .limit(40);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    const value = row.location_text?.trim();
    if (value) seen.add(value);
    if (seen.size >= RECENT_LOCATION_LIMIT) break;
  }
  return [...seen];
}

export default async function AdminNewEventPage() {
  const locations = await recentLocations();

  return (
    // Full-bleed inside the admin shell: the composer is a canvas, not a card
    // sitting on one. `relative` matters — the form paints the selected theme
    // into this box, and `isolate` keeps that layer from sliding under the
    // admin chrome. The flat base is only the pre-hydration colour.
    <div
      className={`${display.variable} relative isolate -m-6 min-h-[calc(100vh-3rem)] bg-[#2E1240] px-6 py-8 lg:-m-8 lg:min-h-[calc(100vh-4rem)] lg:px-10 lg:py-10`}
    >
      <div className="mx-auto max-w-5xl">
        <Link
          href="/admin/events"
          className="mb-6 inline-flex items-center gap-2 rounded-lg text-sm text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
          All events
        </Link>
        <NewEventForm recentLocations={locations} />
      </div>
    </div>
  );
}
