import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createHacklantaEdition,
  deleteHacklantaItem,
  saveHacklantaEdition,
  saveHacklantaFloor,
  saveHacklantaRoom,
  saveHacklantaSession,
} from "@/lib/actions/mobile-admin";
import { createClient } from "@/lib/supabase/server";
import { isoToZonedLocal, zonedLocalToIso } from "@/lib/time-zone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hacklanta guide · Progsu Admin" };

// Admin CRUD for the Hacklanta event guide the iOS app reads. Bulk schedule
// loads go through scripts/import-hacklanta-schedule.ts; this page is for
// edits on the day. Times are entered in the edition's own time zone.

const sel = "rounded-md border bg-background px-2 py-2 text-sm";

function back(msg: string, isError = false, edition?: string): never {
  const p = new URLSearchParams({ [isError ? "error" : "msg"]: msg });
  if (edition) p.set("edition", edition);
  redirect(`/admin/hacklanta?${p}`);
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v.length ? v : null;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === null ? null : Number(v);
};

export default async function AdminHacklantaPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; edition?: string }>;
}) {
  const { msg, error, edition: editionParam } = await searchParams;
  const supabase = await createClient();
  const { data: editions } = await supabase
    .from("hacklanta_editions")
    .select("*")
    .order("starts_at", { ascending: false });
  const edition = (editions ?? []).find((e) => e.slug === editionParam) ?? (editions ?? [])[0] ?? null;

  async function create(fd: FormData) {
    "use server";
    const tz = "America/New_York";
    const res = await createHacklantaEdition({
      slug: str(fd, "slug") ?? "",
      name: str(fd, "name") ?? "",
      startsAt: zonedLocalToIso(str(fd, "startsAt") ?? "", tz) ?? "",
      endsAt: zonedLocalToIso(str(fd, "endsAt") ?? "", tz) ?? "",
    });
    if (!res.ok) back(res.error.message, true);
    back("Edition created.");
  }

  if (!edition) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Hacklanta guide</h1>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <form action={create} className="flex flex-wrap items-end gap-2 rounded-xl border p-4">
          <Input name="slug" required placeholder="slug" className="w-40" />
          <Input name="name" required placeholder="Name" className="w-48" />
          <Input name="startsAt" type="datetime-local" required />
          <Input name="endsAt" type="datetime-local" required />
          <Button type="submit">Create edition</Button>
        </form>
      </div>
    );
  }

  const tz = edition.time_zone as string;
  const editionId = edition.id as string;
  const slug = edition.slug as string;
  const [{ data: floors }, { data: rooms }, { data: sessions }] = await Promise.all([
    supabase.from("hacklanta_floors").select("*").eq("edition_id", editionId).order("sort"),
    supabase.from("hacklanta_rooms").select("*").eq("edition_id", editionId).order("name"),
    supabase.from("hacklanta_sessions").select("*").eq("edition_id", editionId).order("starts_at").order("key"),
  ]);

  async function saveEdition(fd: FormData) {
    "use server";
    const res = await saveHacklantaEdition({
      id: editionId,
      name: str(fd, "name") ?? "",
      startsAt: zonedLocalToIso(str(fd, "startsAt") ?? "", tz) ?? "",
      endsAt: zonedLocalToIso(str(fd, "endsAt") ?? "", tz) ?? "",
      timeZone: str(fd, "timeZone") ?? tz,
      venueName: str(fd, "venueName"),
      venueAddress: str(fd, "venueAddress"),
      lat: num(fd, "lat"),
      lng: num(fd, "lng"),
      themeOverride: (str(fd, "themeOverride") ?? "auto") as "auto" | "force_on" | "force_off",
      scheduleTentative: fd.get("scheduleTentative") === "on",
      published: fd.get("published") === "on",
    });
    if (!res.ok) back(res.error.message, true, slug);
    back("Edition saved.", false, slug);
  }

  async function saveFloor(fd: FormData) {
    "use server";
    const file = fd.get("image");
    const res = await saveHacklantaFloor(
      { editionId, floorId: str(fd, "floorId"), name: str(fd, "name") ?? "", sort: num(fd, "sort") ?? 0 },
      file instanceof File ? file : null
    );
    if (!res.ok) back(res.error.message, true, slug);
    back("Floor saved.", false, slug);
  }

  async function saveRoom(fd: FormData) {
    "use server";
    const res = await saveHacklantaRoom({
      editionId,
      roomId: str(fd, "roomId"),
      floorId: str(fd, "floorId"),
      name: str(fd, "name") ?? "",
      kind: str(fd, "kind") ?? "room",
      description: str(fd, "description"),
      x: num(fd, "x"),
      y: num(fd, "y"),
    });
    if (!res.ok) back(res.error.message, true, slug);
    back("Room saved.", false, slug);
  }

  async function saveSession(fd: FormData) {
    "use server";
    const ends = str(fd, "endsAt");
    const res = await saveHacklantaSession({
      editionId,
      sessionId: str(fd, "sessionId"),
      key: str(fd, "key") ?? "",
      title: str(fd, "title") ?? "",
      description: str(fd, "description"),
      kind: str(fd, "kind") ?? "session",
      track: str(fd, "track"),
      roomId: str(fd, "roomId"),
      roomLabel: str(fd, "roomLabel"),
      startsAt: zonedLocalToIso(str(fd, "startsAt") ?? "", tz) ?? "",
      endsAt: ends ? zonedLocalToIso(ends, tz) : null,
      status: (str(fd, "status") ?? "scheduled") as "scheduled" | "cancelled" | "moved",
      pointsNote: str(fd, "pointsNote"),
    });
    if (!res.ok) back(res.error.message, true, slug);
    back("Session saved.", false, slug);
  }

  async function remove(fd: FormData) {
    "use server";
    const res = await deleteHacklantaItem(
      (str(fd, "table") ?? "") as "floors" | "rooms" | "sessions",
      str(fd, "id") ?? ""
    );
    if (!res.ok) back(res.error.message, true, slug);
    back("Deleted.", false, slug);
  }

  const roomOptions = (rooms ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Hacklanta guide</h1>
        <span className="text-sm text-muted-foreground">
          {edition.published_at ? "Published" : "Not published"} · times in {tz}
        </span>
      </div>
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}
      {msg ? <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">{msg}</div> : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Edition</h2>
        <form action={saveEdition} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-2">
          <Input name="name" defaultValue={edition.name} required />
          <Input name="timeZone" defaultValue={tz} required />
          <label className="text-xs text-muted-foreground">
            Starts
            <Input name="startsAt" type="datetime-local" defaultValue={isoToZonedLocal(edition.starts_at, tz)} required />
          </label>
          <label className="text-xs text-muted-foreground">
            Ends
            <Input name="endsAt" type="datetime-local" defaultValue={isoToZonedLocal(edition.ends_at, tz)} required />
          </label>
          <Input name="venueName" defaultValue={edition.venue_name ?? ""} placeholder="Venue" />
          <Input name="venueAddress" defaultValue={edition.venue_address ?? ""} placeholder="Address" />
          <Input name="lat" type="number" step="any" defaultValue={edition.lat ?? ""} placeholder="Latitude (verified only)" />
          <Input name="lng" type="number" step="any" defaultValue={edition.lng ?? ""} placeholder="Longitude (verified only)" />
          <label className="text-xs text-muted-foreground">
            App theme
            <select name="themeOverride" defaultValue={edition.theme_override} className={`${sel} block w-full`}>
              <option value="auto">Auto (7 days before → end)</option>
              <option value="force_on">Force on</option>
              <option value="force_off">Force off</option>
            </select>
          </label>
          <div className="flex flex-col justify-end gap-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="scheduleTentative" defaultChecked={edition.schedule_tentative} /> Schedule is tentative
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="published" defaultChecked={Boolean(edition.published_at)} /> Published (visible in the app)
            </label>
          </div>
          <div>
            <Button type="submit">Save edition</Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Floors</h2>
        {[...(floors ?? []), null].map((f) => (
          <form key={f?.id ?? "new"} action={saveFloor} className="flex flex-wrap items-end gap-2 rounded-xl border p-3">
            {f ? <input type="hidden" name="floorId" value={f.id} /> : null}
            <Input name="name" defaultValue={f?.name ?? ""} placeholder="New floor name" required className="w-48" />
            <Input name="sort" type="number" defaultValue={f?.sort ?? 0} className="w-20" aria-label="Sort" />
            <label className="text-xs text-muted-foreground">
              Floor plan (PNG/JPEG/WebP, ≤5 MB){f?.image_path ? ` · v${f.version} uploaded` : ""}
              <input name="image" type="file" accept="image/png,image/jpeg,image/webp" className="block text-sm" />
            </label>
            <Button type="submit" size="sm">{f ? "Save" : "Add floor"}</Button>
            {f ? (
              <Button type="submit" size="sm" variant="outline" formAction={remove} name="table" value="floors">
                Delete
              </Button>
            ) : null}
            {f ? <input type="hidden" name="id" value={f.id} /> : null}
          </form>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Rooms</h2>
        {[...(rooms ?? []), null].map((r) => (
          <form key={r?.id ?? "new"} action={saveRoom} className="flex flex-wrap items-end gap-2 rounded-xl border p-3">
            {r ? <input type="hidden" name="roomId" value={r.id} /> : null}
            {r ? <input type="hidden" name="id" value={r.id} /> : null}
            <Input name="name" defaultValue={r?.name ?? ""} placeholder="New room name" required className="w-48" />
            <Input name="kind" defaultValue={r?.kind ?? "room"} className="w-28" aria-label="Kind" />
            <select name="floorId" defaultValue={r?.floor_id ?? ""} className={sel} aria-label="Floor">
              <option value="">No floor</option>
              {(floors ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <Input name="x" type="number" step="any" min={0} max={1} defaultValue={r?.x ?? ""} placeholder="x 0–1" className="w-20" />
            <Input name="y" type="number" step="any" min={0} max={1} defaultValue={r?.y ?? ""} placeholder="y 0–1" className="w-20" />
            <Input name="description" defaultValue={r?.description ?? ""} placeholder="Description" className="w-64" />
            <Button type="submit" size="sm">{r ? "Save" : "Add room"}</Button>
            {r ? (
              <Button type="submit" size="sm" variant="outline" formAction={remove} name="table" value="rooms">
                Delete
              </Button>
            ) : null}
          </form>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Sessions ({(sessions ?? []).length})</h2>
        {[...(sessions ?? []), null].map((s) => (
          <form key={s?.id ?? "new"} action={saveSession} className="flex flex-wrap items-end gap-2 rounded-xl border p-3">
            {s ? <input type="hidden" name="sessionId" value={s.id} /> : null}
            {s ? <input type="hidden" name="id" value={s.id} /> : null}
            <Input name="key" defaultValue={s?.key ?? ""} placeholder="key" required className="w-36" />
            <Input name="title" defaultValue={s?.title ?? ""} placeholder="Title" required className="w-64" />
            <Input name="kind" defaultValue={s?.kind ?? "session"} className="w-28" aria-label="Kind" />
            <Input name="track" defaultValue={s?.track ?? ""} placeholder="Track" className="w-28" />
            <Input name="startsAt" type="datetime-local" defaultValue={isoToZonedLocal(s?.starts_at, tz)} required />
            <Input name="endsAt" type="datetime-local" defaultValue={isoToZonedLocal(s?.ends_at, tz)} />
            <Input name="roomLabel" defaultValue={s?.room_label ?? ""} placeholder="Room (text)" className="w-40" />
            <select name="roomId" defaultValue={s?.room_id ?? ""} className={sel} aria-label="Mapped room">
              <option value="">No mapped room</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select name="status" defaultValue={s?.status ?? "scheduled"} className={sel} aria-label="Status">
              <option value="scheduled">Scheduled</option>
              <option value="moved">Moved</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <Input name="pointsNote" defaultValue={s?.points_note ?? ""} placeholder="Prize note (display only)" className="w-48" />
            <Input name="description" defaultValue={s?.description ?? ""} placeholder="Description" className="w-full" />
            <Button type="submit" size="sm">{s ? "Save" : "Add session"}</Button>
            {s ? (
              <Button type="submit" size="sm" variant="outline" formAction={remove} name="table" value="sessions">
                Delete
              </Button>
            ) : null}
          </form>
        ))}
      </section>
    </div>
  );
}
