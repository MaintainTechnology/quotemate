// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Database setup runner
//
// Usage:  node --env-file=.env.local scripts/setup-database.mjs
//
// Connects to the Supabase Postgres instance using SUPABASE_DB_URL
// and runs the entire sql/init.sql file. Safe to re-run — the SQL
// uses `if not exists` and `where not exists` guards.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "init.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

console.log(`\n→ Connecting to Supabase Postgres...`);

try {
  await client.connect();
  console.log(`  connected.`);

  console.log(`\n→ Running sql/init.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log(`  done.`);

  console.log(`\n→ Verifying tables and seed counts...`);
  const checks = [
    ["shared_assemblies", 5],
    ["shared_materials", 8],
    ["pricing_book", 1],
    ["calls", 0],
    ["intakes", 0],
    ["quotes", 0],
    ["quote_line_items", 0],
  ];

  for (const [table, expected] of checks) {
    const { rows } = await client.query(`select count(*)::int as n from ${table}`);
    const actual = rows[0].n;
    const ok = actual >= expected;
    const mark = ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${table.padEnd(22)} ${actual} row${actual === 1 ? "" : "s"}` +
        (expected > 0 ? `  (expected ≥ ${expected})` : "")
    );
  }

  console.log(`\n✓ Database setup complete.\n`);
} catch (err) {
  console.error(`\n✗ Setup failed: ${err.message}`);
  if (err.position) console.error(`  at SQL position ${err.position}`);
  process.exit(1);
} finally {
  await client.end();
}
