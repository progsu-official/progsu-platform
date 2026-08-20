// Wall-clock <-> UTC helpers for the composer.
//
// The composer edits a date, a time, and an IANA zone as three independent
// values, then commits a single UTC instant. Doing that through `new Date()`
// alone would silently interpret the wall time in the *browser's* zone, which
// is wrong the moment an admin schedules an Atlanta event from a laptop set to
// another zone. Everything here goes through Intl, so no date library.

export const DEFAULT_TIME_ZONE = "America/New_York";

// Minutes to add to a UTC instant to get the zone's local wall time.
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - instantMs;
}

/** "2026-08-20" + "15:30" in `timeZone` -> UTC ISO string. */
export function wallTimeToUtcIso(
  date: string,
  time: string,
  timeZone: string
): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return "";
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // One correction pass lands the right instant; a second settles the hour
  // that repeats or vanishes at a DST boundary.
  let instant = naive - zoneOffsetMs(naive, timeZone);
  instant = naive - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** "GMT-04:00" for a zone, at the instant the composer is editing. */
export function gmtLabel(timeZone: string, instantMs: number): string {
  const offset = zoneOffsetMs(instantMs, timeZone);
  const total = Math.round(offset / 60000);
  const sign = total < 0 ? "-" : "+";
  const abs = Math.abs(total);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `GMT${sign}${hh}:${mm}`;
}

/** "America/New_York" -> "New York". */
export function zoneCity(timeZone: string): string {
  const tail = timeZone.split("/").pop() ?? timeZone;
  return tail.replace(/_/g, " ");
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

// --- date-only string helpers (no Date-in-local-zone traps) ---------------

export function toDateValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function parseDateValue(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(value: string, days: number): string {
  const d = parseDateValue(value);
  d.setDate(d.getDate() + days);
  return toDateValue(d);
}

const WEEKDAY_MONTH = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Thu, Aug 20" */
export function formatDateChip(value: string): string {
  if (!value) return "Pick a date";
  return WEEKDAY_MONTH.format(parseDateValue(value));
}

/** "03:00 AM" from "03:00" */
export function formatTimeChip(value: string): string {
  if (!value) return "--:--";
  const [hh, mm] = value.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** Every half hour of the day, as "HH:mm". */
export const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const hh = String(Math.floor(i / 2)).padStart(2, "0");
  const mm = i % 2 === 0 ? "00" : "30";
  return `${hh}:${mm}`;
});

/** Round up to the next half hour, in the given zone. */
export function nextHalfHour(now: Date): { date: string; time: string } {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30);
  return {
    date: toDateValue(d),
    time: `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`,
  };
}

export function addMinutesToTime(
  date: string,
  time: string,
  minutes: number
): { date: string; time: string } {
  const d = parseDateValue(date);
  const [hh, mm] = time.split(":").map(Number);
  d.setHours(hh, mm + minutes, 0, 0);
  return {
    date: toDateValue(d),
    time: `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`,
  };
}

export const POPULAR_TIME_ZONES: Array<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern Time - New York" },
  { id: "America/Chicago", label: "Central Time - Chicago" },
  { id: "America/Denver", label: "Mountain Time - Denver" },
  { id: "America/Los_Angeles", label: "Pacific Time - Los Angeles" },
  { id: "America/Toronto", label: "Eastern Time - Toronto" },
  { id: "Europe/London", label: "United Kingdom Time - London" },
  { id: "Europe/Paris", label: "Central European Time - Paris" },
  { id: "Asia/Kolkata", label: "India Standard Time - Kolkata" },
  { id: "Asia/Singapore", label: "Singapore Standard Time" },
  { id: "Asia/Tokyo", label: "Japan Standard Time - Tokyo" },
];

export function allTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      /* fall through */
    }
  }
  return POPULAR_TIME_ZONES.map((z) => z.id);
}
