// QuoteMate · run migration 070
// (add source_ref + source_document to import_staged_rows for trade-book pipeline)
// Usage: node --env-file=.env.local scripts/run-migration-070.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '070_import_staged_rows_source_ref.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(client, col) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
       where table_schema='public' and table_name='import_staged_rows' and column_name=$1`,
    [col],
  )
  return rows.length > 0
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const before = {
    source_ref: await hasColumn(c, 'source_ref'),
    source_document: await hasColumn(c, 'source_document'),
  }
  for (const [k, v] of Object.entries(before)) {
    console.log(`  before · ${k.padEnd(20)} ${v ? 'present' : 'absent'}`)
  }

  console.log('\n─── executing migration 070 ──')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  console.log('\n─── post-verify ──')
  const after = {
    source_ref: await hasColumn(c, 'source_ref'),
    source_document: await hasColumn(c, 'source_document'),
  }
  let allPresent = true
  for (const [k, v] of Object.entries(after)) {
    console.log(`  after  · ${k.padEnd(20)} ${v ? '✓ present' : '✗ MISSING'}`)
    if (!v) allPresent = false
  }
  if (!allPresent) {
    console.error('\nABORTING: at least one expected column missing post-migration.')
    process.exit(2)
  }

  // Confirm the index landed.
  const { rows: idx } = await c.query(`
    select 1 from pg_indexes
     where schemaname='public'
       and tablename='import_staged_rows'
       and indexname='import_staged_rows_batch_source_idx'`)
  console.log(`  partial index batch_source_idx: ${idx.length > 0 ? '✓ present' : '✗ MISSING'}`)

  console.log('\nMigration 070 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
