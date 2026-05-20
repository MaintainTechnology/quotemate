// QuoteMate · audit script for Phase 0 (v7 catalogue-as-template).
//
// Question we need answered before consolidating the duplicate "enabled"
// surface: does any row in tenant_assembly_overrides have enabled=false?
//
// Background: tenant_assembly_overrides.enabled is read ONLY by
// /api/tenant/estimation/route.ts (cosmetic "disabled for you" badge on
// the Estimation tab). No UI writes to it. tenant_service_offerings.enabled
// is the actual money-path source of truth (Services-tab → estimator).
//
// If this audit returns 0 false rows, Phase 0 is a pure code change:
// point /api/tenant/estimation at tenant_service_offerings and drop
// `enabled` from the AssemblyOverride type. No data migration.
//
// If it returns N>0 false rows, those tradies had an assembly disabled
// through a non-UI path (a script, a manual DB edit). They'd be silently
// re-enabled in the Estimation tab badge — we'd want to migrate them to
// tenant_service_offerings before flipping the read.
//
// Read-only. Safe to run anytime. Usage:
//   node --env-file=.env.local scripts/audit-overrides-enabled.mjs

import pg from 'pg'

const { Client } = pg

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()

  // Total rows in tenant_assembly_overrides (any).
  const total = await client.query('select count(*)::int as n from tenant_assembly_overrides')
  console.log(`tenant_assembly_overrides total rows:        ${total.rows[0].n}`)

  // Rows with enabled=false — these are the orphans we'd silently flip
  // to "enabled" if Phase 0 just re-points the read.
  const disabled = await client.query(
    "select count(*)::int as n from tenant_assembly_overrides where enabled = false",
  )
  console.log(`tenant_assembly_overrides enabled=false:     ${disabled.rows[0].n}`)

  // Rows with any real override (labour or markup) — these are the rows
  // that justify keeping the table at all once `enabled` is removed.
  const withOverrides = await client.query(
    'select count(*)::int as n from tenant_assembly_overrides ' +
      'where labour_hours_override is not null or markup_pct_override is not null',
  )
  console.log(`tenant_assembly_overrides w/ labour|markup:  ${withOverrides.rows[0].n}`)

  // Show any rows with enabled=false so we can decide whether to migrate
  // them into tenant_service_offerings before flipping the read.
  if (disabled.rows[0].n > 0) {
    const samples = await client.query(
      'select tenant_id, assembly_id, labour_hours_override, markup_pct_override, updated_at ' +
        'from tenant_assembly_overrides where enabled = false ' +
        'order by updated_at desc limit 20',
    )
    console.log('\nSample disabled rows (up to 20):')
    for (const r of samples.rows) {
      console.log(
        `  tenant=${r.tenant_id} assembly=${r.assembly_id} ` +
          `labour=${r.labour_hours_override} markup=${r.markup_pct_override} ` +
          `updated=${r.updated_at}`,
      )
    }
  }

  // Sanity: how many tenant_service_offerings rows do we have, for
  // context on whether Phase 1's seed/backfill has work to do.
  const offerings = await client.query(
    "select count(*)::int as n, count(*) filter (where enabled = true)::int as on " +
      'from tenant_service_offerings',
  )
  console.log(
    `\ntenant_service_offerings total: ${offerings.rows[0].n} ` +
      `(enabled=true: ${offerings.rows[0].on})`,
  )

  // Plus tenant count, so we know what 100%-seeded would look like.
  const tenants = await client.query(
    "select count(*)::int as n from tenants where activated_at is not null",
  )
  console.log(`activated tenants:              ${tenants.rows[0].n}`)

  // Shared assemblies per trade, so we can estimate the Phase 1 backfill row count
  // (each activated tenant should have one offering row per assembly in their trade).
  const sharedByTrade = await client.query(
    'select trade, count(*)::int as n from shared_assemblies group by trade order by trade',
  )
  console.log('\nshared_assemblies by trade:')
  for (const r of sharedByTrade.rows) {
    console.log(`  ${r.trade}: ${r.n}`)
  }
} catch (err) {
  console.error('Audit failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
