import "server-only";

import type { NextRequest } from "next/server";

import { requireTeamFinderSyncSecret } from "@/lib/env";

// Shared bearer check for hacklanta-ii's server-to-server team-finder calls.
// Constant-time compare, same as app/api/cron/event-notifications/route.ts.
export function teamFinderSyncAuthed(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  let expected: string;
  try {
    expected = `Bearer ${requireTeamFinderSyncSecret()}`;
  } catch {
    return false;
  }
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i += 1) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
