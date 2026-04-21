import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  // Note: lib/db/client imports "server-only" which blocks Node scripts on purpose.
  // We build an identical client here inline to exercise the generated schema.
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const schema = await import("../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");

  const client = postgres(process.env.SUPABASE_DB_URL!, { prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });

  // 1. Count rows in school_domains — should be 6.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.schoolDomains);
  if (count !== 6) throw new Error(`expected 6 school_domains, got ${count}`);
  console.log(`  ✓ school_domains.count via Drizzle = ${count}`);

  // 2. Select with typed enum filter on consent_versions.
  const rows = await db
    .select({ consent_type: schema.consentVersions.consentType, version: schema.consentVersions.version })
    .from(schema.consentVersions)
    .where(eq(schema.consentVersions.consentType, "privacy_policy"));
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  if (rows[0].version !== "v1") throw new Error(`version: ${rows[0].version}`);
  console.log(
    `  ✓ consent_versions typed query: ${rows[0].consent_type} @ ${rows[0].version}`
  );

  // 3. Assert interested_roles enum type is narrow (compile-time check via assignment).
  type Role = (typeof schema.interestedRoleT.enumValues)[number];
  const role: Role = "software_engineering"; // this would fail to compile if enum drifted
  if (!schema.interestedRoleT.enumValues.includes(role))
    throw new Error("enum drift");
  console.log(
    `  ✓ interested_role_t enum exported with ${schema.interestedRoleT.enumValues.length} values`
  );

  console.log("✓ drizzle smoke OK");
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ drizzle smoke failed:", err);
  process.exit(1);
});
