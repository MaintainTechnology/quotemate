// Drill into the suspect row: Sparky's plumbing book.
// Question: Is this row dormant-but-real (tradie planning to start plumbing)
// or pure dead weight (accidental tick during onboarding)?
//
// Signals: are they SET UP for plumbing? licence, service offerings,
// material catalogue, BOM, custom assemblies — anything plumbing-shaped.
//
// Run: node --env-file=.env.local scripts/audit-sparky-plumbing-readiness.mjs

import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const SPARKY_NAME = "Sparky";
const { rows: tt } = await client.query(
  `select id, business_name, trade, trades, state, status, created_at, owner_email
   from tenants where business_name = $1`,
  [SPARKY_NAME],
);
const sparky = tt[0];
if (!sparky) {
  console.log("No tenant named 'Sparky' found.");
  await client.end();
  process.exit(0);
}
console.log("\n=== Sparky tenant ===");
console.log(`  id:          ${sparky.id}`);
console.log(`  primary:     ${sparky.trade}`);
console.log(`  trades[]:    ${JSON.stringify(sparky.trades)}`);
console.log(`  state:       ${sparky.state}`);
console.log(`  status:      ${sparky.status}`);
console.log(`  created:     ${sparky.created_at.toISOString()}`);
console.log(`  email:       ${sparky.owner_email}`);

console.log("\n=== Both pricing_book rows ===");
const { rows: books } = await client.query(
  `select trade, hourly_rate, default_markup_pct, licence_type, licence_state,
          call_out_minimum, min_labour_hours, overlays
   from pricing_book where tenant_id = $1 order by trade`,
  [sparky.id],
);
for (const b of books) {
  console.log(`\n  ${b.trade}:`);
  console.log(`    hourly_rate         ${b.hourly_rate}`);
  console.log(`    markup_pct          ${b.default_markup_pct}`);
  console.log(`    licence             ${b.licence_type ?? "(null)"} / ${b.licence_state}`);
  console.log(`    call_out_minimum    ${b.call_out_minimum}`);
  console.log(`    min_labour_hours    ${b.min_labour_hours}`);
  console.log(`    overlays            ${JSON.stringify(b.overlays)}`);
}

console.log("\n=== Plumbing readiness signals for Sparky ===");

const lic = await client.query(
  `select count(*)::int n, array_agg(trade) trades from tenant_licences where tenant_id = $1`,
  [sparky.id],
);
console.log(`  tenant_licences:                       ${lic.rows[0].n} (${lic.rows[0].trades ?? "[]"})`);

const tso = await client.query(
  `select sa.trade, count(*)::int as enabled
   from tenant_service_offerings tso
   join shared_assemblies sa on sa.id = tso.assembly_id
   where tso.tenant_id = $1 and tso.enabled = true
   group by sa.trade order by sa.trade`,
  [sparky.id],
);
console.log(`  tenant_service_offerings (enabled):`);
for (const r of tso.rows) console.log(`    ${r.trade}: ${r.enabled}`);
if (tso.rowCount === 0) console.log(`    (none)`);

const tmc = await client.query(
  `select count(*)::int n from tenant_material_catalogue where tenant_id = $1`,
  [sparky.id],
);
console.log(`  tenant_material_catalogue rows:        ${tmc.rows[0].n}`);

const tca = await client.query(
  `select count(*)::int n from tenant_custom_assemblies where tenant_id = $1`,
  [sparky.id],
);
console.log(`  tenant_custom_assemblies rows:         ${tca.rows[0].n}`);

const tab = await client.query(
  `select count(*)::int n from tenant_assembly_bom where tenant_id = $1`,
  [sparky.id],
);
console.log(`  tenant_assembly_bom rows:              ${tab.rows[0].n}`);

const tmp = await client.query(
  `select count(*)::int n from tenant_material_preferences where tenant_id = $1`,
  [sparky.id],
);
console.log(`  tenant_material_preferences rows:      ${tmp.rows[0].n}`);

// Now do the same for Peppers (the legit cross-trade tenant) for comparison.
console.log("\n=== Compare: Peppers Plumbing (legit cross-trade) ===");
const { rows: pp } = await client.query(
  `select id from tenants where business_name = 'Peppers Plumbing'`,
);
if (pp[0]) {
  const ppId = pp[0].id;
  const ppLic = await client.query(
    `select count(*)::int n, array_agg(trade) trades from tenant_licences where tenant_id = $1`,
    [ppId],
  );
  const ppTso = await client.query(
    `select sa.trade, count(*)::int as enabled
     from tenant_service_offerings tso
     join shared_assemblies sa on sa.id = tso.assembly_id
     where tso.tenant_id = $1 and tso.enabled = true
     group by sa.trade order by sa.trade`,
    [ppId],
  );
  console.log(`  tenant_licences:                       ${ppLic.rows[0].n} (${ppLic.rows[0].trades ?? "[]"})`);
  console.log(`  tenant_service_offerings (enabled):`);
  for (const r of ppTso.rows) console.log(`    ${r.trade}: ${r.enabled}`);
}

await client.end();
