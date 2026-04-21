import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/drizzle/schema";

// Admin-only typed DB client. Use this when you need typed Drizzle queries that
// run *outside* the Supabase user-context (e.g. CSV export, audit inserts, cron jobs).
// RLS-sensitive reads/writes should still flow through the Supabase server client so
// auth.uid() is set on the session.

function databaseUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is required for the typed Drizzle client (set in .env.local / prod env)."
    );
  }
  return url;
}

// `prepare: false` keeps this transaction-pooler friendly (Supavisor on port 6543 in prod).
// In V0 we connect directly on 54322 / 5432, but keeping the flag off costs nothing.
let _client: postgres.Sql | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDbClient() {
  if (!_client) {
    _client = postgres(databaseUrl(), { prepare: false });
    _db = drizzle(_client, { schema, casing: "snake_case" });
  }
  return _db!;
}

export { schema };
