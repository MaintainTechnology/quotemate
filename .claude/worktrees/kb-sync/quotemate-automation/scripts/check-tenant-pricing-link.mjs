// One-off: verify the FK link between tenants and pricing_book.
// 1) FK metadata from information_schema (proves the relationship exists)
// 2) NOT NULL + unique-index state on pricing_book.tenant_id
// 3) Every tenant ←→ pricing_book row join, plus orphan checks both ways
//
// Run: node --env-file=.env.local scripts/check-tenant-pricing-link.mjs

import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n=== 1. FK metadata (information_schema) ===");
const fk = await client.query(`
  select
    tc.constraint_name,
    kcu.column_name      as fk_column,
    ccu.table_name       as references_table,
    ccu.column_name      as references_column,
    rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name
  join information_schema.referential_constraints rc
    on tc.constraint_name = rc.constraint_name
  where tc.table_name = 'pricing_book'
    and tc.constraint_type = 'FOREIGN KEY'
`);
console.table(fk.rows);

console.log("\n=== 2. pricing_book.tenant_id column state ===");
const col = await client.query(`
  select column_name, is_nullable, data_type
  from information_schema.columns
  where table_name = 'pricing_book' and column_name = 'tenant_id'
`);
console.table(col.rows);

console.log("\n=== 3. Unique indexes on pricing_book ===");
const idx = await client.query(`
  select indexname, indexdef
  from pg_indexes
  where tablename = 'pricing_book'
`);
console.table(idx.rows);

console.log("\n=== 4. Tenants ↔ pricing_book join (live data) ===");
const join = await client.query(`
  select
    t.business_name,
    t.status                       as tenant_status,
    t.trade                        as tenant_primary_trade,
    pb.trade                       as book_trade,
    pb.hourly_rate,
    pb.default_markup_pct          as markup_pct,
    pb.licence_type,
    pb.licence_state,
    pb.tenant_id is not null       as has_tenant_link
  from tenants t
  left join pricing_book pb on pb.tenant_id = t.id
  order by t.business_name, pb.trade
`);
console.table(join.rows);

console.log("\n=== 5. Orphan checks ===");
const orphanA = await client.query(`
  select count(*)::int as pricing_book_rows_with_null_tenant
  from pricing_book where tenant_id is null
`);
const orphanB = await client.query(`
  select count(*)::int as pricing_book_rows_pointing_at_missing_tenant
  from pricing_book pb
  left join tenants t on t.id = pb.tenant_id
  where pb.tenant_id is not null and t.id is null
`);
const tenantsNoBook = await client.query(`
  select t.business_name, t.trade, t.status
  from tenants t
  left join pricing_book pb on pb.tenant_id = t.id
  where pb.id is null
`);
console.table([
  orphanA.rows[0],
  orphanB.rows[0],
  { tenants_with_no_pricing_book: tenantsNoBook.rowCount },
]);
if (tenantsNoBook.rowCount > 0) {
  console.log("Tenants with no pricing_book row:");
  console.table(tenantsNoBook.rows);
}

await client.end();
