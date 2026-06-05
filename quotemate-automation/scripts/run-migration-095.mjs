// QuoteMate · run migration 095 (signage brand scoping — brand_slug columns
// on studios / signage_sweeps / signage_requests / signage_assessments, and
// retire the stray 'gelatissimo' demo brand).
// Usage: node --env-file=.env.local scripts/run-migration-095.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '095_signage_brand_scoping.sql')

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
  console.log('─── executing migration 095 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const checks = [
    ['studios', 'brand_slug'],
    ['signage_sweeps', 'brand_slug'],
    ['signage_requests', 'brand_slug'],
    ['signage_assessments', 'brand_slug'],
  ]
  let allPresent = true
  for (const [t, col] of checks) {
    const present = await columnExists(c, t, col)
    console.log(`  after · ${`${t}.${col}`.padEnd(36)} ${present}`)
    if (!present) allPresent = false
  }

  const { rows: brandRows } = await c.query(
    `select slug, active from public.brands order by slug`,
  )
  for (const r of brandRows) {
    console.log(`  brand · ${r.slug.padEnd(18)} active=${r.active}`)
  }

  if (!allPresent) {
    console.error('\nABORTING: expected all four brand_slug columns after migration.')
    process.exit(2)
  }
  console.log('\nMigration 095 applied OK.')
} catch (e) {
  console.error('migration failed:', e.message)
  process.exit(1)
} finally {
  await c.end()
}
