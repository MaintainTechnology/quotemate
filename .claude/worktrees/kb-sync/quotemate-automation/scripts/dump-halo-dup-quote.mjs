// Dump the two duplicate-Halo quotes in full, including tenant + intake context.

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const ids = [
  "5ad1ca16-d145-4359-86a9-715151088611",
  "ca7ded23-f846-44d8-9ab9-877f71b4a8cc",
];

for (const id of ids) {
  const { rows } = await c.query(
    `
    select q.id, q.tenant_id, q.intake_id, q.status, q.routing_decision,
           q.created_at,
           q.good, q.better, q.best,
           t.business_name, t.trade as tenant_trade, t.trades as tenant_trades,
           t.status as tenant_status,
           i.job_type, i.trade, i.suburb, i.scope, i.confidence,
           i.created_at as intake_created_at
      from quotes q
      left join tenants t on t.id = q.tenant_id
      left join intakes i on i.id = q.intake_id
     where q.id = $1
    `,
    [id]
  );
  if (!rows.length) {
    console.log(`NOT FOUND: ${id}`);
    continue;
  }
  const q = rows[0];
  console.log("\n====================================================================");
  console.log(`Quote ${q.id}`);
  console.log(`  tenant_id     = ${q.tenant_id}`);
  console.log(`  tenant.name   = ${q.business_name}`);
  console.log(`  tenant.trade  = ${q.tenant_trade}  trades=${JSON.stringify(q.tenant_trades)}`);
  console.log(`  tenant.status = ${q.tenant_status}`);
  console.log(`  status        = ${q.status}  routing=${q.routing_decision}`);
  console.log(`  created       = ${q.created_at.toISOString()}`);
  console.log(`  intake_id     = ${q.intake_id}  intake.job_type=${q.job_type}  trade=${q.trade}  suburb=${q.suburb}  confidence=${q.confidence}`);
  console.log(`  intake.scope:`);
  console.log(JSON.stringify(q.scope, null, 2).split("\n").map((l) => "    " + l).join("\n"));

  for (const tier of ["good", "better", "best"]) {
    const t = q[tier];
    console.log(`\n  === ${tier.toUpperCase()} TIER ===`);
    if (!t) {
      console.log("    (null)");
      continue;
    }
    console.log(`  keys: ${Object.keys(t).join(", ")}`);
    const items = t.line_items ?? t.lineItems ?? t.items ?? t.lines ?? null;
    if (items) {
      console.log(`  line_items (${items.length}):`);
      for (const li of items) {
        console.log("   ", JSON.stringify(li));
      }
    }
    // Print other tier-level fields too (totals, narrative, etc.)
    const meta = { ...t };
    delete meta.line_items;
    delete meta.lineItems;
    delete meta.items;
    delete meta.lines;
    if (Object.keys(meta).length) {
      console.log(`  tier meta:`);
      console.log(JSON.stringify(meta, null, 2).split("\n").map((l) => "    " + l).join("\n"));
    }
  }
}

// And what is the catalogue row for 7cae921a-… ?
console.log("\n\n====================================================================");
console.log("Catalogue lookups for the duplicate material id");

const matRows = await c.query(
  `
  select id, tenant_id, name, brand_hint, sku, price_ex_gst, markup_pct,
         markup_locked, supplied_by, customer_supply_price_ex_gst,
         category, source, created_at
    from supplier_catalogue
   where id = '7cae921a-fa42-4755-a915-c6eb6e951088'
  `
);
console.log(`supplier_catalogue rows for 7cae921a-… : ${matRows.rows.length}`);
for (const r of matRows.rows) console.log(JSON.stringify(r, null, 2));

// Maybe it's in shared_materials instead.
const shRows = await c.query(
  `
  select id, name, brand_hint, category, unit, default_price_ex_gst, trade
    from shared_materials
   where id = '7cae921a-fa42-4755-a915-c6eb6e951088'
  `
);
console.log(`\nshared_materials rows for 7cae921a-… : ${shRows.rows.length}`);
for (const r of shRows.rows) console.log(JSON.stringify(r, null, 2));

// Any row in either table where name ilike 'Brilliant Halo%'
const brillCat = await c.query(
  `
  select id, tenant_id, name, price_ex_gst, markup_pct, source
    from supplier_catalogue
   where name ilike '%brilliant halo%'
   order by created_at desc
  `
);
console.log(`\nsupplier_catalogue 'Brilliant Halo' rows: ${brillCat.rows.length}`);
for (const r of brillCat.rows) console.log("  ", JSON.stringify(r));

const brillSh = await c.query(
  `
  select id, name, default_price_ex_gst, trade
    from shared_materials
   where name ilike '%brilliant halo%'
  `
);
console.log(`\nshared_materials 'Brilliant Halo' rows: ${brillSh.rows.length}`);
for (const r of brillSh.rows) console.log("  ", JSON.stringify(r));

await c.end();
