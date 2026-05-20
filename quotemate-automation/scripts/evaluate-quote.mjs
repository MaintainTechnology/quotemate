// Pull a specific quote by share_token and trace every line item back
// to the catalogue + pricing book. Returns whether each price is
// grounded (matches a real DB row) or fabricated.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const TOKEN = process.argv[2] || "Mkt3qtQVSt-LWR1MM8YVCA";

try {
  await c.connect();

  // 1. Quote
  const { rows: quotes } = await c.query(
    `select id, intake_id, tenant_id, status, scope_of_works, good, better, best,
            selected_tier, subtotal_ex_gst, gst, total_inc_gst, deposit_pct,
            created_at, price_hold_until, share_token, routing_decision
       from quotes where share_token = $1`,
    [TOKEN],
  );
  if (quotes.length === 0) {
    console.error(`No quote found for token ${TOKEN}`);
    process.exit(1);
  }
  const q = quotes[0];

  console.log("═".repeat(78));
  console.log(`QUOTE  share_token=${TOKEN}`);
  console.log("═".repeat(78));
  console.log(`  id=${q.id}  intake_id=${q.intake_id}  tenant_id=${q.tenant_id}`);
  console.log(`  status=${q.status}  routing=${q.routing_decision}  created=${q.created_at.toISOString()}`);
  console.log(`  subtotal_ex_gst=$${q.subtotal_ex_gst}  gst=$${q.gst}  total_inc_gst=$${q.total_inc_gst}`);
  console.log(`  deposit_pct=${q.deposit_pct}%`);
  console.log(`  scope: ${q.scope_of_works?.slice(0, 200)}`);
  console.log("");

  // 2. Intake
  const { rows: intakes } = await c.query(
    `select id, job_type, suburb, trade, scope, caller, confidence, customer_id
       from intakes where id = $1`,
    [q.intake_id],
  );
  const i = intakes[0];
  console.log(`INTAKE: job_type=${i?.job_type}  suburb=${i?.suburb}  trade=${i?.trade}  confidence=${i?.confidence}`);
  console.log(`  scope=${JSON.stringify(i?.scope)?.slice(0, 220)}`);
  console.log(`  caller=${JSON.stringify(i?.caller)}`);
  console.log("");

  // 3. Tenant + pricing book
  const { rows: tenants } = await c.query(
    `select id, business_name, trade, trades from tenants where id = $1`,
    [q.tenant_id],
  );
  const t = tenants[0];
  console.log(`TENANT: ${t?.business_name ?? "(null)"}  trade=${t?.trade}  trades=${JSON.stringify(t?.trades)}`);

  const { rows: pb } = await c.query(
    `select * from pricing_book where tenant_id = $1 and trade = $2`,
    [q.tenant_id, i?.trade],
  );
  const book = pb[0];
  if (book) {
    console.log(`PRICING BOOK (${i.trade}):`);
    console.log(`  hourly_rate=$${book.hourly_rate}/hr  callout=$${book.call_out_minimum}  apprentice=$${book.apprentice_rate}  senior=$${book.senior_rate ?? "—"}`);
    console.log(`  markup=${book.default_markup_pct}%  risk_buffer=${book.risk_buffer_pct}%  min_hours=${book.min_labour_hours}`);
  } else {
    console.log(`PRICING BOOK: NONE FOUND for tenant_id+trade`);
  }
  console.log("");

  // 4. Relevant assemblies (electrical/fan)
  const { rows: assemblies } = await c.query(
    `select id, name, default_unit, default_unit_price_ex_gst, default_labour_hours, category, default_enabled
       from shared_assemblies where trade = $1 and (category = 'fan' or name ilike '%fan%')
       order by name`,
    [i?.trade],
  );
  console.log(`CANDIDATE ASSEMBLIES (fan category):`);
  for (const a of assemblies)
    console.log(`  "${a.name}"  price=$${a.default_unit_price_ex_gst}/${a.default_unit}  labour=${a.default_labour_hours}h  category=${a.category}`);
  console.log("");

  // 5. Relevant materials (fan)
  const { rows: materials } = await c.query(
    `select name, brand, unit, default_unit_price_ex_gst
       from shared_materials where trade = $1 and name ilike '%fan%'
       order by default_unit_price_ex_gst`,
    [i?.trade],
  );
  console.log(`CANDIDATE MATERIALS (shared, fan):`);
  for (const m of materials)
    console.log(`  "${m.name}"  brand=${m.brand}  $${m.default_unit_price_ex_gst}/${m.unit}`);
  console.log("");

  // 6. Tenant-owned material catalogue (fan)
  const { rows: tmc } = await c.query(
    `select name, brand, range_series, unit_price_ex_gst, customer_supply_price_ex_gst, tier_hint, active
       from tenant_material_catalogue
       where tenant_id = $1 and trade = $2 and (category ilike '%fan%' or name ilike '%fan%')`,
    [q.tenant_id, i?.trade],
  );
  console.log(`TENANT MATERIAL CATALOGUE (fan, this tenant):`);
  if (tmc.length === 0) console.log(`  (no tenant-owned fan products)`);
  for (const m of tmc)
    console.log(`  "${m.name}"  brand=${m.brand}/${m.range_series}  sell=$${m.unit_price_ex_gst}  customer_supply=$${m.customer_supply_price_ex_gst ?? "null"}  tier=${m.tier_hint}  active=${m.active}`);
  console.log("");

  // 7. Line items per tier
  for (const tier of ["good", "better", "best"]) {
    const data = q[tier];
    if (!data) continue;
    console.log("─".repeat(78));
    console.log(`TIER: ${tier.toUpperCase()}  ${data?.label ? "— " + data.label : ""}`);
    console.log("─".repeat(78));
    const items = Array.isArray(data) ? data : (data.line_items || data.items || data.lines || []);
    const total = data.total ?? data.subtotal ?? data.total_ex_gst ?? null;
    console.log(`  declared total (ex-GST?): ${total ?? "(see line items)"}`);
    if (data.summary || data.description) console.log(`  summary: ${data.summary ?? data.description}`);
    let sum = 0;
    for (const it of items) {
      const desc = it.description ?? it.name ?? "(no desc)";
      const qty = it.quantity ?? it.qty ?? 1;
      const unit = it.unit ?? "";
      const price = it.unit_price_ex_gst ?? it.unit_price ?? it.price ?? 0;
      const lineTotal = it.total_ex_gst ?? it.total ?? Number(price) * Number(qty);
      sum += Number(lineTotal) || 0;
      console.log(`    • ${String(desc).padEnd(54)} qty=${String(qty).padStart(3)} ${unit.padEnd(5)} @ $${price} = $${Number(lineTotal).toFixed(2)}`);
      if (it.source) console.log(`        source=${it.source}`);
    }
    const ex = Number(sum.toFixed(2));
    const gst = Number((ex * 0.1).toFixed(2));
    const inc = Number((ex + gst).toFixed(2));
    console.log(`    sum of line items ex-GST = $${ex}`);
    console.log(`    +10% GST = $${gst}`);
    console.log(`    inc-GST  = $${inc}`);
  }

  // 8. Quote-level totals
  console.log("");
  console.log("─".repeat(78));
  console.log(`QUOTE-LEVEL TOTALS (per quotes row):`);
  console.log(`  subtotal_ex_gst = $${q.subtotal_ex_gst}`);
  console.log(`  gst             = $${q.gst}`);
  console.log(`  total_inc_gst   = $${q.total_inc_gst}`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
