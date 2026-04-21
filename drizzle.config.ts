import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".env.local" });

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error(
    "SUPABASE_DB_URL is required (drizzle pull reads the DB directly; set it in .env.local)."
  );
}

// Introspection-only config. Supabase migrations in supabase/migrations/ are the source of truth.
// Drizzle emits types into drizzle/ via `pnpm drizzle-kit pull`.
export default defineConfig({
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  out: "./drizzle",
  schema: "./drizzle/schema.ts",
  schemaFilter: ["public"],
  casing: "snake_case",
  verbose: true,
  strict: true,
});
