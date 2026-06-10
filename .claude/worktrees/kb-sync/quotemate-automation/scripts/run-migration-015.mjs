// Apply sql/migrations/015_tenants_onboarding.sql to live Supabase.
// v6 multi-tenant foundation — adds tenants table, tenant_id columns on
// operational tables, tenant_service_offerings, and pricing_book gap-fixes.
// Idempotent — re-running is a no-op.
//
// Usage:  node --env-file=.env.local scripts/run-migration-015.mjs

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "sql", "migrations", "015_tenants_onboarding.sql"), "utf8");

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("→ Applying 015_tenants_onboarding.sql");
await c.query(sql);
console.log("✓ Migration applied\n");

// ─── Verify expected post-state ───────────────────────────────────
const tenants = await c.query(
  `select id, business_name, trade, state, status, owner_email
     from tenants order by created_at`,
);
const pbWithTenant = await c.query(
  `select pb.trade, pb.tenant_id, t.business_name
     from pricing_book pb
     left join tenants t on t.id = pb.tenant_id
    order by pb.trade`,
);
const tsoCount = await c.query(
  `select t.business_name, count(*)::int as offerings
     from tenant_service_offerings tso
     join tenants t on t.id = tso.tenant_id
    group by t.business_name`,
);
const cols = await c.query(
  `select column_name from information_schema.columns
    where table_name = 'pricing_book'
      and column_name in ('tenant_id','senior_rate','after_hours_multiplier')
    order by column_name`,
);

console.log("── tenants rows ──");
for (const r of tenants.rows) {
  console.log(`  ${r.business_name.padEnd(15)} ${r.trade.padEnd(10)} ${(r.state ?? '?').padEnd(4)} ${r.status.padEnd(10)} ${r.owner_email}`);
}

console.log("\n── pricing_book → tenant link ──");
for (const r of pbWithTenant.rows) {
  console.log(`  ${r.trade.padEnd(10)} tenant=${r.business_name ?? '(unlinked)'}`);
}

console.log("\n── tenant_service_offerings ──");
for (const r of tsoCount.rows) {
  console.log(`  ${r.business_name.padEnd(15)} ${r.offerings} services enabled`);
}

console.log("\n── new pricing_book columns ──");
for (const r of cols.rows) console.log(`  ${r.column_name}`);

await c.end();

const expectedColumns = ['after_hours_multiplier', 'senior_rate', 'tenant_id'];
const haveColumns = cols.rows.map(r => r.column_name).sort();
const missing = expectedColumns.filter(c => !haveColumns.includes(c));

if (missing.length > 0) {
  console.log(`\n⚠ Missing columns: ${missing.join(', ')}`);
  process.exit(1);
}
if (tenants.rows.length < 2) {
  console.log("\n⚠ Expected at least 2 pilot tenants backfilled, got " + tenants.rows.length);
  process.exit(1);
}
console.log("\n✓ Post-migration sanity check passed — v6 multi-tenant foundation is live");
