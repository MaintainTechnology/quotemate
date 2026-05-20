// READ-ONLY: verify there are no actual (tenant_id, assembly_id) duplicates,
// and re-print offerings grouped by tenant_id (not business_name).

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await c.connect();

  // 1. Actual duplicate check (should be 0 since PK is (tenant_id, assembly_id))
  const { rows: dupes } = await c.query(`
    select tenant_id, assembly_id, count(*) c
      from tenant_service_offerings
      group by tenant_id, assembly_id having count(*) > 1`);
  console.log(`Actual (tenant_id, assembly_id) duplicates: ${dupes.length}`);

  // 2. Per-tenant counts using tenant_id (not name)
  const { rows: byTenant } = await c.query(`
    select tso.tenant_id, t.business_name, t.trades,
           count(*)::int n_offerings,
           count(*) filter (where tso.enabled)::int enabled_n,
           count(*) filter (where not tso.enabled)::int disabled_n
      from tenant_service_offerings tso
      join tenants t on t.id = tso.tenant_id
      group by tso.tenant_id, t.business_name, t.trades
      order by t.business_name, tso.tenant_id`);
  console.log("\n─── offerings per tenant (by id) ───────────────────────");
  for (const r of byTenant)
    console.log(
      `  ${r.business_name.padEnd(20)} ${String(r.tenant_id).slice(0, 8)}… trades=${JSON.stringify(r.trades)}  total=${r.n_offerings}  enabled=${r.enabled_n}  disabled=${r.disabled_n}`,
    );

  // 3. Spot-check Sparky 6dca explicitly
  const { rows: sparky } = await c.query(`
    select sa.trade, sa.name, tso.enabled
      from tenant_service_offerings tso
      join shared_assemblies sa on sa.id = tso.assembly_id
      where tso.tenant_id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
      order by sa.trade, sa.name`);
  console.log(`\n─── Sparky (6dca…) offerings: ${sparky.length} rows ─────────`);
  for (const r of sparky) console.log(`  ${r.enabled ? "✓" : "✗"} [${r.trade}] ${r.name}`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
