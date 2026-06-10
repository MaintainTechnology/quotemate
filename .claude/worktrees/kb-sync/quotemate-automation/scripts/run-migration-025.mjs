// QuoteMate · run migration 025 (WP1: pricing_book.tenant_id NOT NULL)
// Usage:  node --env-file=.env.local scripts/run-migration-025.mjs
//
// Refuses to run if any pricing_book row still has a NULL tenant_id —
// resolve those first with scripts/wp1-pricing-book-audit.mjs.

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
  "025_pricing_book_tenant_required.sql",
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

  // Pre-flight: surface orphan count BEFORE attempting the migration so
  // the failure (if any) is readable rather than a raw PG exception.
  const { rows: pre } = await client.query(
    `select count(*)::int as n from pricing_book where tenant_id is null`,
  );
  console.log(`\n→ pricing_book rows with NULL tenant_id: ${pre[0].n}`);
  if (pre[0].n > 0) {
    console.error(
      "✗ Refusing to migrate — resolve the orphan rows first:\n" +
        "    node --env-file=.env.local scripts/wp1-pricing-book-audit.mjs",
    );
    process.exit(1);
  }

  console.log(
    `→ Running 025_pricing_book_tenant_required.sql (${sql.length.toLocaleString()} chars)...`,
  );
  await client.query(sql);
  console.log("OK migration applied");

  // Verify tenant_id is now NOT NULL.
  const { rows: col } = await client.query(
    `select is_nullable
       from information_schema.columns
       where table_name = 'pricing_book' and column_name = 'tenant_id'`,
  );
  if (col.length === 0) {
    console.error("FAIL — pricing_book.tenant_id column not found post-migration");
    process.exit(1);
  }
  if (col[0].is_nullable !== "NO") {
    console.error(
      `FAIL — pricing_book.tenant_id is still nullable (is_nullable=${col[0].is_nullable})`,
    );
    process.exit(1);
  }
  console.log("  OK — pricing_book.tenant_id is now NOT NULL");

  // Confirm the (tenant_id, trade) unique index from migration 024 is
  // still present — NOT NULL + that index together guarantee exactly one
  // book per (tenant, trade).
  const { rows: idx } = await client.query(
    `select indexdef from pg_indexes
       where tablename = 'pricing_book'
         and indexname = 'pricing_book_tenant_trade_unique'`,
  );
  if (idx.length === 0) {
    console.warn(
      "  WARN — pricing_book_tenant_trade_unique missing. Run migration 024 so one-book-per-(tenant,trade) is enforced.",
    );
  } else {
    console.log(`  OK — unique index present: ${idx[0].indexdef}`);
  }
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
