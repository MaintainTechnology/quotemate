// READ-ONLY: gather everything needed to author a safe shared_assembly_bom seed.
// Run: node --env-file=.env.local scripts/diag-seed-spec.mjs

import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("\n=== Existing shared_assembly_bom rows (the template + vocab) ===");
const existing = await c.query(`
  select a.name as assembly, a.trade, b.material_category, b.quantity, b.required, b.description, b.sort
  from shared_assembly_bom b join shared_assemblies a on a.id = b.assembly_id
  order by a.name, b.sort
`);
console.table(existing.rows);

console.log("\n=== Electrical shared_assemblies (id, name, labour) — candidate jobs ===");
const asm = await c.query(`
  select id, name, default_labour_hours
  from shared_assemblies where trade = 'electrical' order by name
`);
console.table(asm.rows.map(r => ({ id: r.id.slice(0,8), name: r.name, labour_h: r.default_labour_hours })));

console.log("\n=== shared_materials ELECTRICAL: priceable categories (the universal fallback) ===");
const sm = await c.query(`
  select category, count(*)::int as rows, min(default_unit_price_ex_gst) as min_price, max(default_unit_price_ex_gst) as max_price
  from shared_materials where trade = 'electrical'
  group by category order by category
`);
console.table(sm.rows);

console.log("\n=== Per-tenant catalogue: category x tier_hint coverage (electrical) ===");
const cat = await c.query(`
  select t.business_name, m.category, m.tier_hint, count(*)::int as n,
         min(m.unit_price_ex_gst) as min_p, max(m.unit_price_ex_gst) as max_p
  from tenant_material_catalogue m join tenants t on t.id = m.tenant_id
  where m.active and (m.trade = 'electrical' or m.trade is null)
  group by t.business_name, m.category, m.tier_hint
  order by t.business_name, m.category, m.tier_hint
`);
console.table(cat.rows);

await c.end();
console.log("\n(done — read-only)");
