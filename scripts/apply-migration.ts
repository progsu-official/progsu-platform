// Throwaway migration runner for this session. No supabase CLI / psql on this
// machine, and SUPABASE_DB_URL points at prod, so:
//   pnpm tsx <this> --dry  <files...>   -> run inside a transaction, ROLLBACK
//   pnpm tsx <this> --apply <files...>  -> run inside a transaction, COMMIT
// Each file runs as one transaction so a failure mid-file can't leave the
// schema half-changed (matters for the drop+recreate of guest_rsvp_to_event).
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
loadEnv({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const apply = args.includes("--apply");
  const files = args.filter((a) => !a.startsWith("--"));

  if (dry === apply) throw new Error("pass exactly one of --dry / --apply");
  if (files.length === 0) throw new Error("no migration files given");

  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.SUPABASE_DB_URL!, {
    prepare: false,
    max: 1,
    onnotice: (n) => {
      if (n.severity !== "NOTICE") console.log(`    pg[${n.severity}] ${n.message}`);
    },
  });

  try {
    if (dry) {
      // All files in ONE transaction so a later migration can see the schema
      // an earlier one creates, then roll the whole chain back.
      try {
        await sql.begin(async (tx) => {
          for (const file of files) {
            process.stdout.write(`  dry  ${file} ... `);
            await tx.unsafe(readFileSync(file, "utf8"));
            console.log("ok");
          }
          throw new Rollback();
        });
      } catch (e) {
        if (!(e instanceof Rollback)) {
          console.log("FAILED");
          throw e;
        }
      }
      console.log("  → whole chain valid, rolled back");
      return;
    }

    for (const file of files) {
      process.stdout.write(`  APPLY ${file} ... `);
      try {
        await sql.begin((tx) => tx.unsafe(readFileSync(file, "utf8")));
        console.log("ok (committed)");
      } catch (e) {
        console.log("FAILED");
        throw e;
      }
    }
  } finally {
    await sql.end();
  }
}

class Rollback extends Error {}

main().catch((e) => {
  console.error("\n" + (e?.message ?? e));
  if (e?.position) console.error(`  at character position ${e.position}`);
  if (e?.detail) console.error(`  detail: ${e.detail}`);
  if (e?.hint) console.error(`  hint: ${e.hint}`);
  process.exit(1);
});
