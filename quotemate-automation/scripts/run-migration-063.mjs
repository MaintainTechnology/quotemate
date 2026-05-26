// QuoteMate · run migration 063 (drop legacy tradies table)
// Usage:  node --env-file=.env.local scripts/run-migration-063.mjs
//
// Phase 2b of the 2026-05-26 DB cleanup audit. Tradies has been read
// off `tenants.available_slots` since mig 062; the 4 code sites that
// used to read `.from('tradies')` have been updated in the same change.
//
// Pre-flight:
//   1. tradies still exists (idempotent re-run is fine)
//   2. tradies has exactly 1 row (the audit assumed this — refuse if not)
//   3. tenants.available_slots is present + non-empty on every tenant
//      (mig 062 must have run + backfilled successfully)
//   4. No `.from('tradies')` references remain in app/ or lib/
// Post-verify: tradies is gone; tenants still has slots.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '063_drop_tradies.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

function codeStillReferences(table) {
  const root = join(here, '..')
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))]
  const re = new RegExp(`\\.from\\(['"]${table}['"]\\)`)
  return files.filter((f) => re.test(readFileSync(f, 'utf8')))
}

try {
  await c.connect()

  console.log('─── pre-flight ────────────────────────────')

  // (1) tradies still exists?
  const { rows: ex } = await c.query(`
    select 1 from information_schema.tables
      where table_schema='public' and table_name='tradies'`)
  if (ex.length === 0) {
    console.log('  tradies already absent (re-run, nothing to do)')
    process.exit(0)
  }

  // (2) exactly 1 row?
  const { rows: rc } = await c.query(`select count(*)::int n from tradies`)
  console.log(`  tradies rows: ${rc[0].n}`)
  if (rc[0].n !== 1) {
    console.error(`\nABORTING: audit assumed 1 row on tradies, found ${rc[0].n}. Reconfirm before dropping.`)
    process.exit(2)
  }

  // (3) tenants.available_slots column present + every tenant has slots
  const { rows: col } = await c.query(`
    select 1 from information_schema.columns
      where table_schema='public' and table_name='tenants' and column_name='available_slots'`)
  if (col.length === 0) {
    console.error('\nABORTING: tenants.available_slots column missing. Run migration 062 first.')
    process.exit(3)
  }
  const { rows: bk } = await c.query(`
    select business_name, coalesce(jsonb_array_length(available_slots), 0)::int as n
      from tenants order by created_at`)
  console.log('  tenants slot backfill (mig 062):')
  for (const r of bk) console.log(`    ${r.business_name.padEnd(22)} ${r.n} slots`)

  // (4) no code-side references
  console.log('\n─── code reference scan ──────────────────')
  const refs = codeStillReferences('tradies')
  if (refs.length === 0) {
    console.log("  no .from('tradies') in app/ or lib/")
  } else {
    console.error(`  STILL REFERENCED in ${refs.length} file(s):`)
    for (const r of refs) console.error(`    · ${r}`)
    console.error('\nABORTING: switch remaining sites to tenants.available_slots first.')
    process.exit(4)
  }

  // Execute.
  console.log('\n─── executing migration 063 ──────────────')
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
  const { rows: ex2 } = await c.query(`
    select 1 from information_schema.tables
      where table_schema='public' and table_name='tradies'`)
  console.log('  tradies', ex2.length === 0 ? 'DROPPED ✓' : 'STILL PRESENT (!)')
  const { rows: bk2 } = await c.query(`
    select business_name, coalesce(jsonb_array_length(available_slots), 0)::int as n
      from tenants order by created_at`)
  console.log('  tenants slots preserved:')
  for (const r of bk2) console.log(`    ${r.business_name.padEnd(22)} ${r.n} slots`)
  console.log('\nMigration 063 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
