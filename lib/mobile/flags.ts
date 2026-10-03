import "server-only";

import { env } from "@/lib/env";
import { fail } from "./http";

// Event routes follow the web kill switch: FEATURE_EVENTS off = not there.
export function requireEventsOn() {
  if (!env.FEATURE_EVENTS) fail("feature_off", "Not available.");
}
