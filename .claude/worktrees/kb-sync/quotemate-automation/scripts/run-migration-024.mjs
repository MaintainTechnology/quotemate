// QuoteMate · run migration 024 (pricing_book unique index → non-partial)
// Usage:  node --env-file=.env.local scripts/run-migration-024.mjs
//
// Fixes the "no unique or exclusion constraint matching the ON CONFLICT
// specification" failure on POST /api/tenant/trades by converting
// pricing_book_tenant_trade_unique from a PARTIAL to a full unique index
// so PostgREST can infer it for `.upsert({ onConflict: 'tenant_id,trade' })`.

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
  "024_pricing_book_unique_full.sql",
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
    `\n→ Running 024_pricing_book_unique_full.sql (${sql.length.toLocaleString()} chars)...`,
  );
  await client.query(sql);
  console.log("OK migration applied");

  // Verify the index is now NON-partial (indexdef must NOT contain a
  // WHERE clause). This is the whole point of the migration.
  const { rows: idx } = await client.query(
    `select indexname, indexdef
       from pg_indexes
       where tablename = 'pricing_book'
         and indexname = 'pricing_book_tenant_trade_unique'`,
  );
  if (idx.length === 0) {
    console.error("FAIL — pricing_book_tenant_trade_unique not found post-migration");
    process.exit(1);
  }
  const def = idx[0].indexdef;
  console.log(`\n  Index def: ${def}`);
  if (/\bWHERE\b/i.test(def)) {
    console.error(
      "FAIL — index is still PARTIAL (WHERE clause present). ON CONFLICT inference will keep failing.",
    );
    process.exit(1);
  }
  console.log("  OK — index is non-partial; ON CONFLICT (tenant_id,trade) will infer.");

  // Reload PostgREST's schema cache so supabase-js upserts pick up the
  // new arbiter index immediately (without this, the running PostgREST
  // process can keep using its cached view of the old partial index).
  try {
    await client.query(`notify pgrst, 'reload schema'`);
    console.log("  OK — PostgREST schema reload notified");
  } catch (e) {
    console.warn(
      "  WARN — could not NOTIFY pgrst (non-fatal; cache refreshes on its own):",
      e?.message ?? e,
    );
  }
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
