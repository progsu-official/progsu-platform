import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publishAnnouncement, unpublishAnnouncement } from "@/lib/actions/mobile-admin";
import { createClient } from "@/lib/supabase/server";
import { isoToZonedLocal, zonedLocalToIso } from "@/lib/time-zone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Announcements · Progsu Admin" };

const ZONE = "America/New_York";

function back(msg: string, isError = false): never {
  redirect(`/admin/announcements?${new URLSearchParams({ [isError ? "error" : "msg"]: msg })}`);
}

export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { msg, error } = await searchParams;
  const supabase = await createClient();
  const [{ data: rows }, { data: events }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, audience, priority, published_at, expires_at, event_id")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("events")
      .select("id, title, starts_at")
      .eq("status", "published")
      .gte("ends_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("starts_at")
      .limit(100),
  ]);

  async function publish(fd: FormData) {
    "use server";
    const s = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v.length ? v : null;
    };
    const expires = s("expiresAt");
    const res = await publishAnnouncement({
      title: s("title") ?? "",
      body: s("body") ?? "",
      audience: (s("audience") ?? "all") as "all" | "event_rsvps" | "hacklanta",
      eventId: s("eventId"),
      priority: (s("priority") ?? "normal") as "normal" | "important",
      deepLink: s("deepLink"),
      expiresAt: expires ? zonedLocalToIso(expires, ZONE) : null,
      push: fd.get("push") === "on",
    });
    if (!res.ok) back(res.error.message, true);
    back(`Published. ${res.data.queued} push notification(s) queued.`);
  }

  async function unpublish(fd: FormData) {
    "use server";
    const res = await unpublishAnnouncement(String(fd.get("id") ?? ""));
    if (!res.ok) back(res.error.message, true);
    back("Unpublished.");
  }

  const now = Date.now();
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Announcements</h1>
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}
      {msg ? <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">{msg}</div> : null}

      <form action={publish} className="space-y-3 rounded-xl border p-4">
        <Input name="title" required maxLength={120} placeholder="Title" />
        <textarea
          name="body"
          required
          maxLength={4000}
          rows={4}
          placeholder="Message"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Audience</span>
            <select name="audience" className="rounded-md border bg-background px-2 py-2">
              <option value="all">Everyone</option>
              <option value="event_rsvps">RSVPs of an event</option>
              <option value="hacklanta">Linked Hacklanta applicants</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Event (RSVP audience)</span>
            <select name="eventId" className="max-w-64 rounded-md border bg-background px-2 py-2">
              <option value="">—</option>
              {(events ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Priority</span>
            <select name="priority" className="rounded-md border bg-background px-2 py-2">
              <option value="normal">Normal</option>
              <option value="important">Important</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Expires (Atlanta time)</span>
            <Input name="expiresAt" type="datetime-local" />
          </label>
        </div>
        <Input name="deepLink" maxLength={500} placeholder="Deep link (optional): progsu://… or https://…" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="push" defaultChecked /> Send a push notification
        </label>
        <Button type="submit">Publish now</Button>
      </form>

      <ul className="divide-y rounded-xl border">
        {(rows ?? []).map((a) => {
          const live = a.published_at && (!a.expires_at || Date.parse(a.expires_at) > now);
          return (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <span className="font-medium">{a.title}</span>{" "}
                <span className="text-muted-foreground">
                  · {a.audience} · {a.priority} ·{" "}
                  {isoToZonedLocal(a.published_at, ZONE).replace("T", " ")}
                  {live ? "" : " · ended"}
                </span>
              </span>
              {live ? (
                <form action={unpublish}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" size="sm" variant="outline">
                    Unpublish
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
