// READ-ONLY diagnostic for the "agreed 15A GPO but quote locked a 10A GPO" bug.
// Run: node --env-file=.env.local scripts/diagnose-james-gpo-15a.mjs

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("\n=== Tenants (Atomix / Peppers) ===");
const tenants = await c.query(`
  select id, business_name, trade, trades
  from tenants
  where business_name ilike '%atom%' or business_name ilike '%pepper%'
  order by business_name
`);
console.table(tenants.rows.map(r => ({ id: r.id, name: r.business_name, trade: r.trade, trades: JSON.stringify(r.trades) })));

console.log("\n=== Atomix tenant_material_catalogue — GPO category rows (what WP9 can offer) ===");
const gpo = await c.query(`
  select tmc.id, t.business_name, tmc.category, tmc.name, tmc.brand, tmc.range_series,
         tmc.unit_price_ex_gst, tmc.tier_hint, tmc.is_preferred, tmc.active
  from tenant_material_catalogue tmc
  join tenants t on t.id = tmc.tenant_id
  where (t.business_name ilike '%atom%')
    and (tmc.category ilike '%gpo%' or tmc.name ilike '%gpo%' or tmc.name ilike '%power%' or tmc.name ilike '%outlet%')
  order by tmc.unit_price_ex_gst
`);
console.table(gpo.rows.map(r => ({
  name: r.name, cat: r.category, brand: r.brand, range: r.range_series,
  price: r.unit_price_ex_gst, tier: r.tier_hint, pref: r.is_preferred, active: r.active,
})));

console.log("\n=== ALL Atomix catalogue rows (any category mentioning amp/15/circuit) ===");
const amp = await c.query(`
  select tmc.name, tmc.category, tmc.unit_price_ex_gst
  from tenant_material_catalogue tmc
  join tenants t on t.id = tmc.tenant_id
  where t.business_name ilike '%atom%'
    and (tmc.name ilike '%15%' or tmc.name ilike '%amp%' or tmc.name ilike '%circuit%' or tmc.name ilike '%20a%')
  order by tmc.name
`);
console.table(amp.rows);

console.log("\n=== Recent power_points conversations for James (product_choice + circuit slot) ===");
const convs = await c.query(`
  select sc.id, sc.created_at, sc.conversation_state->'slots' as slots,
         sc.product_choice, sc.intake_id, t.business_name
  from sms_conversations sc
  left join tenants t on t.id = sc.tenant_id
  where (sc.conversation_state->'slots'->>'job_type' = 'power_points'
         or sc.conversation_state::text ilike '%sauna%'
         or sc.conversation_state::text ilike '%15a%')
  order by sc.created_at desc
  limit 6
`);
for (const s of convs.rows) {
  console.log(`\n  --- conv ${s.id}  (${s.business_name})  ${s.created_at?.toISOString?.() ?? s.created_at} ---`);
  console.log(`    slots:`, JSON.stringify(s.slots));
  console.log(`    product_choice:`, JSON.stringify(s.product_choice, null, 2).split("\n").join("\n      "));
  console.log(`    intake_id: ${s.intake_id}`);
}

console.log("\n=== Quote for the sauna intake (assumptions/scope/lines) ===");
if (convs.rowCount > 0) {
  const intakeId = convs.rows.find(r => r.intake_id)?.intake_id;
  if (intakeId) {
    const q = await c.query(
      `select id, status, routing_decision, scope_of_works, assumptions, risk_flags, good
       from quotes where intake_id = $1 order by created_at desc limit 2`,
      [intakeId],
    );
    for (const r of q.rows) {
      console.log(`\n  quote ${r.id} — status=${r.status} routing=${JSON.stringify(r.routing_decision)}`);
      console.log(`    scope_of_works: ${r.scope_of_works}`);
      console.log(`    assumptions:`, JSON.stringify(r.assumptions));
      console.log(`    risk_flags:`, JSON.stringify(r.risk_flags));
      const lines = r.good?.line_items ?? [];
      console.log(`    good line_items (${lines.length}):`);
      for (const li of lines) console.log(`      • ${li.description} | ${li.source} | $${li.unit_price_ex_gst}`);
    }
  }
}

await c.end();
console.log("\n[done]");
