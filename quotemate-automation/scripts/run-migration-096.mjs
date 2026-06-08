// QuoteMate · run migration 096 (signage two-stage assessment — add the
// signage_assessments.two_stage jsonb column).
// Usage: node --env-file=.env.local scripts/run-migration-096.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '096_signage_two_stage.sql')

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
  console.log('─── executing migration 096 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const present = await columnExists(c, 'signage_assessments', 'two_stage')
  console.log(`  after · ${'signage_assessments.two_stage'.padEnd(36)} ${present}`)

  if (!present) {
    console.error('\nABORTING: expected signage_assessments.two_stage after migration.')
    process.exit(2)
  }
  console.log('\nMigration 096 applied OK.')
} catch (e) {
  console.error('migration failed:', e.message)
  process.exit(1)
} finally {
  await c.end()
}
