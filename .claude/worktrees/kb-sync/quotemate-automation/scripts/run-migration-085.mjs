// QuoteMate · run migration 085
// (SMS roofing receptionist — sms_conversations.roofing_state +
//  roofing_measurements.public_token)
// Usage: node --env-file=.env.local scripts/run-migration-085.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '085_roofing_sms_receptionist.sql')

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
  console.log('─── executing migration 085 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasState = await columnExists(c, 'sms_conversations', 'roofing_state')
  const hasToken = await columnExists(c, 'roofing_measurements', 'public_token')
  console.log(`  after · sms_conversations.roofing_state      ${hasState}`)
  console.log(`  after · roofing_measurements.public_token    ${hasToken}`)

  if (!hasState || !hasToken) {
    console.error('\nABORTING: expected both columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 085 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
