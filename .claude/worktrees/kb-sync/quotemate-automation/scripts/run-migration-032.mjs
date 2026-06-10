// QuoteMate · run migration 032 (per-assembly mandated clarifying questions)
// Usage:  node --env-file=.env.local scripts/run-migration-032.mjs
//
// Safe before OR after the code deploy: NULL clarifying_questions = old
// behaviour, and the inbound route selects with `*` so a missing column
// degrades gracefully. Idempotent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "032_assembly_clarifying_questions.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

// [name, expected question count] — the 14 plumbing pilot rows.
const EXPECTED = [
  ["CCTV drain inspection", 3],
  ["Disposal and site cleanup", 1],
  ["Gas appliance connection", 3],
  ["Pressure reduction valve install", 3],
  ["Install dishwasher", 3],
  ["Install external garden tap", 3],
  ["Install garbage disposal", 3],
  ["Install rainwater tank", 3],
  ["Install washing machine taps", 3],
  ["Install whole-house water filter", 3],
  ["Leak detection", 3],
  ["Replace shower head", 2],
  ["Replace toilet seat", 2],
  ["Stormwater drain unblock", 3],
];

const sql = readFileSync(sqlPath, "utf8");
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`→ Running 032_assembly_clarifying_questions.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("OK migration applied");

  for (const tbl of ["shared_assemblies", "tenant_custom_assemblies"]) {
    const { rows } = await client.query(
      `select 1 from information_schema.columns
        where table_name = $1 and column_name = 'clarifying_questions'`,
      [tbl],
    );
    if (rows.length === 0) {
      console.error(`FAIL — ${tbl}.clarifying_questions not found post-migration`);
      process.exit(1);
    }
    console.log(`  OK — ${tbl}.clarifying_questions present`);
  }

  let bad = 0;
  for (const [name, count] of EXPECTED) {
    const { rows } = await client.query(
      `select jsonb_typeof(clarifying_questions) as t,
              jsonb_array_length(clarifying_questions) as n
         from shared_assemblies where trade = 'plumbing' and name = $1`,
      [name],
    );
    if (rows.length === 0) {
      console.error(`  ✗ MISSING ROW: "${name}" — name drifted from migration 021?`);
      bad++;
    } else if (rows[0].t !== "array" || rows[0].n !== count) {
      console.error(`  ✗ "${name}" type=${rows[0].t} count=${rows[0].n} expected array[${count}]`);
      bad++;
    } else {
      console.log(`  ✓ "${name}" → ${rows[0].n} questions`);
    }
  }

  const { rows: tally } = await client.query(
    `select count(*)::int n,
            count(clarifying_questions)::int scripted
       from shared_assemblies where trade = 'plumbing'`,
  );
  console.log(
    `\nplumbing: ${tally[0].scripted}/${tally[0].n} rows now carry a question script (the 9 easy-5-covered rows stay NULL by design).`,
  );

  if (bad > 0) {
    console.error(`\nFAIL — ${bad} backfill mismatch(es).`);
    process.exit(1);
  }
  console.log("\nOK — migration 032 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
