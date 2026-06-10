// Apply sql/migrations/007_library_properties.sql to prod Supabase.
// Idempotent — re-running just re-asserts property values.
//
// Usage:  node --env-file=.env.local scripts/run-migration-007.mjs

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "sql", "migrations", "007_library_properties.sql"), "utf8");

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("→ Applying 007_library_properties.sql");
await c.query(sql);

const m = await c.query(`select name, properties from shared_materials order by name`);
const a = await c.query(`select name, properties from shared_assemblies order by name`);

console.log(`\n✓ Migration applied`);
console.log(`\n── shared_materials properties (${m.rows.length} rows) ──`);
for (const r of m.rows) console.log(`  ${r.name.padEnd(40)} → ${JSON.stringify(r.properties)}`);

console.log(`\n── shared_assemblies properties (${a.rows.length} rows) ──`);
for (const r of a.rows) console.log(`  ${r.name.padEnd(45)} → ${JSON.stringify(r.properties)}`);

await c.end();
