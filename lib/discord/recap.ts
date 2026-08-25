// The daily recap embed. Pure, like rsvp-alert.ts — the chart is rendered and
// attached by run-recap.ts, and referenced here as an attachment:// URL.
//
// Same proportion rules as the RSVP alert: inline fields come in threes with
// short values, anything wide lives in the description. The headline is the
// next event's fill, because for a student org that is the number with a
// deadline attached — "44 of 120, and it's Thursday" is the fact that makes
// someone go put up more posters.

import {
  BRAND_VIOLET,
  clamp,
  discordTimestamp,
  field,
  fillPercent,
  progressBar,
} from "./rsvp-alert";
import type { RecapCampaign, RecapEventSummary, RecapStats } from "./recap-data";
import type { WebhookMessage } from "./webhook";

const MAX_DESCRIPTION = 4096;

const dayHeadline = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "short",
  day: "numeric",
});

export type BuildRecapInput = {
  stats: RecapStats;
  chartFileName: string;
  /** Pinged on the recap only, and only when configured. */
  roleId?: string;
  now?: Date;
};

function trend(last7: number, previous7: number): string {
  if (previous7 === 0) return last7 > 0 ? "▲ first week" : "—";
  const delta = Math.round(((last7 - previous7) / previous7) * 100);
  if (delta === 0) return "▶ flat";
  return delta > 0 ? `▲ ${delta}%` : `▼ ${Math.abs(delta)}%`;
}

function headline(stats: RecapStats): string {
  const next = stats.upcoming[0];
  if (!next) {
    return [
      "Nothing on the calendar.",
      `**${stats.rsvps.window}** RSVPs in the last 24 hours.`,
    ].join("\n");
  }

  const percent = fillPercent(next.goingCount, next.capacity);
  const lines = [
    `Next up · **${clamp(next.title, 200)}** ${discordTimestamp(next.startsAt, "R")}`,
  ];

  if (percent === null) {
    lines.push(`**${next.goingCount}** going so far`);
    return lines.join("\n");
  }

  const remaining = Math.max(0, (next.capacity ?? 0) - next.goingCount);
  lines.push(`**${progressBar(percent)}**`);
  lines.push(
    remaining === 0
      ? `**${next.goingCount}** of ${next.capacity} going (${percent}%) · **full**`
      : `**${next.goingCount}** of ${next.capacity} going (${percent}%) · ${remaining} to fill`
  );
  return lines.join("\n");
}

/** The upcoming list, minus the one already headlined above. */
function upcomingList(events: RecapEventSummary[]): string {
  const rest = events.slice(1);
  if (rest.length === 0) return "Nothing else scheduled.";
  return rest
    .map((e) => {
      const fill =
        e.capacity !== null
          ? `${e.goingCount}/${e.capacity}`
          : `${e.goingCount} going`;
      return `${discordTimestamp(e.startsAt, "D")} · **${clamp(e.title, 80)}** — ${fill}`;
    })
    .join("\n");
}

function campaignList(campaigns: RecapCampaign[]): string {
  if (campaigns.length === 0) return "No campaign traffic today.";
  return campaigns
    .map(
      (c) =>
        `**${clamp(c.label, 60)}** — ${c.rsvps} RSVP${c.rsvps === 1 ? "" : "s"} from ${c.clicks} click${c.clicks === 1 ? "" : "s"}  \`/r/${c.slug}\``
    )
    .join("\n");
}

export function buildDailyRecapMessage({
  stats,
  chartFileName,
  roleId,
  now = new Date(),
}: BuildRecapInput): WebhookMessage {
  const { rsvps } = stats;

  const message: WebhookMessage = {
    embeds: [
      {
        author: { name: "Progsu" },
        color: BRAND_VIOLET,
        title: `Daily Recap — ${dayHeadline.format(now)}`,
        description: clamp(headline(stats), MAX_DESCRIPTION),
        fields: [
          field("Last 24h", `**+${rsvps.window}**`),
          field("Last 7 days", `${rsvps.last7} (${rsvps.dailyAverage7}/day)`),
          field("Vs prior week", trend(rsvps.last7, rsvps.previous7)),
          field(
            "Guests",
            rsvps.window === 0
              ? "—"
              : `${rsvps.windowGuests} of ${rsvps.window}`
          ),
          field("New members", `+${stats.newMembers}`),
          field("Events upcoming", `${stats.upcoming.length}`),
          field("Also coming up", upcomingList(stats.upcoming), false),
          field("Campaigns", campaignList(stats.campaigns), false),
        ],
        image: { url: `attachment://${chartFileName}` },
        footer: { text: "Daily recap · members.progsu.com" },
        timestamp: now.toISOString(),
      },
    ],
  };

  // parse: [] with an explicit roles allowlist — the role pings, and nothing
  // an event title happens to contain does.
  return roleId
    ? { ...message, content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId] } }
    : { ...message, allowed_mentions: { parse: [] } };
}
