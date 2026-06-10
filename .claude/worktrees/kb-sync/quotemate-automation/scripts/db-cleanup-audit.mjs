// READ-ONLY database cleanup audit.
//
// For every `public` table:
//   1. Row count
//   2. Orphan count when the table carries `tenant_id` (tenant_id IS NULL)
//   3. Most recent activity (max(created_at) or fallback) — proxy for "is
//      this table still being written to?"
//   4. Code-usage signal from the static grep of app/ and lib/
//   5. Classification: ACTIVE / WRITTEN_BUT_UNREAD / READ_ONLY_CONFIG /
//      LEGACY / EMPTY_UNUSED / SCHEMA_ONLY
//
// Outputs:
//   • Pretty table to stdout
//   • JSON report at scripts/.db-audit-report.json (gitignored)
//
// THIS SCRIPT WRITES NOTHING. No drops, no deletes, no updates. Run as:
//   node --env-file=.env.local scripts/db-cleanup-audit.mjs

import fs from 'node:fs'
import pg from 'pg'

const { Client } = pg
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

// Code-usage map produced by the earlier grep audit (Section 02 of the
// architecture page). file → ops. Tables NOT in this map are dead at the
// code layer.
const CODE_USAGE = {
  admin_users:                 { readers: 1, writers: 0 },
  calls:                       { readers: 8, writers: 2 },
  categories:                  { readers: 1, writers: 0 },
  customers:                   { readers: 2, writers: 1 },
  import_batches:              { readers: 1, writers: 1 },
  import_staged_rows:          { readers: 1, writers: 1 }, // store.ts writes via insert; counted both
  intakes:                     { readers: 13, writers: 1 },
  payments:                    { readers: 1, writers: 0 },
  pricing_book:                { readers: 6, writers: 3 },
  quote_followup_events:       { readers: 2, writers: 1 },
  quote_line_items:            { readers: 1, writers: 0 }, // generator-only read; never written
  quotes:                      { readers: 14, writers: 7 },
  shared_assemblies:           { readers: 10, writers: 1 }, // writer is admin loader only
  shared_assembly_bom:         { readers: 4, writers: 0 },
  shared_materials:            { readers: 3, writers: 1 },
  sms_conversations:           { readers: 12, writers: 3 },
  sms_messages:                { readers: 6, writers: 1 },
  supplier_catalogue:          { readers: 3, writers: 1 },
  tenant_assembly_bom:         { readers: 2, writers: 3 },
  tenant_assembly_overrides:   { readers: 2, writers: 1 },
  tenant_custom_assemblies:    { readers: 4, writers: 2 },
  tenant_licences:             { readers: 1, writers: 2 },
  tenant_material_catalogue:   { readers: 9, writers: 3 },
  tenant_material_preferences: { readers: 1, writers: 1 },
  tenant_service_offerings:    { readers: 4, writers: 2 },
  tenant_tier_ladder:          { readers: 1, writers: 1 },
  tenants:                     { readers: 35, writers: 4 },
  trade_pricing_defaults:      { readers: 1, writers: 0 },
  trade_prompts:               { readers: 1, writers: 0 },
  trades:                      { readers: 2, writers: 0 },
  tradie_signup_intents:       { readers: 1, writers: 1 },
  tradies:                     { readers: 3, writers: 1 }, // legacy 1-row table
}

// Classification rules — applied in order, first match wins.
//   EMPTY_UNUSED     row_count == 0 AND no writers in code
//   SCHEMA_ONLY      row_count == 0 AND has writers (just no live traffic yet)
//   LEGACY           name in {tradies, quote_line_items} (known stale)
//   READ_ONLY_CONFIG no writers in code AND row_count > 0
//   WRITTEN_BUT_UNREAD writers > 0 AND readers == 0
//   ACTIVE           default
function classify(table, rowCount, usage) {
  if (table === 'tradies') return 'LEGACY'
  if (table === 'quote_line_items') return 'LEGACY'
  if (rowCount === 0 && (!usage || usage.writers === 0)) return 'EMPTY_UNUSED'
  if (rowCount === 0) return 'SCHEMA_ONLY'
  if (!usage || (usage.readers === 0 && usage.writers === 0)) return 'CODE_UNREFERENCED'
  if (usage.writers === 0) return 'READ_ONLY_CONFIG'
  if (usage.readers === 0) return 'WRITTEN_BUT_UNREAD'
  return 'ACTIVE'
}

try {
  await c.connect()

  // 1. Enumerate public tables.
  const { rows: tableRows } = await c.query(`
    select table_name
      from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `)
  const tables = tableRows.map((r) => r.table_name)

  // 2. For each table: row count, has-tenant_id, orphan count, last-write proxy.
  const report = []
  for (const t of tables) {
    // Row count
    const { rows: rc } = await c.query(`select count(*)::int n from "${t}"`)
    const rowCount = rc[0].n

    // tenant_id column present?
    const { rows: cols } = await c.query(`
      select column_name from information_schema.columns
        where table_schema='public' and table_name=$1
    `, [t])
    const columnNames = cols.map((r) => r.column_name)
    const hasTenantId = columnNames.includes('tenant_id')
    const hasCreatedAt = columnNames.includes('created_at')

    let orphanCount = null
    if (hasTenantId && rowCount > 0) {
      const { rows: or } = await c.query(`select count(*)::int n from "${t}" where tenant_id is null`)
      orphanCount = or[0].n
    }

    let lastActivity = null
    if (hasCreatedAt && rowCount > 0) {
      const { rows: la } = await c.query(`select max(created_at)::text d from "${t}"`)
      lastActivity = la[0].d
    }

    const usage = CODE_USAGE[t] ?? null
    const klass = classify(t, rowCount, usage)

    report.push({
      table: t,
      rowCount,
      orphanCount,
      lastActivity,
      hasTenantId,
      readers: usage?.readers ?? 0,
      writers: usage?.writers ?? 0,
      classification: klass,
      columnCount: columnNames.length,
    })
  }

  // 3. Pretty-print, grouped by classification.
  const order = [
    'CODE_UNREFERENCED', 'LEGACY', 'EMPTY_UNUSED', 'WRITTEN_BUT_UNREAD',
    'SCHEMA_ONLY', 'READ_ONLY_CONFIG', 'ACTIVE',
  ]
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  Database cleanup audit · ' + new Date().toISOString())
  console.log('═══════════════════════════════════════════════════════\n')

  for (const klass of order) {
    const rowsForClass = report.filter((r) => r.classification === klass)
    if (rowsForClass.length === 0) continue
    console.log(`── ${klass} (${rowsForClass.length}) ──`)
    console.log('  table                          rows  orphans   readers  writers  last_activity')
    for (const r of rowsForClass) {
      const orph = r.orphanCount === null ? '   -' : String(r.orphanCount).padStart(4)
      const la = r.lastActivity ? r.lastActivity.slice(0, 10) : '—'
      console.log(
        '  ' + r.table.padEnd(32) +
        String(r.rowCount).padStart(5) + '  ' +
        orph + '     ' +
        String(r.readers).padStart(3) + '     ' +
        String(r.writers).padStart(3) + '    ' +
        la
      )
    }
    console.log('')
  }

  // 4. Orphan summary across active tables.
  const orphans = report.filter((r) => (r.orphanCount ?? 0) > 0)
  if (orphans.length > 0) {
    console.log('── ORPHAN ROWS (tenant_id IS NULL on a per-tenant table) ──')
    let totalOrphans = 0
    for (const r of orphans) {
      totalOrphans += r.orphanCount
      const pct = ((r.orphanCount / r.rowCount) * 100).toFixed(0)
      console.log(`  ${r.table.padEnd(32)} ${String(r.orphanCount).padStart(4)} / ${r.rowCount} (${pct}%)`)
    }
    console.log(`  TOTAL ORPHAN ROWS: ${totalOrphans}\n`)
  }

  // 5. Drop-candidates summary (no destructive action).
  const dropCandidates = report.filter((r) =>
    r.classification === 'LEGACY' ||
    r.classification === 'EMPTY_UNUSED' ||
    r.classification === 'CODE_UNREFERENCED'
  )
  if (dropCandidates.length > 0) {
    console.log('── DROP CANDIDATES (no destructive action taken) ──')
    for (const r of dropCandidates) {
      console.log(`  ${r.table.padEnd(32)} rows=${r.rowCount}  ${r.classification}`)
    }
    console.log('')
  }

  fs.writeFileSync(
    'scripts/.db-audit-report.json',
    JSON.stringify(report, null, 2),
  )
  console.log('JSON report → scripts/.db-audit-report.json')
} catch (e) {
  console.error('AUDIT FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
