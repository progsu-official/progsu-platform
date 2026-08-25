// Renders the daily recap and posts it to a webhook, so the thing can be
// looked at rather than imagined.
//
//   pnpm discord:recap <webhook-url>            # real data, read-only
//   pnpm discord:recap <webhook-url> --demo     # fixtures, no database
//
// The NODE_OPTIONS in the package.json script matter: lib/discord/recap-data.ts
// imports "server-only", which resolves to a module that throws unless Node is
// told to use the react-server condition. Running this with a bare `tsx` will
// fail on the import, not on anything you wrote.
//
// Real mode reads production. It writes nothing — but it does post to whatever
// channel that webhook points at, so aim it at a scratch one first.

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const args = process.argv.slice(2);
const demo = args.includes("--demo");
const webhookUrl =
  args.find((a) => a.startsWith("http")) ??
  process.env.DISCORD_RECAP_WEBHOOK_URL ??
  process.env.DISCORD_RSVP_WEBHOOK_URL;

if (!webhookUrl) {
  console.error(
    "Usage: pnpm discord:recap <webhook-url> [--demo]\n" +
      "   or: set DISCORD_RECAP_WEBHOOK_URL / DISCORD_RSVP_WEBHOOK_URL."
  );
  process.exit(1);
}

const inDays = (days: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

// A fortnight that looks like a real semester: quiet start, a flyer landing on
// day nine, a push into the event. Shaped to exercise every branch of the
// embed — a headline event with capacity, others without, live campaigns.
function demoStats() {
  const counts = [0, 1, 0, 2, 3, 1, 4, 2, 9, 14, 7, 11, 6, 12];
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  return {
    since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    rsvps: {
      window: 12,
      windowGuests: 5,
      last7: 61,
      previous7: 13,
      dailyAverage7: 8.7,
    },
    newMembers: 6,
    timeSeries: counts.map((count, index) => ({
      date: day(counts.length - 1 - index),
      count,
    })),
    upcoming: [
      {
        title: "Fall Kickoff Carnival",
        slug: "fall-kickoff-carnival",
        startsAt: inDays(3, 18),
        capacity: 120,
        goingCount: 78,
        waitlistedCount: 0,
      },
      {
        title: "Ship It Night: Deploy Your First App",
        slug: "ship-it-night",
        startsAt: inDays(9, 19),
        capacity: 30,
        goingCount: 30,
        waitlistedCount: 4,
      },
      {
        title: "Resume Teardown with Delta Engineers",
        slug: "resume-teardown",
        startsAt: inDays(16, 17),
        capacity: null,
        goingCount: 12,
        waitlistedCount: 0,
      },
    ],
    campaigns: [
      { slug: "library-flyer", label: "Library flyer (2nd floor)", clicks: 64, rsvps: 9 },
      { slug: "gsu-cs-discord", label: "GSU CS Discord post", clicks: 38, rsvps: 3 },
      { slug: "class-shoutout", label: "CSC 2720 shoutout", clicks: 21, rsvps: 0 },
    ],
  };
}

async function main() {
  const [{ buildDailyRecapMessage }, { renderRecapChart }, { executeWebhook }] =
    await Promise.all([
      import("../lib/discord/recap"),
      import("../lib/discord/recap-chart"),
      import("../lib/discord/webhook"),
    ]);

  const stats = demo
    ? demoStats()
    : await (await import("../lib/discord/recap-data")).buildRecapStats();

  console.log(
    demo
      ? "using demo fixtures"
      : `read ${stats.rsvps.window} RSVPs in the last 24h, ${stats.upcoming.length} upcoming`
  );

  const chartFileName = "progsu-recap.png";
  await executeWebhook({
    webhookUrl: webhookUrl!,
    message: buildDailyRecapMessage({ stats, chartFileName }),
    files: [
      {
        name: chartFileName,
        contentType: "image/png",
        data: await renderRecapChart(stats),
      },
    ],
  });
  console.log("posted");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
