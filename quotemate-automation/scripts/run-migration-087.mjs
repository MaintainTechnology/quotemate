// QuoteMate · run migration 087 (Signage Compliance — orgs, studios,
// signage_rules, signage_sweeps, signage_requests, signage_photo_submissions,
// signage_assessments).
// Usage: node --env-file=.env.local scripts/run-migration-087.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '087_signage_compliance.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

const TABLES = [
  'orgs',
  'studios',
  'signage_rules',
  'signage_sweeps',
  'signage_requests',
  'signage_photo_submissions',
  'signage_assessments',
]

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema='public' and table_name=$1
     ) as present`,
    [table],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 087 ──')
  await c.query(sql)
  console.log('  migration committed.')

  let allPresent = true
  for (const t of TABLES) {
    const present = await tableExists(c, t)
    console.log(`  after · ${t.padEnd(28)} ${present}`)
    if (!present) allPresent = false
  }

  if (!allPresent) {
    console.error('\nABORTING: expected all 7 signage tables to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 087 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
