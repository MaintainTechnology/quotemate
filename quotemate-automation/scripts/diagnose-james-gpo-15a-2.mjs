// READ-ONLY follow-up: catalogue row timeline + the screenshot-3 quote.
// Run: node --env-file=.env.local scripts/diagnose-james-gpo-15a-2.mjs
import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("\n=== Atomix GPO catalogue rows — creation/update timeline ===");
const rows = await c.query(`
  select tmc.id, tmc.name, tmc.unit_price_ex_gst, tmc.tier_hint, tmc.is_preferred,
         tmc.active, tmc.created_at, tmc.updated_at
  from tenant_material_catalogue tmc
  join tenants t on t.id = tmc.tenant_id
  where t.business_name ilike '%atom%' and tmc.category = 'gpo'
  order by tmc.created_at
`);
for (const r of rows.rows) {
  console.log(`  • ${r.name}`);
  console.log(`      id=${r.id} price=$${r.unit_price_ex_gst} tier=${r.tier_hint} pref=${r.is_preferred} active=${r.active}`);
  console.log(`      created=${r.created_at?.toISOString?.() ?? r.created_at}  updated=${r.updated_at?.toISOString?.() ?? r.updated_at}`);
}

console.log("\n=== Offer timeline (from the two conversations) ===");
console.log("  conv 20dfea8a (screenshot 1, token ca78c205): offered_at 2026-05-29T09:45:54Z  → ONE option (10A)");
console.log("  conv 96a2a870 (later retry, token 249161be):   offered_at 2026-05-29T10:25:24Z  → TWO options (10A + 15Amp)");

console.log("\n=== Quote for screenshot-3 intake 40867514 (chose 10A) ===");
const q1 = await c.query(
  `select id, status, routing_decision, scope_of_works, assumptions, risk_flags, good, better, best, created_at
   from quotes where intake_id = $1 order by created_at desc`,
  ["40867514-0110-41f0-8e66-cb7f66584015"],
);
for (const r of q1.rows) {
  console.log(`\n  quote ${r.id}  status=${r.status}  routing=${JSON.stringify(r.routing_decision)}  created=${r.created_at?.toISOString?.()}`);
  console.log(`    scope_of_works: ${r.scope_of_works}`);
  console.log(`    assumptions: ${JSON.stringify(r.assumptions)}`);
  console.log(`    risk_flags:  ${JSON.stringify(r.risk_flags)}`);
  for (const tier of ["good", "better", "best"]) {
    const lines = r[tier]?.line_items ?? [];
    if (lines.length) {
      console.log(`    ${tier} line_items (${lines.length}):`);
      for (const li of lines) console.log(`      • ${li.description} | ${li.source} | $${li.unit_price_ex_gst}`);
    }
  }
}

console.log("\n=== Quote for the 15Amp-chosen intake 0bf6b2d0 (did it use the 15A?) ===");
const q2 = await c.query(
  `select id, status, routing_decision, scope_of_works, assumptions, good, created_at
   from quotes where intake_id = $1 order by created_at desc`,
  ["0bf6b2d0-2ad5-4225-8dbd-162e7ce837e2"],
);
for (const r of q2.rows) {
  console.log(`\n  quote ${r.id}  status=${r.status}  routing=${JSON.stringify(r.routing_decision)}`);
  console.log(`    scope_of_works: ${r.scope_of_works}`);
  console.log(`    assumptions: ${JSON.stringify(r.assumptions)}`);
  const lines = r.good?.line_items ?? [];
  console.log(`    good line_items (${lines.length}):`);
  for (const li of lines) console.log(`      • ${li.description} | ${li.source} | $${li.unit_price_ex_gst}`);
}

await c.end();
console.log("\n[done]");
