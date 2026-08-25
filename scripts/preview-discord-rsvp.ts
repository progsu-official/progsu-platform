// Posts one of each RSVP embed variant to a Discord webhook, so the thing can
// be looked at rather than imagined.
//
//   pnpm tsx scripts/preview-discord-rsvp.ts <webhook-url>
//   DISCORD_RSVP_WEBHOOK_URL=... pnpm tsx scripts/preview-discord-rsvp.ts
//
// Deliberately not a smoke test: it touches no database, seeds nothing, and
// asserts nothing. It renders the real builder against fixed sample data —
// the fixtures below are the design brief, so change them when you want to
// see how the embed handles a long title or a room that is nearly full.
//
// It does post to a real channel. Point it at a scratch webhook unless you
// mean to show the whole server four fake RSVPs.

import { buildRsvpAlert, type RsvpAlert } from "../lib/discord/rsvp-alert";
import { executeWebhook } from "../lib/discord/webhook";

const webhookUrl = process.argv[2] ?? process.env.DISCORD_RSVP_WEBHOOK_URL;

if (!webhookUrl) {
  console.error(
    "Usage: pnpm tsx scripts/preview-discord-rsvp.ts <webhook-url>\n" +
      "   or: set DISCORD_RSVP_WEBHOOK_URL in the environment."
  );
  process.exit(1);
}

const inDays = (days: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const kickoff = {
  title: "Fall Kickoff Carnival",
  url: "https://progsu.com/events/fall-kickoff-carnival",
  startsAt: inDays(6, 18),
  locationText: "Student Center East, Ballroom",
  capacity: 120,
};

const workshop = {
  title: "Ship It Night: Deploy Your First App",
  url: "https://progsu.com/events/ship-it-night",
  startsAt: inDays(2, 19),
  locationText: "Aderhold 205",
  capacity: 30,
};

const samples: RsvpAlert[] = [
  // The common case: a member, no campaign, room with plenty of space.
  {
    kind: "going",
    attendeeName: "Natasha K.",
    isGuest: false,
    campaign: null,
    event: { ...kickoff, goingCount: 43, waitlistedCount: 0 },
  },
  // The one the campaign links exist for.
  {
    kind: "going",
    attendeeName: "Marcus T.",
    isGuest: true,
    campaign: { slug: "library-flyer", label: "Library flyer (2nd floor)" },
    event: { ...kickoff, goingCount: 44, waitlistedCount: 0 },
  },
  // A full room: the bar is solid and the waitlist count appears.
  {
    kind: "waitlisted",
    attendeeName: "Priya R.",
    isGuest: false,
    campaign: { slug: "gsu-cs-discord", label: "GSU CS Discord post" },
    event: { ...workshop, goingCount: 30, waitlistedCount: 4 },
  },
  // A seat opening back up — the cue for whoever watches the waitlist.
  {
    kind: "cancelled",
    attendeeName: "Devon A.",
    isGuest: false,
    campaign: null,
    event: { ...workshop, goingCount: 29, waitlistedCount: 4 },
  },
];

async function main() {
  for (const [index, sample] of samples.entries()) {
    await executeWebhook({
      webhookUrl: webhookUrl!,
      message: buildRsvpAlert(sample, new Date()),
    });
    console.log(`posted ${index + 1}/${samples.length} — ${sample.kind}`);
    // Discord allows 5 webhook posts per 2s. Space them out so the preview
    // never becomes a lesson in reading 429 bodies.
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
