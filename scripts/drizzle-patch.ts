// Post-introspection patch for drizzle/schema.ts + drizzle/relations.ts.
// `drizzle-kit pull` regenerates these files verbatim from the DB each time, which
// undoes three hand-edits we need:
//   1. citext columns come back as `unknown(...)` (the import is never emitted),
//      so we swap them for `text(...)` — same wire format, typed as string.
//   2. interested_roles defaults as `[""]` (invalid); we want an empty array `[]`.
//   3. profiles references `foreignColumns: [users.id]` for the auth.users FK, but
//      the auth schema is filtered out of introspection so `users` is not imported.
//      We drop the foreignKey block (the real FK lives in Postgres anyway).
// Run: `pnpm drizzle-kit pull && pnpm tsx scripts/drizzle-patch.ts`
// Or: `pnpm db:pull` (runs both).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_PATH = path.join(process.cwd(), "drizzle/schema.ts");
const RELATIONS_PATH = path.join(process.cwd(), "drizzle/relations.ts");

async function patchSchema() {
  let src = await readFile(SCHEMA_PATH, "utf8");
  const originalLength = src.length;

  src = src.replace(/\t*\/\/ TODO: failed to parse database type 'citext'\n/g, "");
  src = src.replace(/unknown\("/g, 'text("');
  src = src.replace(/\.default\(\[""\]\)/g, ".default([])");
  src = src.replace(
    /\tforeignKey\(\{\s*columns: \[table\.id\],\s*foreignColumns: \[users\.id\],\s*name: "profiles_id_fkey"\s*\}\)\.onDelete\("cascade"\),\n/g,
    "\t// FK to auth.users.id lives in Postgres; auth schema is filtered out of introspection.\n"
  );

  if (src.length === originalLength) {
    console.log(`schema.ts: no changes needed`);
  } else {
    await writeFile(SCHEMA_PATH, src, "utf8");
    console.log(`schema.ts: patched`);
  }
}

async function patchRelations() {
  let src = await readFile(RELATIONS_PATH, "utf8");
  const originalLength = src.length;

  // usersInAuth's position in this import list isn't stable across
  // introspection runs (drizzle-kit orders it by table processing order,
  // which shifts whenever the schema changes), so strip it by name rather
  // than assuming it's first.
  src = src.replace(
    /import \{ ([^}]+) \} from "\.\/schema";/,
    (full: string, names: string) => {
      const list = names.split(",").map((n) => n.trim());
      if (!list.includes("usersInAuth")) return full;
      const rest = list.filter((n) => n !== "usersInAuth").join(", ");
      return `import { ${rest} } from "./schema";\n\n// auth.users relation intentionally omitted — auth schema is filtered out of\n// introspection. profiles.id still FK's to auth.users in Postgres.`;
    }
  );
  src = src.replace(
    /\tusersInAuth: one\(usersInAuth, \{\s*fields: \[profiles\.id\],\s*references: \[usersInAuth\.id\]\s*\}\),\n/g,
    ""
  );
  src = src.replace(
    /\nexport const usersInAuthRelations = relations\(usersInAuth, \(\{many\}\) => \(\{\s*profiles: many\(profiles\),\s*\}\)\);\n/g,
    ""
  );
  src = src.replace(
    /relations\(profiles, \(\{one, many\}\) => /,
    "relations(profiles, ({many}) => "
  );

  if (src.length === originalLength) {
    console.log(`relations.ts: no changes needed`);
  } else {
    await writeFile(RELATIONS_PATH, src, "utf8");
    console.log(`relations.ts: patched`);
  }
}

async function main() {
  await patchSchema();
  await patchRelations();
}

main().catch((err) => {
  console.error("drizzle-patch failed:", err);
  process.exit(1);
});
