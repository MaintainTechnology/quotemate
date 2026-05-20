// One-off: convert spurious cost_price_ex_gst = $0 rows to NULL on
// tenant_material_catalogue. $0 is worse than NULL because it poisons
// future margin reporting (every row shows 100% margin). NULL means
// "tradie hasn't entered it yet" — the correct state.
//
// Scope deliberately narrow: only rows where cost_price_ex_gst = 0 AND
// unit_price_ex_gst > 0 (a $0/$0 freebie row would be left alone).
// Prints each affected row first so the change is auditable.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await c.connect();

  const { rows: before } = await c.query(`
    select tmc.id, t.business_name, tmc.trade, tmc.category, tmc.name,
           tmc.brand, tmc.unit_price_ex_gst, tmc.cost_price_ex_gst
      from tenant_material_catalogue tmc
      join tenants t on t.id = tmc.tenant_id
      where tmc.cost_price_ex_gst = 0
        and tmc.unit_price_ex_gst > 0
      order by t.business_name, tmc.name`);

  if (before.length === 0) {
    console.log("  • no rows match the spurious-$0 pattern — nothing to fix");
    process.exit(0);
  }

  console.log(`  Found ${before.length} row(s) with cost_price=$0 and unit_price>$0:`);
  for (const r of before)
    console.log(
      `    [${r.business_name}] ${r.name.padEnd(36)} sell=$${r.unit_price_ex_gst}  cost=$0 (will become NULL)`,
    );

  const { rowCount } = await c.query(`
    update tenant_material_catalogue
       set cost_price_ex_gst = null
     where cost_price_ex_gst = 0
       and unit_price_ex_gst > 0`);
  console.log(`\n  ✓ updated ${rowCount} row(s)`);

  // Verify
  const { rows: after } = await c.query(`
    select count(*) c from tenant_material_catalogue
     where cost_price_ex_gst = 0 and unit_price_ex_gst > 0`);
  if (after[0].c !== "0") {
    console.error(`  ✗ ${after[0].c} rows still match the pattern — investigate`);
    process.exit(1);
  }
  console.log("  ✓ post-verify clean: 0 spurious-$0 rows remain");
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
