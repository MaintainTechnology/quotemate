// Apply sql/migrations/006_match_intakes_job_type.sql to prod Supabase.
// Idempotent — re-running is a no-op.
//
// Usage:  node --env-file=.env.local scripts/run-migration-006.mjs

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "sql", "migrations", "006_match_intakes_job_type.sql"), "utf8");

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("→ Applying 006_match_intakes_job_type.sql");
await c.query(sql);

const { rows } = await c.query(
  `select pg_get_function_identity_arguments(oid) as args
     from pg_proc where proname = 'match_intakes'`
);
console.log(`✓ match_intakes function rebuilt`);
for (const r of rows) console.log(`  signature: match_intakes(${r.args})`);

// Sanity check — verify a filtered call returns only matching job_types.
const { rows: smoke } = await c.query(
  `select array_agg(distinct (m.id, m.scope ->> 'item_count')) as ids,
          (select count(*) from intakes where job_type = 'smoke_alarms') as total_in_db
     from match_intakes(
       (select embedding from intakes where job_type = 'smoke_alarms' and embedding is not null limit 1),
       5,
       'smoke_alarms'
     ) m`
);
console.log(`  filtered call (smoke_alarms): ${smoke[0]?.total_in_db ?? 0} matching rows in DB`);

await c.end();
