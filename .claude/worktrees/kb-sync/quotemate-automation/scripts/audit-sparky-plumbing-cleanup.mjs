// Pre-flight: enumerate every plumbing-scoped row on Sparky's tenant so
// we know exactly what migration 059 will delete.
//
// Run: node --env-file=.env.local scripts/audit-sparky-plumbing-cleanup.mjs

import pg from "pg";
const { Client } = pg;
const SPARKY_ID = "6dca084c-10d5-4459-b48f-9b45e4bbc68a";

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n=== 1. pricing_book / plumbing ===");
const pb = await client.query(
  `select id, trade, hourly_rate, default_markup_pct, licence_type, licence_state
   from pricing_book where tenant_id = $1 and trade = 'plumbing'`,
  [SPARKY_ID],
);
console.table(pb.rows);

console.log("\n=== 2. tenant_licences / plumbing ===");
const lic = await client.query(
  `select * from tenant_licences where tenant_id = $1 and trade = 'plumbing'`,
  [SPARKY_ID],
);
console.table(lic.rows);

console.log("\n=== 3. tenant_service_offerings for plumbing assemblies ===");
const tso = await client.query(
  `select sa.trade, count(*)::int as offering_rows, sum(case when tso.enabled then 1 else 0 end)::int as enabled
   from tenant_service_offerings tso
   join shared_assemblies sa on sa.id = tso.assembly_id
   where tso.tenant_id = $1
   group by sa.trade order by sa.trade`,
  [SPARKY_ID],
);
console.table(tso.rows);

console.log("\n=== 4. tenant_material_catalogue split by trade (via category heuristic) ===");
// tenant_material_catalogue stores its own copy of each material. The trade
// linkage isn't a column on this table — it's inferred from category, which
// aligns to shared_assemblies/shared_materials. Inspect raw rows so we can
// decide which are plumbing-only vs cross-trade.
const tmc = await client.query(
  `select id, category, name, brand, unit, unit_price_ex_gst, tier_hint, range_series
   from tenant_material_catalogue
   where tenant_id = $1
   order by category, name`,
  [SPARKY_ID],
);
console.table(tmc.rows);

console.log("\n=== 5. tenant_assembly_bom rows ===");
// BOM links a tenant-scoped assembly composition. Need to see which
// assembly each row points at to know its trade.
const bomCols = await client.query(
  `select column_name from information_schema.columns where table_name = 'tenant_assembly_bom' order by ordinal_position`,
);
console.log("  bom columns:", bomCols.rows.map((r) => r.column_name).join(", "));
const tab = await client.query(
  `select bom.*, sa.trade as assembly_trade, sa.name as assembly_name
   from tenant_assembly_bom bom
   left join shared_assemblies sa on sa.id = bom.assembly_id
   where bom.tenant_id = $1`,
  [SPARKY_ID],
);
console.table(tab.rows);

console.log("\n=== 6. tenant_assembly_overrides (if any) ===");
const taoCols = await client.query(
  `select column_name from information_schema.columns where table_name = 'tenant_assembly_overrides' order by ordinal_position`,
);
console.log("  overrides columns:", taoCols.rows.map((r) => r.column_name).join(", "));
const tao = await client.query(
  `select tao.* from tenant_assembly_overrides tao where tao.tenant_id = $1`,
  [SPARKY_ID],
);
console.table(tao.rows);

console.log("\n=== 7. tenant_custom_assemblies / plumbing ===");
const tca = await client.query(
  `select id, trade, name from tenant_custom_assemblies where tenant_id = $1`,
  [SPARKY_ID],
);
console.table(tca.rows);

console.log("\n=== 8. tenant_material_preferences ===");
const tmp = await client.query(
  `select * from tenant_material_preferences where tenant_id = $1`,
  [SPARKY_ID],
);
console.table(tmp.rows);

console.log("\n=== 9. tenant_tier_ladder ===");
const tier = await client.query(
  `select * from tenant_tier_ladder where tenant_id = $1`,
  [SPARKY_ID],
);
console.table(tier.rows);

console.log("\n=== 10. Final tenants.trades[] state ===");
const t = await client.query(
  `select id, business_name, trade, trades from tenants where id = $1`,
  [SPARKY_ID],
);
console.table(t.rows);

await client.end();
