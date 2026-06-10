// QuoteMate · run migration 059 (drop plumbing from Sparky)
// Usage:  node --env-file=.env.local scripts/run-migration-059.mjs
//
// Pre-flight: captures the pre-state row counts so deltas are visible
// in the runner output. Post-verify: confirms Sparky is single-trade
// (electrical only) and every plumbing-scoped row is gone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "059_drop_plumbing_for_sparky.sql");
const SPARKY_ID = "6dca084c-10d5-4459-b48f-9b45e4bbc68a";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function snapshot(client) {
  const { rows } = await client.query(
    `select
       (select trades from tenants where id = $1)                                 as trades,
       (select count(*)::int from pricing_book
          where tenant_id = $1 and trade = 'plumbing')                            as pricing_book_plumbing,
       (select count(*)::int from tenant_licences
          where tenant_id = $1 and trade = 'plumbing')                            as licences_plumbing,
       (select count(*)::int from tenant_service_offerings tso
          join shared_assemblies sa on sa.id = tso.assembly_id
          where tso.tenant_id = $1 and sa.trade = 'plumbing')                     as offerings_plumbing,
       (select count(*)::int from tenant_material_catalogue
          where tenant_id = $1 and category in (
            select category from shared_assemblies
            where category is not null
            group by category having every(trade = 'plumbing')
          ))                                                                      as catalogue_plumbing_categories,
       (select count(*)::int from pricing_book where tenant_id = $1)              as pricing_book_total,
       (select count(*)::int from pricing_book)                                   as pricing_book_global`,
    [SPARKY_ID],
  );
  return rows[0];
}

try {
  await c.connect();

  // ── PRE-FLIGHT ─────────────────────────────────────────────────
  const before = await snapshot(c);
  console.log("\nPre-state for Sparky:");
  console.table([before]);

  if (!before.trades || !before.trades.includes("plumbing")) {
    console.log("\n  • plumbing already dropped from Sparky — migration will be a no-op.");
  }

  // ── APPLY ──────────────────────────────────────────────────────
  console.log(`\n-> Applying 059_drop_plumbing_for_sparky.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  // ── POST-VERIFY ────────────────────────────────────────────────
  const after = await snapshot(c);
  console.log("\nPost-state for Sparky:");
  console.table([after]);

  // Assert every plumbing-scoped count is 0.
  const violations = [];
  if (after.pricing_book_plumbing !== 0) violations.push(`pricing_book_plumbing=${after.pricing_book_plumbing}`);
  if (after.licences_plumbing !== 0) violations.push(`licences_plumbing=${after.licences_plumbing}`);
  if (after.offerings_plumbing !== 0) violations.push(`offerings_plumbing=${after.offerings_plumbing}`);
  if (after.catalogue_plumbing_categories !== 0) violations.push(`catalogue_plumbing_categories=${after.catalogue_plumbing_categories}`);
  if (after.trades?.includes("plumbing")) violations.push(`trades still includes plumbing: ${JSON.stringify(after.trades)}`);

  if (violations.length > 0) {
    console.error("\nPOST-VERIFY FAIL:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log("\nOK All plumbing-scoped artefacts gone; Sparky is electrical-only.");

  // Confirm system-wide pricing_book count dropped by exactly 1.
  if (after.pricing_book_global !== before.pricing_book_global - 1) {
    console.error(
      `POST-VERIFY FAIL: pricing_book global went ${before.pricing_book_global} -> ${after.pricing_book_global} (expected -1)`,
    );
    process.exit(1);
  }
  console.log(`  pricing_book global: ${before.pricing_book_global} -> ${after.pricing_book_global}`);

  // Final summary of the wider system.
  const { rows: tenants } = await c.query(
    `select business_name, trades from tenants order by business_name`,
  );
  console.log("\nAll tenants now:");
  for (const t of tenants) console.log(`  ${t.business_name.padEnd(22)} ${JSON.stringify(t.trades)}`);

  console.log("\nOK migration 059 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
