import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  isStaffCheckinAuthed,
  staffCheckInByToken,
  staffCheckinLogin,
  staffCheckinLogout,
} from "@/lib/actions/checkin";
import { QrScanner } from "@/app/admin/events/[id]/_components/qr-scanner";

export const dynamic = "force-dynamic";

type UpcomingEvent = { id: string; title: string; starts_at: string };

// Door-staff check-in, no admin account. /checkin is a public middleware
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
      <div className="mx-auto max-w-sm space-y-4 p-6">
        <h1 className="text-lg font-semibold">Staff check-in</h1>
        <form action={login} className="space-y-3">
          <input
            name="token"
            type="text"
            placeholder="Check-in code"
            required
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Enter
          </button>
        </form>
      </div>
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

  return (
    <div className="mx-auto max-w-sm space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Staff check-in</h1>
        <form action={logout}>
          <button type="submit" className="text-xs text-muted-foreground underline">
            Log out
          </button>
        </form>
      </div>

      {selected ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">{selected.title}</p>
          <a href="/checkin" className="text-xs text-muted-foreground underline">
            Change event
          </a>
          <QrScanner eventId={selected.id} checkIn={staffCheckInByToken} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Pick an event to check people in:</p>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming events.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id}>
                  <a
                    href={`/checkin?event=${e.id}`}
                    className="block rounded-md border px-3 py-2 text-sm hover:bg-accent/10"
                  >
                    {e.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
