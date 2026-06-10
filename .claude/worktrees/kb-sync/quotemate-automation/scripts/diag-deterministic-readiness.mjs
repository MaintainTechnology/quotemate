// READ-ONLY diagnostic: can the DETERMINISTIC_BOM path actually fire for any tenant?
// It needs BOTH a per-tenant recipe (tenant_assembly_bom) AND a priced catalogue
// (tenant_material_catalogue) for the matched, enabled assembly. This counts each
// per tenant so we know whether the deterministic tier-pinning is dormant-for-lack-
// of-data or genuinely live for someone.
// Run: node --env-file=.env.local scripts/diag-deterministic-readiness.mjs
//  (from repo root: node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/diag-deterministic-readiness.mjs)

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

async function safeCount(label, sql) {
  try {
    const r = await c.query(sql);
    return r.rows;
  } catch (e) {
    console.log(`  (skip ${label}: ${e.message})`);
    return null;
  }
}

console.log("\n=== Active tenants ===");
const tenants = await c.query(`
  select id, business_name, trade, trades, status
  from tenants
  order by business_name
`);
console.table(tenants.rows.map(r => ({
  id: r.id.slice(0, 8), name: r.business_name, trade: r.trade,
  trades: JSON.stringify(r.trades), status: r.status,
})));

console.log("\n=== tenant_assembly_bom (per-tenant RECIPE) — rows per tenant ===");
const bom = await safeCount("tenant_assembly_bom", `
  select t.business_name, count(*)::int as recipe_rows,
         count(distinct b.assembly_id)::int as distinct_assemblies
  from tenant_assembly_bom b
  join tenants t on t.id = b.tenant_id
  group by t.business_name order by t.business_name
`);
if (bom) console.table(bom);
if (bom && bom.length === 0) console.log("  -> NO tenant has any recipe rows. Deterministic path cannot fire for anyone.");

console.log("\n=== tenant_material_catalogue (priced PRODUCTS) — rows per tenant ===");
const cat = await safeCount("tenant_material_catalogue", `
  select t.business_name,
         count(*)::int as total,
         count(*) filter (where m.active)::int as active,
         count(distinct m.category) filter (where m.active)::int as active_categories,
         count(*) filter (where m.active and m.tier_hint is not null)::int as with_tier_hint
  from tenant_material_catalogue m
  join tenants t on t.id = m.tenant_id
  group by t.business_name order by t.business_name
`);
if (cat) console.table(cat);

console.log("\n=== tenant_tier_ladder (explicit per-tier PIN) — rows per tenant ===");
const ladder = await safeCount("tenant_tier_ladder", `
  select t.business_name, count(*)::int as ladder_rows
  from tenant_tier_ladder l
  join tenants t on t.id = l.tenant_id
  group by t.business_name order by t.business_name
`);
if (ladder) console.table(ladder);
if (ladder && ladder.length === 0) console.log("  -> NO tier-ladder pins exist (and the live path omits tierLadder anyway).");

console.log("\n=== READINESS: tenants with BOTH a recipe AND an active priced catalogue ===");
const ready = await safeCount("readiness", `
  select t.business_name,
         count(distinct b.assembly_id)::int as recipe_assemblies,
         count(distinct m.id) filter (where m.active)::int as active_catalogue_rows
  from tenants t
  left join tenant_assembly_bom b on b.tenant_id = t.id
  left join tenant_material_catalogue m on m.tenant_id = t.id
  group by t.business_name order by t.business_name
`);
if (ready) {
  console.table(ready);
  const fireable = ready.filter(r => r.recipe_assemblies > 0 && r.active_catalogue_rows > 0);
  console.log(fireable.length
    ? `\n  -> ${fireable.length} tenant(s) COULD fire the deterministic path: ${fireable.map(r => r.business_name).join(", ")}`
    : `\n  -> ZERO tenants can fire the deterministic path today (missing recipe and/or priced catalogue).`);
}

await c.end();
console.log("\n(done — read-only, no writes performed)");
