// QuoteMate · run migration 154
// (SMS painting receptionist — sms_conversations.painting_state +
//  painting_lead_requests table)
// Usage: node --env-file=.env.local scripts/run-migration-154.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '154_painting_sms_receptionist.sql')

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
  console.log('─── executing migration 154 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasState = await columnExists(c, 'sms_conversations', 'painting_state')
  const hasTable = await tableExists(c, 'painting_lead_requests')
  console.log(`  after · sms_conversations.painting_state   ${hasState}`)
  console.log(`  after · painting_lead_requests (table)     ${hasTable}`)

  if (!hasState || !hasTable) {
    console.error('\nABORTING: expected both the column and the table to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 154 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
