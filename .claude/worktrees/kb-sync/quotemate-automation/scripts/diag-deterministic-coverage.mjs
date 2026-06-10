// READ-ONLY: which assemblies have a deterministic recipe vs how many each tenant offers.
// Run: node --env-file=.env.local scripts/diag-deterministic-coverage.mjs

import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("\n=== Assemblies WITH a recipe (deterministic-capable today) ===");
const have = await c.query(`
  select t.business_name, a.name as assembly, a.trade,
         count(*)::int as recipe_lines,
         array_agg(distinct b.material_category) as categories
  from tenant_assembly_bom b
  join tenants t on t.id = b.tenant_id
  join shared_assemblies a on a.id = b.assembly_id
  group by t.business_name, a.name, a.trade
  order by t.business_name, a.name
`);
console.table(have.rows.map(r => ({
  tenant: r.business_name, assembly: r.assembly, trade: r.trade,
  lines: r.recipe_lines, categories: JSON.stringify(r.categories),
})));

console.log("\n=== COVERAGE: recipes vs enabled service offerings, per tenant ===");
const cov = await c.query(`
  with offered as (
    select tenant_id, count(*)::int as enabled_offerings
    from tenant_service_offerings
    where enabled is distinct from false
    group by tenant_id
  ),
  recipes as (
    select tenant_id, count(distinct assembly_id)::int as recipe_assemblies
    from tenant_assembly_bom
    group by tenant_id
  )
  select t.business_name,
         coalesce(r.recipe_assemblies, 0) as recipe_assemblies,
         coalesce(o.enabled_offerings, 0) as enabled_offerings
  from tenants t
  left join offered o on o.tenant_id = t.id
  left join recipes r on r.tenant_id = t.id
  order by t.business_name
`);
console.table(cov.rows.map(r => ({
  tenant: r.business_name,
  recipes: r.recipe_assemblies,
  offers: r.enabled_offerings,
  coverage: r.enabled_offerings ? `${Math.round(100 * r.recipe_assemblies / r.enabled_offerings)}%` : "n/a",
})));

await c.end();
console.log("\n(done — read-only)");
