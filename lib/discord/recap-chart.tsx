import React from "react";
import { ImageResponse } from "next/og";

import type { RecapStats } from "./recap-data";

// The chart that rides along with the daily recap, rendered through next/og's
// Satori pipeline — no headless browser, no canvas native module, runs fine on
// a serverless function.
//
// Satori is not a browser: only flexbox, no grid, no CSS variables, and every
// element that contains more than one child needs an explicit `display`. The
// verbose inline styles below are that constraint, not a preference.
//
// The explicit React import is for scripts/preview-discord-recap.ts: tsconfig
// sets jsx "preserve" for Next's SWC, and tsx falls back to the classic
// transform, which needs React in scope. Next's automatic runtime ignores it.
//
// Fourteen bars, one per day, zero-filled by buildRecapStats — a chart that
// silently drops empty days draws a busy week through a dead one.

export const chartSize = { width: 1200, height: 420 };

const background = "#0b0713";
const grid = "rgba(255, 255, 255, 0.14)";
const inkFaint = "rgba(255, 255, 255, 0.55)";
const accent = "#a78bfa";
// Oldest day to newest, interpolated rather than cycled. A repeating palette
// alternates neighbouring bars and reads as noise; a ramp reads as time, so
// the newest days are the bright ones without needing a legend.
const rampFrom = [76, 29, 149]; // violet-900
const rampTo = [167, 139, 250]; // violet-400
const barMaxHeight = 196;

function barColor(index: number, total: number): string {
  const t = total <= 1 ? 1 : index / (total - 1);
  const channel = (i: number) =>
    Math.round(rampFrom[i] + (rampTo[i] - rampFrom[i]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function dayLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export async function renderRecapChart(stats: RecapStats): Promise<Uint8Array> {
  const bars = stats.timeSeries;
  const peak = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((sum, b) => sum + b.count, 0);

  const response = new ImageResponse(
    (
      <div
        style={{
          background,
          color: "white",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: "32px 44px 26px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "flex-end",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: inkFaint, display: "flex", fontSize: 22 }}>
              PROGSU
            </div>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>
              RSVPs — last 14 days
            </div>
          </div>
          <div
            style={{
              alignItems: "flex-end",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>
              {total.toLocaleString("en-US")} total
            </div>
            <div style={{ color: accent, display: "flex", fontSize: 24 }}>
              +{stats.rsvps.window} in the last 24h
            </div>
          </div>
        </div>

        {total === 0 ? (
          <div
            style={{
              alignItems: "center",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: 18,
              color: inkFaint,
              display: "flex",
              flexGrow: 1,
              fontSize: 30,
              justifyContent: "center",
              marginTop: 24,
            }}
          >
            No RSVPs in the last 14 days
          </div>
        ) : (
          <div
            style={{
              alignItems: "flex-end",
              borderBottom: `2px solid ${grid}`,
              display: "flex",
              flexGrow: 1,
              gap: 10,
              marginTop: 24,
            }}
          >
            {bars.map((bar, index) => (
              <div
                key={bar.date}
                style={{
                  alignItems: "center",
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  gap: 8,
                  height: "100%",
                  justifyContent: "flex-end",
                }}
              >
                {bar.count > 0 ? (
                  <div style={{ color: inkFaint, display: "flex", fontSize: 18 }}>
                    {bar.count}
                  </div>
                ) : null}
                <div
                  style={{
                    background: barColor(index, bars.length),
                    borderRadius: "8px 8px 0 0",
                    display: "flex",
                    height: Math.max(4, Math.round((bar.count / peak) * barMaxHeight)),
                    width: "100%",
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div
          style={{ display: "flex", flexShrink: 0, gap: 10, height: 24, marginTop: 10 }}
        >
          {bars.map((bar) => (
            <div
              key={`label-${bar.date}`}
              style={{
                color: inkFaint,
                display: "flex",
                flexGrow: 1,
                fontSize: 16,
                justifyContent: "center",
              }}
            >
              {dayLabel(bar.date)}
            </div>
          ))}
        </div>
      </div>
    ),
    chartSize
  );

  return new Uint8Array(await response.arrayBuffer());
}
