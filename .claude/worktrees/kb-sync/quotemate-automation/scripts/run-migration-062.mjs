// QuoteMate · run migration 062 (move available_slots tradies → tenants)
// Usage:  node --env-file=.env.local scripts/run-migration-062.mjs
//
// Phase 2a of the 2026-05-26 cleanup audit. Additive: adds an
// available_slots column to tenants and backfills it from the (single)
// tradies row. Tradies table stays alive — drop happens in migration 063
// after the code has been switched over.
//
// Pre-flight: prints today's tradies row slot count + tenants row count.
// Post-verify: confirms the column exists on tenants and all rows have
// it backfilled.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '062_tenants_available_slots.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  // Pre-flight: snapshot source + target.
  console.log('─── pre-flight ────────────────────────────')
  const { rows: tradieRows } = await c.query(`
    select count(*)::int as n,
           coalesce(jsonb_array_length((select available_slots from tradies limit 1)), 0)::int as slot_count
    from tradies`)
  console.log('  tradies rows:', tradieRows[0].n, '· slot count on the pilot row:', tradieRows[0].slot_count)

  const { rows: tenantRows } = await c.query(`select count(*)::int as n from tenants`)
  console.log('  tenants rows that will be backfilled:', tenantRows[0].n)

  // Execute.
  console.log('\n─── executing migration 062 ──────────────')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  // Post-verify.
  console.log('\n─── post-verify ──────────────────────────')
  const { rows: colCheck } = await c.query(`
    select 1 from information_schema.columns
      where table_schema='public' and table_name='tenants' and column_name='available_slots'`)
  console.log('  tenants.available_slots column present:', colCheck.length === 1 ? 'YES ✓' : 'NO (!)')

  const { rows: bk } = await c.query(`
    select id, business_name, coalesce(jsonb_array_length(available_slots), 0)::int as n
      from tenants order by created_at`)
  for (const r of bk) {
    console.log(`  ${r.business_name.padEnd(22)} ${r.n.toString().padStart(3)} slots`)
  }
  console.log('\nMigration 062 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
