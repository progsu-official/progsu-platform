// Post-introspection patch for drizzle/schema.ts + drizzle/relations.ts.
// `drizzle-kit pull` regenerates these files verbatim from the DB each time, which
// undoes three hand-edits we need:
//   1. citext columns come back as `unknown(...)` (the import is never emitted),
//      so we swap them for `text(...)` — same wire format, typed as string.
//   2. interested_roles defaults as `[""]` (invalid); we want an empty array `[]`.
//   3. Any table with a column referencing auth.users.id (profiles.id,
//      event_guest_attendances.checked_in_by, ...) comes back with
//      `foreignColumns: [users.id]`, but the auth schema is filtered out of
//      introspection so `users`/`usersInAuth` is never actually importable.
//      We drop those foreignKey blocks and relation entries — the real FKs
//      live in Postgres anyway. Handled generically by column/table name so
//      adding another auth.users FK later doesn't need a new hardcoded regex
//      here (that's exactly what broke when event_guest_attendances added a
//      second one and the old profiles-only regex silently stopped matching).
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
  // Any foreignKey block pointing at foreignColumns: [users.id] — not just
  // profiles_id_fkey. onDelete(...) is optional (profiles has it, a plain FK
  // like event_guest_attendances_checked_in_by_fkey doesn't).
  src = src.replace(
    /\tforeignKey\(\{\s*columns: \[table\.\w+\],\s*foreignColumns: \[users\.id\],\s*name: "\w+_fkey"\s*\}\)(?:\.onDelete\("\w+"\))?,\n/g,
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
      return `import { ${rest} } from "./schema";\n\n// auth.users relation intentionally omitted — auth schema is filtered out of\n// introspection. FKs to auth.users.id still live in Postgres.`;
    }
  );
  // Any "<key>: one(usersInAuth, { fields: [...], references: [usersInAuth.id] }),"
  // line, for any table/column — not just profiles.id.
  src = src.replace(
    /\t\w+: one\(usersInAuth, \{\s*fields: \[[^\]]+\],\s*references: \[usersInAuth\.id\]\s*\}\),\n/g,
    ""
  );
  // The usersInAuthRelations export itself, whatever it now lists (drizzle-kit
  // adds a "<table>: many(<table>)" line here for every table with an
  // auth.users FK, so its body isn't a fixed shape).
  src = src.replace(
    /\nexport const usersInAuthRelations = relations\(usersInAuth, \(\{\s*many\s*\}\) => \(\{[\s\S]*?\}\)\);\n/,
    ""
  );
  // For every "relations(<table>, ({one, many}) => ({ ... }))" block, drop
  // the now-unused `one` from the destructure if stripping the usersInAuth
  // line above left no other one(...) call in that block. (profiles' block
  // only ever used `one` for the auth.users relation; a block like
  // event_guest_attendances' that also has e.g. `event: one(events, ...)`
  // keeps `one`.)
  src = src.replace(
    /relations\((\w+), \(\{\s*one,\s*many\s*\}\) => \(\{([\s\S]*?)\}\)\);/g,
    (full: string, _table: string, body: string) =>
      body.includes("one(") ? full : full.replace("({one, many})", "({many})")
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
