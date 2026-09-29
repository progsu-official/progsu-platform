#!/usr/bin/env tsx
// Manual run of the same sync /admin/sms does on every load
// (lib/sms/hacklanta-sync.ts). Dry run by default; --apply writes
// hacklanta_sms_recipients. Sends nothing.
//
// Usage:
//   HACKLANTA_SUPABASE_URL=... HACKLANTA_SUPABASE_SECRET_KEY=... \
//     pnpm tsx scripts/import-hacklanta-sms-recipients.ts [--apply]

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

import { hacklantaClient, syncHacklantaRecipients } from "../lib/sms/hacklanta-sync";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return v;
}

const apply = process.argv.includes("--apply");
const hack = hacklantaClient(need("HACKLANTA_SUPABASE_URL"), need("HACKLANTA_SUPABASE_SECRET_KEY"));
const platform = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

syncHacklantaRecipients(hack, platform, { apply })
  .then((r) => console.log(apply ? "applied:" : "dry run, nothing written:", r))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
