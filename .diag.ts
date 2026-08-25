import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
async function main() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.SUPABASE_DB_URL!, { prepare: false, max: 1 });
  try {
    const applied = await sql`
      select version from supabase_migrations.schema_migrations
      where version >= '20260824100000' order by version`;
    console.log("=== APPLIED SINCE 100000 ==="); console.table(applied);

    const ev = await sql`
      select id, slug, title, status, starts_at, pinned
      from events
      where status='published' and starts_at > now() - interval '60 days'
      order by starts_at`;
    console.log("=== UPCOMING/RECENT EVENTS ==="); console.table(ev);

    const links = await sql`select slug, label, event_id from referral_links order by created_at`;
    console.log("=== EXISTING LINKS ==="); console.table(links);
  } finally { await sql.end(); }
}
main().catch((e)=>{console.error(e);process.exit(1);});
