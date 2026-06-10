// QuoteMate · run migration 061 (drop unused tables: payments + quote_line_items)
// Usage:  node --env-file=.env.local scripts/run-migration-061.mjs
//
// Phase 1 of the 2026-05-26 DB cleanup audit (see chat report).
//
// Pre-flight:
//   1. Confirms BOTH target tables exist (idempotent re-runs are fine
//      via `drop table if exists`, but first run we want both present)
//   2. Confirms BOTH target tables are empty — refuses to drop if rows
//      somehow appeared since the audit (safety net)
//   3. Confirms no code-side `.from('payments')` or
//      `.from('quote_line_items')` calls remain in app/ or lib/
// Post-verify: confirms both tables are gone.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '061_drop_unused_tables.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const TARGETS = ['payments', 'quote_line_items']

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

  // 1. Pre-flight: tables must exist + be empty.
  console.log('─── pre-flight ────────────────────────────')
  for (const t of TARGETS) {
    const { rows: ex } = await c.query(`
      select 1 from information_schema.tables
        where table_schema='public' and table_name=$1`, [t])
    if (ex.length === 0) {
      console.log(`  ${t.padEnd(20)} already absent (re-run, skipping)`)
      continue
    }
    const { rows: rc } = await c.query(`select count(*)::int n from "${t}"`)
    console.log(`  ${t.padEnd(20)} rows: ${rc[0].n}`)
    if (rc[0].n > 0) {
      console.error(`\nABORTING: ${t} has ${rc[0].n} rows. Audit assumed 0. Re-run audit before dropping.`)
      process.exit(2)
    }
  }

  // 2. Pre-flight: no remaining code-side reads/writes.
  console.log('\n─── code reference scan ──────────────────')
  let codeBlocks = false
  for (const t of TARGETS) {
    const refs = codeStillReferences(t)
    if (refs.length === 0) {
      console.log(`  ${t.padEnd(20)} no .from('${t}') in app/ or lib/`)
    } else {
      console.error(`  ${t.padEnd(20)} STILL REFERENCED in ${refs.length} file(s):`)
      for (const r of refs) console.error(`    · ${r}`)
      codeBlocks = true
    }
  }
  if (codeBlocks) {
    console.error('\nABORTING: code still references at least one target. Remove the read(s) and re-run.')
    process.exit(3)
  }

  // 3. Execute.
  console.log('\n─── executing migration 061 ──────────────')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  // 4. Post-verify: tables are gone.
  console.log('\n─── post-verify ──────────────────────────')
  for (const t of TARGETS) {
    const { rows: ex } = await c.query(`
      select 1 from information_schema.tables
        where table_schema='public' and table_name=$1`, [t])
    console.log(`  ${t.padEnd(20)} ${ex.length === 0 ? 'DROPPED ✓' : 'STILL PRESENT (!)'}`)
  }
  console.log('\nMigration 061 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
