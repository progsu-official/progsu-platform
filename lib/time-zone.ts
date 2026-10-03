// Wall-clock <-> instant conversion for a named zone, for admin forms whose
// <input type="datetime-local"> values mean "Atlanta time", not server time.

function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

// "2026-10-09T15:00" in `zone` -> ISO instant. Returns null for bad input.
export function zonedLocalToIso(local: string, zone: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = naive - offsetMinutes(zone, new Date(naive)) * 60000;
  guess = naive - offsetMinutes(zone, new Date(guess)) * 60000;
  return new Date(guess).toISOString();
}

// ISO instant -> "YYYY-MM-DDTHH:mm" wall clock in `zone`.
export function isoToZonedLocal(iso: string | null | undefined, zone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const local = new Date(d.getTime() + offsetMinutes(zone, d) * 60000);
  return local.toISOString().slice(0, 16);
}
