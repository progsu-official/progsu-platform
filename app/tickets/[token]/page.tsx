import Link from "next/link";
import type { Metadata } from "next";
import QRCode from "qrcode";
import { z } from "zod";
import { ArrowUpRight, MapPin, Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrl } from "@/lib/events/cover-url";

import { EVENT_TIME_ZONE, formatTimeRange } from "@/app/events/_components/event-date";
import { QrCenterMark } from "@/app/events/_components/qr-center-mark";

const LINK_BUTTON = "h-11 flex-1 rounded-full";

export const dynamic = "force-dynamic";

// A ticket URL is a bearer credential in a query-free path segment. Keeping it
// out of search indexes is the cheap half of not leaking it.
export const metadata: Metadata = {
  title: "Your ticket",
  robots: { index: false, follow: false },
};

// Public guest ticket, no session required (2026-08-21 guest-ticket decision,
// modelled on Luma's hosted `/e/ticket/...` page). The opaque checkin_token in
// the path IS the credential: guest_ticket_by_token() is anon-callable,
// SECURITY DEFINER, and returns only the holder's own name/email plus the
// event's already-public detail fields. Nothing about the rest of the guest
// list is reachable from here.

type TicketRow = {
  guest_name: string;
  guest_email: string;
  event_title: string;
  event_slug: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  location_url: string | null;
  cover_image_path: string | null;
  status: "going" | "waitlisted" | "cancelled";
  checked_in: boolean;
  checked_in_at: string | null;
};

const tokenSchema = z.string().uuid();

const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const checkedInFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function GuestTicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Trust boundary: a non-uuid path segment would make Postgres raise on the
  // cast rather than return an empty set, so reject it here and skip the trip.
  const parsedToken = tokenSchema.safeParse(token);
  if (!parsedToken.success) return <TicketNotFound />;

  const supabase = await createClient();
  const { data } = await supabase
    .rpc("guest_ticket_by_token", { p_token: parsedToken.data })
    .maybeSingle();
  if (!data) return <TicketNotFound />;

  const ticket = data as unknown as TicketRow;
  const coverUrl = await resolveCoverUrl(supabase, ticket.cover_image_path);
  const startsAt = new Date(ticket.starts_at);

  // ECC level H so the code still decodes with the cover art (or brand glyph)
  // over its middle, same setting as the member ticket's QR.
  const qrDataUrl = await QRCode.toDataURL(parsedToken.data, {
    errorCorrectionLevel: "H",
    margin: 0,
    width: 640,
    color: { dark: "#18181b", light: "#ffffff" },
  });

  const checkedIn = ticket.checked_in;

  return (
    <div className="animate-fade-up motion-reduce:animate-none space-y-4">
      <p className="pb-1 text-center text-[13px] font-semibold tracking-tight text-muted-foreground">
        progsu
      </p>

      {/* Event summary. Small on purpose: the holder already knows what they
          registered for, and the QR below is what this page is for. */}
      <section className="rounded-2xl glass p-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <time dateTime={ticket.starts_at}>
                {longDateFormatter.format(startsAt)}
              </time>
            </p>
            <h1 className="text-pretty text-[19px] font-semibold leading-snug tracking-tight text-foreground">
              {ticket.event_title}
            </h1>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatTimeRange(ticket.starts_at, ticket.ends_at)}
            </p>
            {ticket.location_text ? (
              <p className="flex items-start gap-1.5 pt-0.5 text-sm text-muted-foreground">
                <MapPin
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden
                  className="mt-[3px] shrink-0"
                />
                <span className="min-w-0">{ticket.location_text}</span>
              </p>
            ) : null}
          </div>

          {coverUrl ? (
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* The ticket itself. */}
      <section
        aria-label="Your ticket"
        className="space-y-5 rounded-2xl glass p-5"
      >
        <div className="relative mx-auto w-full max-w-[15rem] rounded-2xl bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={checkedIn ? "" : "Your check-in QR code"}
            className={
              "h-auto w-full rounded-md " +
              (checkedIn ? "opacity-20 saturate-0" : "")
            }
          />
          {checkedIn ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="-rotate-12 rounded-lg border-[3px] border-emerald-600 px-3.5 py-1.5 text-sm font-extrabold uppercase tracking-[0.18em] text-emerald-600">
                Checked in
              </span>
            </div>
          ) : (
            <QrCenterMark coverUrl={coverUrl} />
          )}
        </div>

        <div className="space-y-0.5 text-center">
          <p className="text-[17px] font-semibold tracking-tight text-foreground">
            {ticket.guest_name}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {ticket.guest_email}
          </p>
        </div>

        {checkedIn ? (
          <p
            role="status"
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-center text-sm text-emerald-700 dark:text-emerald-300"
          >
            {ticket.checked_in_at
              ? `Checked in ${checkedInFormatter.format(new Date(ticket.checked_in_at))}. See you in there.`
              : "You're already checked in. See you in there."}
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Show this at the door and staff will scan you in.
          </p>
        )}

        <div className="flex gap-2">
          {ticket.location_url ? (
            <Button asChild variant="outline" className={LINK_BUTTON}>
              <a
                href={ticket.location_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Navigation size={15} strokeWidth={1.75} aria-hidden />
                Get directions
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline" className={LINK_BUTTON}>
            <Link href={`/events/${ticket.event_slug}`}>
              Event page
              <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

// Not a notFound() call: the likeliest reason someone lands here without a
// match is a cancelled registration or a re-registered email (both clear the
// token), and "this link no longer works, here's where to go" is a more useful
// answer than the framework 404 page.
function TicketNotFound() {
  return (
    <div className="animate-fade-up motion-reduce:animate-none space-y-4 rounded-2xl glass p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        This ticket link isn&apos;t valid
      </h1>
      <p className="text-sm text-muted-foreground">
        It may have expired, or the registration it belonged to was cancelled.
        Register again from the event page and you&apos;ll get a fresh ticket by
        email.
      </p>
      <Button asChild variant="outline" className="h-11 rounded-full px-6">
        <Link href="/events">
          Browse events
          <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
