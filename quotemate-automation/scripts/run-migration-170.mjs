// QuoteMate · run migration 170
// (roofing_measurements AI layout-plan cache columns — spec quote-visual-parity R6)
// Usage: node --env-file=.env.local scripts/run-migration-170.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '170_roofing_layout_plan.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name=$1 and column_name=$2
     ) as present`,
    [table, column],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 170 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const checks = [
    ['roofing_measurements', 'layout_plan'],
    ['roofing_measurements', 'layout_status'],
  ]
  let allPresent = true
  for (const [table, col] of checks) {
    const present = await columnExists(c, table, col)
    console.log(`  after · ${table}.${col.padEnd(20)} ${present}`)
    if (!present) allPresent = false
  }

  if (!allPresent) {
    console.error('\nABORTING: expected both layout columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 170 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
