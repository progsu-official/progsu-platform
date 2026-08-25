// The RSVP embed. Pure — no database, no fetch, no env — so
// scripts/preview-discord-rsvp.ts renders the real builder rather than a mock
// of it.
//
// The layout is lifted from hacklanta-ii's application alert, because that
// one is proportioned right and this one was not. Two rules do most of the
// work:
//
//   1. **Exactly three inline fields.** Discord lays inline fields out three
//      to a row. Two fields become two lopsided halves; four wrap to a lonely
//      orphan. Three is the only count that fills the row evenly, which is
//      why "Came from" now says "Direct" instead of disappearing.
//   2. **Short values in those fields, everything wide in the description.**
//      An inline field is a third of the embed. A full date wraps to three
//      lines in one and looks broken; a relative "in 6 days" does not.
//
// The progress bar lives in the description, bolded, in █/░ at 14 slots —
// same as the hacklanta recap. Bold blocks are heavier than ▰▱ and land on
// the same width as the text above them instead of floating.

import type { WebhookMessage } from "./webhook";

export type RsvpAlertKind = "going" | "waitlisted" | "cancelled";

export type RsvpAlertEvent = {
  title: string;
  url: string;
  startsAt: string;
  locationText: string | null;
  capacity: number | null;
  goingCount: number;
  waitlistedCount: number;
};

export type RsvpAlertCampaign = {
  slug: string;
  label: string;
};

export type RsvpAlert = {
  kind: RsvpAlertKind;
  /** Already reduced to a public-safe form by the caller. */
  attendeeName: string;
  /** Guest RSVPs are the signal that a non-member found us. Worth a badge. */
  isGuest: boolean;
  event: RsvpAlertEvent;
  /** The campaign link this browser arrived through, if any. */
  campaign: RsvpAlertCampaign | null;
};

// hsl(262 83% 58%) — the --primary token in app/globals.css.
export const BRAND_VIOLET = 0x7c3aed;
export const BRAND_AMBER = 0xf59e0b;
export const BRAND_SLATE = 0x64748b;

const COLORS: Record<RsvpAlertKind, number> = {
  going: BRAND_VIOLET,
  waitlisted: BRAND_AMBER,
  cancelled: BRAND_SLATE,
};

const HEADINGS: Record<RsvpAlertKind, string> = {
  going: "New RSVP",
  waitlisted: "Joined the waitlist",
  cancelled: "RSVP cancelled",
};

const LEADS: Record<RsvpAlertKind, string> = {
  going: "Going to",
  waitlisted: "In line for",
  cancelled: "Dropped out of",
};

// Discord's documented caps. Exceeding any of them fails the whole message
// with a 400, so every string that comes from user input gets clamped here
// rather than trusted to be short.
const MAX_FIELD_VALUE = 1024;
const MAX_DESCRIPTION = 4096;

export function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function field(name: string, value: string, inline = true) {
  return { name, value: clamp(value, MAX_FIELD_VALUE) || "—", inline };
}

/**
 * Reduces a full name to the form this channel is allowed to say out loud:
 * first name plus a last initial. "Natasha Kowalczyk" -> "Natasha K."
 *
 * A single-word name is returned as-is — mononyms and preferred names that
 * are already just a first name are common enough that appending a stray
 * period to them would look like a bug.
 */
export function publicDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Someone";
  if (parts.length === 1) return clamp(parts[0], 64);
  const first = parts[0];
  const initial = [...parts[parts.length - 1]][0];
  return clamp(`${first} ${initial.toUpperCase()}.`, 64);
}

/** `<t:unix:style>` — rendered by each viewer's client in their own timezone. */
export function discordTimestamp(iso: string, style: "F" | "R" | "D"): string {
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:${style}>` : "—";
}

/**
 * Fourteen slots of how full something is — the same width the hacklanta
 * recap uses, which is as wide as a bold line of description text gets before
 * it wraps on a narrow client.
 */
export function progressBar(percent: number, slots = 14): string {
  const filled = Math.min(slots, Math.max(0, Math.round((percent / 100) * slots)));
  return `${"█".repeat(filled)}${"░".repeat(slots - filled)}`;
}

/** Capacity as a whole percent, or null for an uncapped event. */
export function fillPercent(goingCount: number, capacity: number | null): number | null {
  if (capacity === null || capacity <= 0) return null;
  return Math.min(100, Math.round((goingCount / capacity) * 100));
}

function attendanceLines(event: RsvpAlertEvent): string[] {
  const percent = fillPercent(event.goingCount, event.capacity);
  const waitlist =
    event.waitlistedCount > 0 ? ` · ${event.waitlistedCount} waitlisted` : "";

  if (percent === null) {
    return [`**${event.goingCount}** going${waitlist}`];
  }

  const remaining = Math.max(0, (event.capacity ?? 0) - event.goingCount);
  const room =
    remaining === 0 ? " · **full**" : ` · ${remaining} ${remaining === 1 ? "spot" : "spots"} left`;
  return [
    `**${progressBar(percent)}**`,
    `**${event.goingCount}** of ${event.capacity} going (${percent}%)${room}${waitlist}`,
  ];
}

export function buildRsvpAlert(alert: RsvpAlert, now: Date): WebhookMessage {
  const { event } = alert;
  const name = clamp(alert.attendeeName, 64) || "Someone";

  const description = [
    `${LEADS[alert.kind]} **${clamp(event.title, 200)}**`,
    ...attendanceLines(event),
  ].join("\n");

  return {
    // Nothing in here is ever worth a ping, and a member whose name happens
    // to look like a role mention should not become one.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        author: {
          name: alert.isGuest
            ? `${HEADINGS[alert.kind]} · Guest`
            : HEADINGS[alert.kind],
        },
        color: COLORS[alert.kind],
        title: name,
        url: event.url,
        description: clamp(description, MAX_DESCRIPTION),
        fields: [
          field("Starts", discordTimestamp(event.startsAt, "R")),
          field("Where", event.locationText ?? "TBA"),
          field("Came from", alert.campaign ? alert.campaign.label : "Direct"),
        ],
        footer: { text: "Progsu · members.progsu.com" },
        timestamp: now.toISOString(),
      },
    ],
  };
}
