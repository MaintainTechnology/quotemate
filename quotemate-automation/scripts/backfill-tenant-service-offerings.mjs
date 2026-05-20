// QuoteMate · v7 Phase 1 backfill — ensure every activated tenant has an
// explicit tenant_service_offerings row for every shared_assembly in
// their trade(s).
//
// Why this script exists: the activate route has been explicitly seeding
// tenant_service_offerings since the multi-trade refactor (route.ts:180
// pre-v7), but tenants activated before that — or whose seed didn't
// complete (Supabase blip, RLS reject, etc.) — are still on the implicit
// fallback in /api/tenant/me (which derives enabled from
// shared_assemblies.default_enabled when no row exists). The fallback
// works fine, but it leaves the dashboard's "X of Y services on" count
// reading from a synthetic shape rather than real DB rows, and it
// silently re-enables an assembly the tradie thought they'd disabled
// IF their offerings row was lost in a partial-failure activate.
//
// What it does:
//   1. List every activated tenant (activated_at is not null)
//   2. For each: fetch their trades, fetch shared_assemblies in those
//      trades, compare to existing tenant_service_offerings rows
//   3. Insert the missing rows with enabled = shared_assemblies.default_enabled
//      (matches /lib/onboard/seed-tenant-defaults.ts exactly).
//
// Idempotent: uses ON CONFLICT DO NOTHING (NOT update), so any row
// already present — including ones a tradie has manually toggled OFF —
// is preserved untouched.
//
// Two modes:
//   node --env-file=.env.local scripts/backfill-tenant-service-offerings.mjs
//     → dry-run; prints what WOULD be inserted, writes nothing
//   node --env-file=.env.local scripts/backfill-tenant-service-offerings.mjs --apply
//     → applies the inserts; reports actual rowcount.

import pg from 'pg'

const { Client } = pg
const APPLY = process.argv.includes('--apply')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log(`Mode: ${APPLY ? 'APPLY (will insert rows)' : 'DRY-RUN (read-only)'}\n`)

  // ── 1. All activated tenants with their trades ────────────────
  const tenantsRes = await client.query(
    "select id, business_name, trade, trades, activated_at " +
      'from tenants ' +
      'where activated_at is not null ' +
      'order by activated_at',
  )
  console.log(`Activated tenants: ${tenantsRes.rows.length}\n`)

  // Pre-fetch assemblies once per trade so we don't hit the DB per tenant.
  const tradeSet = new Set()
  for (const t of tenantsRes.rows) {
    const list = Array.isArray(t.trades) && t.trades.length > 0 ? t.trades : t.trade ? [t.trade] : []
    for (const tr of list) tradeSet.add(tr)
  }
  const assembliesByTrade = new Map()
  for (const trade of tradeSet) {
    const r = await client.query(
      "select id, default_enabled from shared_assemblies where trade = $1",
      [trade],
    )
    assembliesByTrade.set(trade, r.rows)
  }

  let totalCandidates = 0
  let totalMissing = 0
  let totalInserted = 0

  for (const t of tenantsRes.rows) {
    const trades = Array.isArray(t.trades) && t.trades.length > 0
      ? t.trades
      : t.trade
        ? [t.trade]
        : []
    if (trades.length === 0) {
      console.log(`  ${t.business_name ?? t.id}: no trades — skipping`)
      continue
    }

    // Existing offerings for this tenant.
    const existing = await client.query(
      'select assembly_id from tenant_service_offerings where tenant_id = $1',
      [t.id],
    )
    const have = new Set(existing.rows.map((r) => r.assembly_id))

    // Candidate assemblies = all shared_assemblies in any of the tenant's trades.
    let candidates = []
    for (const trade of trades) {
      candidates = candidates.concat(assembliesByTrade.get(trade) ?? [])
    }
    const missing = candidates.filter((a) => !have.has(a.id))
    totalCandidates += candidates.length
    totalMissing += missing.length

    console.log(
      `  ${t.business_name ?? t.id} [${trades.join(', ')}]: ` +
        `${have.size}/${candidates.length} present, ${missing.length} missing`,
    )

    if (missing.length === 0) continue

    if (APPLY) {
      // Insert missing rows. ON CONFLICT DO NOTHING so a race or a
      // partial prior backfill can't double-insert (PK = tenant_id+assembly_id).
      // enabled = default_enabled — matches seed-tenant-defaults.ts exactly.
      const values = []
      const params = []
      let p = 1
      for (const a of missing) {
        values.push(`($${p++}, $${p++}, $${p++})`)
        params.push(t.id, a.id, a.default_enabled === null || a.default_enabled === undefined ? true : a.default_enabled)
      }
      const sql =
        'insert into tenant_service_offerings (tenant_id, assembly_id, enabled) values ' +
        values.join(', ') +
        ' on conflict (tenant_id, assembly_id) do nothing'
      const ins = await client.query(sql, params)
      totalInserted += ins.rowCount ?? 0
      console.log(`    +${ins.rowCount} rows inserted`)
    } else {
      // Dry-run: show the first 5 missing assembly IDs so the operator
      // can spot-check what would be inserted.
      const sample = missing.slice(0, 5).map((a) => a.id).join(', ')
      const more = missing.length > 5 ? ` (+ ${missing.length - 5} more)` : ''
      console.log(`    would insert: ${sample}${more}`)
    }
  }

  console.log(
    `\nSummary: candidates=${totalCandidates}, missing=${totalMissing}, inserted=${totalInserted}`,
  )
  if (!APPLY && totalMissing > 0) {
    console.log('\nDry-run complete. Re-run with --apply to insert the missing rows.')
  }
} catch (err) {
  console.error('Backfill failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
