// READ-ONLY: what's still missing on tenant_material_catalogue after
// migration 038 (which may have cleaned up some rows via CASCADE).

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await c.connect();

  const { rows } = await c.query(`
    select tmc.id, t.business_name, tmc.trade, tmc.category, tmc.name,
           tmc.brand, tmc.range_series, tmc.unit_price_ex_gst,
           tmc.cost_price_ex_gst, tmc.tier_hint, tmc.is_preferred, tmc.active
      from tenant_material_catalogue tmc
      join tenants t on t.id = tmc.tenant_id
      order by t.business_name, tmc.trade, tmc.category, tmc.unit_price_ex_gst`);

  console.log(`tenant_material_catalogue rows after mig-038: ${rows.length}\n`);

  console.log("─── ALL rows ─────────────────────────────────────────");
  for (const r of rows) {
    const cost = r.cost_price_ex_gst === null ? "NULL" :
                 Number(r.cost_price_ex_gst) === 0 ? "$0.00 ⚠" : `$${r.cost_price_ex_gst}`;
    const tier = r.tier_hint === null ? "NULL ⚠" : r.tier_hint;
    console.log(
      `  [${r.business_name}] ${(r.trade + "/" + r.category).padEnd(20)} ${r.name.padEnd(36)} brand=${(r.brand ?? "—").padEnd(12)} range=${(r.range_series ?? "—").padEnd(12)} sell=$${r.unit_price_ex_gst}  cost=${cost.padEnd(8)} tier=${tier} pref=${r.is_preferred} active=${r.active}`,
    );
  }

  const missingCost = rows.filter((r) => r.cost_price_ex_gst === null || Number(r.cost_price_ex_gst) === 0);
  const missingTier = rows.filter((r) => r.tier_hint === null);

  console.log(`\n─── Gaps ────────────────────────────────────────────`);
  console.log(`  Rows with NULL or $0 cost_price_ex_gst: ${missingCost.length}/${rows.length}`);
  console.log(`  Rows with NULL tier_hint:               ${missingTier.length}/${rows.length}`);

  // Check sell-price column for context on what cost might reasonably be
  if (missingCost.length) {
    console.log(`\n  Rows lacking real cost (showing sell price for context):`);
    for (const r of missingCost)
      console.log(`    [${r.business_name}] ${r.name.padEnd(36)} sell=$${r.unit_price_ex_gst}  cost=${r.cost_price_ex_gst ?? "null"}`);
  }
  if (missingTier.length) {
    console.log(`\n  Rows lacking tier_hint:`);
    for (const r of missingTier)
      console.log(`    [${r.business_name}] ${r.name.padEnd(36)} brand=${r.brand ?? "—"} range=${r.range_series ?? "—"} sell=$${r.unit_price_ex_gst}`);
  }
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
