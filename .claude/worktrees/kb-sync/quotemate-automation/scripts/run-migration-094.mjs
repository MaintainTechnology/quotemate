// QuoteMate · run migration 094 (brand → Gemini file-search store routing
// + signage_assessments.kb_supplement column + Anytime Fitness brand seed).
// Usage: node --env-file=.env.local scripts/run-migration-094.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '094_brand_kb_stores.sql')

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
  console.log('─── executing migration 094 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const checks = [
    ['brands', 'kb_store_ids'],
    ['signage_assessments', 'kb_supplement'],
  ]
  let allPresent = true
  for (const [t, col] of checks) {
    const present = await columnExists(c, t, col)
    console.log(`  after · ${`${t}.${col}`.padEnd(36)} ${present}`)
    if (!present) allPresent = false
  }

  const { rows: brandRows } = await c.query(
    `select slug, kb_store_ids from public.brands where slug in ('f45','anytime-fitness') order by slug`,
  )
  for (const r of brandRows) {
    console.log(`  brand · ${r.slug.padEnd(18)} stores=${JSON.stringify(r.kb_store_ids)}`)
  }

  if (!allPresent) {
    console.error('\nABORTING: expected both new columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 094 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
