// QuoteMate · run migration 033 (electrical clarifying questions — mig-032 follow-up)
// Usage:  node --env-file=.env.local scripts/run-migration-033.mjs
//
// Safe before OR after the code deploy and idempotent (the mechanism +
// column shipped in migration 032; this is data only). NULL = old
// behaviour.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "033_electrical_clarifying_questions.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

// [name, expected question count] — the 13 electrical rows.
const EXPECTED = [
  ["Diagnostic call-out (fault finding)", 3],
  ["Install cooktop (existing wiring)", 3],
  ["Install oven (existing wiring)", 3],
  ["Hardwire induction cooktop", 3],
  ["Hardwire oven", 3],
  ["Install aircon power point", 3],
  ["Install bathroom exhaust fan", 3],
  ["Install EV charger", 3],
  ["Install LED strip lighting", 3],
  ["Install motion sensor flood light", 3],
  ["Install outdoor IP-rated GPO", 3],
  ["Install security camera (single)", 3],
  ["Install wired doorbell or intercom", 3],
];

const sql = readFileSync(sqlPath, "utf8");
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`→ Running 033_electrical_clarifying_questions.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("OK migration applied");

  let bad = 0;
  for (const [name, count] of EXPECTED) {
    const { rows } = await client.query(
      `select jsonb_typeof(clarifying_questions) as t,
              jsonb_array_length(clarifying_questions) as n
         from shared_assemblies where trade = 'electrical' and name = $1`,
      [name],
    );
    if (rows.length === 0) {
      console.error(`  ✗ MISSING ROW: "${name}" — name drifted?`);
      bad++;
    } else if (rows[0].t !== "array" || rows[0].n !== count) {
      console.error(`  ✗ "${name}" type=${rows[0].t} count=${rows[0].n} expected array[${count}]`);
      bad++;
    } else {
      console.log(`  ✓ "${name}" → ${rows[0].n} questions`);
    }
  }

  const { rows: tally } = await client.query(
    `select count(*)::int n, count(clarifying_questions)::int scripted
       from shared_assemblies where trade = 'electrical'`,
  );
  console.log(
    `\nelectrical: ${tally[0].scripted}/${tally[0].n} rows now carry a question script (the easy-5-covered rows stay NULL by design).`,
  );

  if (bad > 0) {
    console.error(`\nFAIL — ${bad} backfill mismatch(es).`);
    process.exit(1);
  }
  console.log("\nOK — migration 033 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
