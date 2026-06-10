// QuoteMate · run migration 027 (quote lifecycle + VA follow-up, WP7)
// Usage:  node --env-file=.env.local scripts/run-migration-027.mjs
//
// Additive + idempotent. Safe to re-run. NOT auto-applied to production
// — apply manually after human approval per the WP7 brief.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(
  here,
  "..",
  "sql",
  "migrations",
  "027_quote_lifecycle.sql",
);

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

try {
  await client.connect();
  console.log(
    `\n→ Running 027_quote_lifecycle.sql (${sql.length.toLocaleString()} chars)...`,
  );
  await client.query(sql);
  console.log("OK migration applied");

  const { rows: cols } = await client.query(
    `select column_name, data_type
       from information_schema.columns
       where table_name = 'quotes'
         and column_name in ('last_status_at','followed_up_at','followup_note')
       order by column_name`,
  );
  console.log(`\n  New columns present (${cols.length}/3):`);
  for (const c of cols) {
    console.log(`    ${c.column_name.padEnd(20)} ${c.data_type}`);
  }
  if (cols.length !== 3) {
    console.error("FAIL — expected all 3 WP7 columns to be present");
    process.exit(1);
  }

  const { rows: idx } = await client.query(
    `select indexname
       from pg_indexes
       where tablename = 'quotes'
         and indexname in ('quotes_followup_idx','quotes_last_status_at_idx')
       order by indexname`,
  );
  console.log(`\n  Follow-up indexes (${idx.length}/2):`);
  for (const i of idx) console.log(`    ${i.indexname}`);

  const { rows: dist } = await client.query(
    `select coalesce(status,'(null)') as status, count(*)::int as n
       from quotes
       group by status
       order by n desc`,
  );
  console.log(`\n  Quote status distribution after backfill:`);
  for (const d of dist) console.log(`    ${String(d.status).padEnd(12)} ${d.n}`);

  const { rows: lsa } = await client.query(
    `select count(*)::int as n from quotes where last_status_at is null`,
  );
  console.log(`\n  Rows still missing last_status_at: ${lsa[0].n}`);

  // Keep PostgREST's schema cache fresh so supabase-js sees the new
  // columns immediately (mirrors migrations 024 / 026).
  try {
    await client.query(`notify pgrst, 'reload schema'`);
    console.log("  OK — PostgREST schema reload notified");
  } catch (e) {
    console.warn("  WARN — could not NOTIFY pgrst (non-fatal):", e?.message ?? e);
  }
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
