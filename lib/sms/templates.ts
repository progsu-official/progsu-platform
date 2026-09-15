// Message templates for automatic texts. No server-only import: /admin/sms
// renders the same function as a preview, so what officers see is what goes
// out.
//
// One segment (160 GSM-7 characters) whenever the event has a room: the fixed
// text is 72 characters, so a 45-character title and a 35-character room
// still fit. An event with no room gets its page link instead, which can push
// a long slug to two. Emoji are dropped and "..." stands in for an ellipsis, because either
// character outside GSM-7 switches the whole text to UCS-2 and doubles the
// cost of every reminder.

const TITLE_MAX = 45;
const LOCATION_MAX = 35;

function clip(value: string, max: number): string {
  const v = value
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return v.length <= max ? v : `${v.slice(0, max - 3).trimEnd()}...`;
}

export type EventReminderInput = {
  title: string;
  slug: string;
  startsAt: string | Date;
  locationText: string | null;
  siteUrl: string;
  now?: Date;
};

export function eventReminderBody(input: EventReminderInput): string {
  const now = input.now ?? new Date();
  const minutes = Math.max(
    5,
    Math.round((new Date(input.startsAt).getTime() - now.getTime()) / 60_000 / 5) * 5
  );
  const title = clip(input.title, TITLE_MAX);
  const where = input.locationText?.trim()
    ? ` at ${clip(input.locationText, LOCATION_MAX)}`
    : "";
  // Without a room there is nothing to walk to, so point at the event page.
  const link = where
    ? ""
    : `\n${input.siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/events/${input.slug}`;

  return `yo, ${title} starts in ${minutes} min${where}! See you there.${link}\n\nProgsu: reply STOP to opt out`;
}
