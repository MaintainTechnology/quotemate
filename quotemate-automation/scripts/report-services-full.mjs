// READ-ONLY full services report — all info per service, per trade.
// Pulls pricing_book, shared_assemblies (with clarifying_questions +
// category), shared_materials, tenant overlays, tenant_custom_assemblies.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const fmt = (v) => (v === null || v === undefined ? "—" : v);
const money = (v) => (v === null || v === undefined ? "—" : `$${Number(v).toFixed(2)}`);

try {
  await c.connect();

  // 1. PRICING BOOK
  const { rows: pb } = await c.query(`
    select id, tenant_id, trade, hourly_rate, call_out_minimum, apprentice_rate,
           senior_rate, default_markup_pct, risk_buffer_pct, min_labour_hours,
           gst_registered, licence_type, licence_state, licence_number,
           licence_expiry, overlays
      from pricing_book order by trade, tenant_id`);

  // 2. TENANTS
  const { rows: tenants } = await c.query(`
    select id, business_name, status, trade, trades from tenants order by business_name`);

  // 3. SHARED ASSEMBLIES (full)
  const { rows: sa } = await c.query(`
    select id, trade, name, description, default_unit,
           default_unit_price_ex_gst, default_labour_hours, default_exclusions,
           category, clarifying_questions, default_enabled
      from shared_assemblies order by trade, name`);

  // 4. SHARED MATERIALS (full)
  const { rows: sm } = await c.query(`
    select id, trade, name, brand, unit, default_unit_price_ex_gst
      from shared_materials order by trade, name`);

  // 5. TENANT-LEVEL OVERLAYS / CUSTOM ROWS
  const { rows: tca } = await c.query(`
    select tca.id, tca.tenant_id, t.business_name, tca.trade, tca.name,
           tca.default_unit_price_ex_gst, tca.default_labour_hours,
           tca.category, tca.clarifying_questions
      from tenant_custom_assemblies tca
      join tenants t on t.id = tca.tenant_id
      order by t.business_name, tca.trade, tca.name`);

  const { rows: tso } = await c.query(`
    select tso.tenant_id, t.business_name, tso.assembly_id, sa.name as service_name,
           sa.trade, tso.enabled
      from tenant_service_offerings tso
      join tenants t on t.id = tso.tenant_id
      join shared_assemblies sa on sa.id = tso.assembly_id
      order by t.business_name, sa.trade, sa.name`);

  // 6. TENANT MATERIAL CATALOGUE (WP2)
  const { rows: tmc } = await c.query(`
    select count(*)::int as n from information_schema.tables
      where table_schema='public' and table_name='tenant_material_catalogue'`);
  let tmcRows = [];
  if (tmc[0].n) {
    const { rows } = await c.query(`
      select tmc.tenant_id, t.business_name, tmc.trade, tmc.category, tmc.name,
             tmc.brand, tmc.range_series, tmc.supplier, tmc.unit_price_ex_gst,
             tmc.cost_price_ex_gst, tmc.tier_hint, tmc.is_preferred, tmc.active
        from tenant_material_catalogue tmc
        join tenants t on t.id = tmc.tenant_id
        order by t.business_name, tmc.trade, tmc.category, tmc.name`);
    tmcRows = rows;
  }

  // ── Output ───────────────────────────────────────────────────────
  const line = (n = 78) => console.log("═".repeat(n));
  const sub = (n = 78) => console.log("─".repeat(n));

  line();
  console.log("QUOTEMATE — FULL SERVICES REPORT");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Supabase project ref: bobvihqwhtcbxneelfns`);
  line();

  // TENANTS
  console.log("\n# 1. TENANTS\n");
  for (const t of tenants) {
    const trades = Array.isArray(t.trades) && t.trades.length ? t.trades : t.trade ? [t.trade] : [];
    console.log(`• ${t.business_name}  [${t.status}]  trades=${JSON.stringify(trades)}  id=${t.id}`);
  }

  // PRICING BOOK
  console.log("\n");
  line();
  console.log("# 2. PRICING_BOOK");
  line();
  for (const b of pb) {
    const tName = tenants.find((t) => t.id === b.tenant_id)?.business_name ?? "(no tenant)";
    sub();
    console.log(`Trade: ${b.trade}    Tenant: ${tName}    id=${b.id}`);
    console.log(`  hourly_rate         ${money(b.hourly_rate)}/hr`);
    console.log(`  call_out_minimum    ${money(b.call_out_minimum)}`);
    console.log(`  apprentice_rate     ${money(b.apprentice_rate)}/hr`);
    console.log(`  senior_rate         ${b.senior_rate ? money(b.senior_rate) + "/hr" : "—"}`);
    console.log(`  default_markup_pct  ${fmt(b.default_markup_pct)}%`);
    console.log(`  risk_buffer_pct     ${fmt(b.risk_buffer_pct)}%`);
    console.log(`  min_labour_hours    ${fmt(b.min_labour_hours)}`);
    console.log(`  gst_registered      ${fmt(b.gst_registered)}`);
    console.log(`  licence             ${fmt(b.licence_type)} / ${fmt(b.licence_state)} / ${fmt(b.licence_number)}  exp=${fmt(b.licence_expiry)}`);
    if (b.overlays && Object.keys(b.overlays).length)
      console.log(`  overlays            ${JSON.stringify(b.overlays)}`);
  }

  // SHARED ASSEMBLIES grouped by trade
  for (const trade of ["electrical", "plumbing"]) {
    console.log("\n");
    line();
    console.log(`# 3. SHARED_ASSEMBLIES — ${trade.toUpperCase()}`);
    line();
    const rows = sa.filter((r) => r.trade === trade);
    console.log(`Total ${trade} assemblies: ${rows.length}`);
    for (const r of rows) {
      sub();
      console.log(`• ${r.name}`);
      console.log(`    id=${r.id}`);
      console.log(`    description           ${fmt(r.description)}`);
      console.log(`    unit                  ${fmt(r.default_unit)}`);
      console.log(`    default_price_ex_gst  ${money(r.default_unit_price_ex_gst)}`);
      console.log(`    default_labour_hours  ${fmt(r.default_labour_hours)}`);
      console.log(`    category              ${fmt(r.category)}`);
      console.log(`    default_enabled       ${fmt(r.default_enabled)}`);
      console.log(`    exclusions            ${fmt(r.default_exclusions)}`);
      if (r.clarifying_questions && Array.isArray(r.clarifying_questions) && r.clarifying_questions.length) {
        console.log(`    clarifying_questions  (${r.clarifying_questions.length}):`);
        r.clarifying_questions.forEach((q, i) => console.log(`      ${i + 1}. ${q}`));
      } else {
        console.log(`    clarifying_questions  — (NULL → universal name+suburb+scope only)`);
      }
    }
  }

  // SHARED MATERIALS grouped by trade
  for (const trade of ["electrical", "plumbing"]) {
    console.log("\n");
    line();
    console.log(`# 4. SHARED_MATERIALS — ${trade.toUpperCase()}`);
    line();
    const rows = sm.filter((r) => r.trade === trade);
    console.log(`Total ${trade} materials: ${rows.length}`);
    for (const r of rows) {
      console.log(
        `  • ${r.name.padEnd(45)} ${(r.brand ?? "—").padEnd(18)} ${(r.unit ?? "—").padEnd(6)} ${money(r.default_unit_price_ex_gst)}`,
      );
    }
  }

  // TENANT OVERLAYS — service offerings (enabled/disabled per tenant)
  console.log("\n");
  line();
  console.log(`# 5. TENANT_SERVICE_OFFERINGS — per-tenant on/off`);
  line();
  console.log(`Total rows: ${tso.length}`);
  let lastT = null;
  for (const r of tso) {
    if (r.business_name !== lastT) {
      console.log(`\n  ${r.business_name}`);
      lastT = r.business_name;
    }
    console.log(`    ${r.enabled ? "✓" : "✗"} [${r.trade}] ${r.service_name}`);
  }

  // TENANT CUSTOM ASSEMBLIES
  console.log("\n");
  line();
  console.log(`# 6. TENANT_CUSTOM_ASSEMBLIES — tenant-owned services`);
  line();
  console.log(`Total: ${tca.length}`);
  for (const r of tca) {
    sub();
    console.log(`• [${r.business_name}] ${r.name} (${r.trade})`);
    console.log(`    price ${money(r.default_unit_price_ex_gst)}  labour ${fmt(r.default_labour_hours)}  category ${fmt(r.category)}`);
    if (r.clarifying_questions && Array.isArray(r.clarifying_questions) && r.clarifying_questions.length) {
      console.log(`    clarifying_questions (${r.clarifying_questions.length}):`);
      r.clarifying_questions.forEach((q, i) => console.log(`      ${i + 1}. ${q}`));
    }
  }

  // TENANT MATERIAL CATALOGUE (WP2)
  console.log("\n");
  line();
  console.log(`# 7. TENANT_MATERIAL_CATALOGUE (WP2) — tenant-specific products`);
  line();
  console.log(`Total: ${tmcRows.length}`);
  for (const r of tmcRows) {
    console.log(
      `  [${r.business_name}] (${r.trade}/${r.category}) ${r.name}  brand=${r.brand ?? "—"} range=${r.range_series ?? "—"} sell=${money(r.unit_price_ex_gst)} cost=${money(r.cost_price_ex_gst)} tier=${r.tier_hint ?? "—"} preferred=${r.is_preferred} active=${r.active}`,
    );
  }

  // SUMMARY
  console.log("\n");
  line();
  console.log("# 8. SUMMARY COUNTS");
  line();
  for (const trade of ["electrical", "plumbing"]) {
    const a = sa.filter((r) => r.trade === trade);
    const withQ = a.filter((r) => Array.isArray(r.clarifying_questions) && r.clarifying_questions.length);
    const withCat = a.filter((r) => r.category);
    const m = sm.filter((r) => r.trade === trade);
    console.log(`\n  ${trade.toUpperCase()}`);
    console.log(`    assemblies                          ${a.length}`);
    console.log(`    assemblies with clarifying_questions ${withQ.length}`);
    console.log(`    assemblies with explicit category    ${withCat.length}`);
    console.log(`    materials                           ${m.length}`);
  }
  console.log(`\n  tenant_custom_assemblies               ${tca.length}`);
  console.log(`  tenant_material_catalogue              ${tmcRows.length}`);
  console.log(`  tenant_service_offerings               ${tso.length}`);
  console.log(`  pricing_book rows                      ${pb.length}`);
  console.log(`  tenants                                ${tenants.length}`);
  line();
} catch (e) {
  console.error("REPORT FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
