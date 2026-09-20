import { redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  isStaffCheckinAuthed,
  staffCheckInByToken,
  staffCheckinLogin,
  staffCheckinLogout,
  staffEventAttendees,
} from "@/lib/actions/checkin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanner } from "@/app/admin/events/[id]/_components/qr-scanner";
import { ShowCheckinQrButton } from "@/app/admin/events/[id]/_components/show-checkin-qr-button";
import { CheckinThemeShell } from "./_components/theme-toggle-shell";
import { StaffAttendeeSection } from "./_components/staff-attendee-actions";

export const dynamic = "force-dynamic";

type UpcomingEvent = { id: string; slug: string; title: string; starts_at: string };

// Staff check-in, no admin account. /checkin is a public middleware
// path (self-auths via the STAFF_CHECKIN_TOKEN cookie, same pattern as
// /tickets and /joined) — see lib/actions/checkin.ts.
export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const authed = await isStaffCheckinAuthed();
  const { event: eventId } = await searchParams;

  if (!authed) {
    async function login(formData: FormData) {
      "use server";
      const token = String(formData.get("token") ?? "");
      const r = await staffCheckinLogin(token);
      if (r.ok) redirect("/checkin");
    }

    return (
      <CheckinThemeShell>
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
            <div className="space-y-1.5 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck size={20} strokeWidth={1.75} className="text-primary" aria-hidden />
              </div>
              <h1 className="text-lg font-semibold text-foreground">Staff check-in</h1>
              <p className="text-sm text-muted-foreground">
                Enter the staff token to continue.
              </p>
            </div>
            <form action={login} className="space-y-3">
              <Input
                name="token"
                type="text"
                placeholder="Private token"
                required
                className="rounded-xl"
              />
              <Button type="submit" className="w-full rounded-xl">
                Enter
              </Button>
            </form>
          </div>
        </div>
      </CheckinThemeShell>
    );
  }

  async function logout() {
    "use server";
    await staffCheckinLogout();
    redirect("/checkin");
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("public_upcoming_events", { p_limit: 50 });
  const events = (data ?? []) as UpcomingEvent[];
  const selected = events.find((e) => e.id === eventId) ?? null;

  const attendeesResult = selected
    ? await staffEventAttendees(selected.id)
    : null;
  const attendees = attendeesResult?.ok ? attendeesResult.data : [];

  // D14: door staff run this page without an admin account, so the
  // fullscreen self-serve QR (otherwise only on /admin/events/[id]) needs to
  // be reachable from here too — same ShowCheckinQrButton, generated the
  // same way as the admin page.
  const checkinQrDataUrl = selected
    ? await QRCode.toDataURL(
        `${env.NEXT_PUBLIC_SITE_URL}/events/${selected.slug}/check-in`,
        {
          errorCorrectionLevel: "H",
          margin: 0,
          width: 640,
          color: { dark: "#18181b", light: "#ffffff" },
        }
      )
    : null;

  return (
    <CheckinThemeShell>
      <div
        className={`mx-auto space-y-6 p-6 ${selected ? "max-w-3xl" : "max-w-md"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays
              size={18}
              strokeWidth={1.75}
              className="text-muted-foreground"
              aria-hidden
            />
            <h1 className="text-lg font-semibold">Staff check-in</h1>
          </div>
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <LogOut size={14} strokeWidth={1.75} aria-hidden />
              Log out
            </Button>
          </form>
        </div>

        {selected ? (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Checking in for
                </p>
                <p className="truncate text-base font-semibold text-foreground">
                  {selected.title}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
                {checkinQrDataUrl ? (
                  <ShowCheckinQrButton
                    qrDataUrl={checkinQrDataUrl}
                    eventTitle={selected.title}
                    triggerClassName="w-full sm:w-auto"
                  />
                ) : null}
                <Button asChild variant="outline" size="sm" className="w-full gap-1.5 sm:w-auto">
                  <a href="/checkin">
                    <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
                    Change event
                  </a>
                </Button>
              </div>
            </div>
            <QrScanner eventId={selected.id} checkIn={staffCheckInByToken} />
            <StaffAttendeeSection eventId={selected.id} rows={attendees} />
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
            <p className="text-sm text-muted-foreground">
              Pick an event to check people in.
            </p>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming events.</p>
            ) : (
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id}>
                    <a
                      href={`/checkin?event=${e.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-accent/10"
                    >
                      <span className="min-w-0 truncate font-medium">{e.title}</span>
                      <ChevronRight
                        size={16}
                        strokeWidth={1.75}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </CheckinThemeShell>
  );
}
