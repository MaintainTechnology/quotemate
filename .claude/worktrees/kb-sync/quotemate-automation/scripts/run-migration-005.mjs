// Apply sql/migrations/005_library_expansion.sql to prod Supabase.
// Idempotent — re-running is a no-op.
//
// Usage:  node --env-file=.env.local scripts/run-migration-005.mjs

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "sql", "migrations", "005_library_expansion.sql"), "utf8");

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("→ Applying 005_library_expansion.sql");
await c.query(sql);

const counts = await c.query(`
  select
    (select count(*) from shared_materials)  as n_materials,
    (select count(*) from shared_assemblies) as n_assemblies,
    (select min_labour_hours from pricing_book limit 1) as min_labour_hours
`);
console.log("✓ Migration applied");
console.log("  shared_materials rows:  ", counts.rows[0].n_materials);
console.log("  shared_assemblies rows: ", counts.rows[0].n_assemblies);
console.log("  pricing_book.min_labour_hours:", counts.rows[0].min_labour_hours);

await c.end();
