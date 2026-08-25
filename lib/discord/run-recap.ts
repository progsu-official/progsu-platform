import "server-only";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { buildDailyRecapMessage } from "./recap";
import { buildRecapStats } from "./recap-data";
import { renderRecapChart } from "./recap-chart";
import { executeWebhook } from "./webhook";

// Assembles and posts the daily recap. Called by the cron route, and by
// scripts/preview-discord-recap.ts against real data.
//
// Unlike the per-RSVP alert this one is allowed to throw: its caller is a cron
// route whose whole job is to run it, so a failure should surface as a 500 in
// the Vercel log rather than a silent no-op.

const CHART_FILE_NAME = "progsu-recap.png";

export type RunRecapResult = {
  delivered: boolean;
  reason?: "flag_off" | "no_webhook";
  rsvps?: number;
};

export async function runDailyRecap(now: Date = new Date()): Promise<RunRecapResult> {
  if (!env.FEATURE_DISCORD_RECAP) {
    return { delivered: false, reason: "flag_off" };
  }
  const webhookUrl =
    process.env.DISCORD_RECAP_WEBHOOK_URL || process.env.DISCORD_RSVP_WEBHOOK_URL;
  if (!webhookUrl) {
    return { delivered: false, reason: "no_webhook" };
  }

  const stats = await buildRecapStats(now);

  await executeWebhook({
    webhookUrl,
    message: buildDailyRecapMessage({
      stats,
      chartFileName: CHART_FILE_NAME,
      roleId: process.env.DISCORD_RECAP_ROLE_ID || undefined,
      now,
    }),
    files: [
      {
        name: CHART_FILE_NAME,
        contentType: "image/png",
        data: await renderRecapChart(stats),
      },
    ],
  });

  log.info("discord daily recap delivered", {
    action: "discord.daily_recap",
    rsvps: stats.rsvps.window,
    upcoming: stats.upcoming.length,
  });

  return { delivered: true, rsvps: stats.rsvps.window };
}
