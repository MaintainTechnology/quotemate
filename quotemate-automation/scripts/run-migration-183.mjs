// QuoteMate · run migration 183 (tradie alerts recorded in sms_messages)
// Usage: node --env-file=.env.local scripts/run-migration-183.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '183_tradie_send_log.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  const { rows: before } = await c.query(
    `select count(*) as n from public.sms_messages where conversation_id is null`,
  )
  console.log(`─── before · conversation-less rows: ${before[0].n} (expected 0)`)

  console.log('─── executing migration 183 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows: cols } = await c.query(
    `select column_name, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = 'sms_messages'
        and column_name in ('conversation_id', 'audience', 'to_number', 'tenant_id')
      order by column_name`,
  )
  cols.forEach((r) => console.log(`  after · ${r.column_name.padEnd(16)} nullable=${r.is_nullable}`))

  const have = Object.fromEntries(cols.map((r) => [r.column_name, r.is_nullable]))
  if (
    have.audience !== 'NO' ||
    have.to_number !== 'YES' ||
    have.tenant_id !== 'YES' ||
    have.conversation_id !== 'YES'
  ) {
    console.error('\nABORTING: sms_messages does not have the expected shape after migration.')
    process.exit(2)
  }

  // Every pre-existing row must still read as a customer turn, and no customer
  // turn may have lost its thread.
  const { rows: sanity } = await c.query(
    `select
       count(*) filter (where audience = 'customer') as customer_rows,
       count(*) filter (where audience = 'tradie')   as tradie_rows,
       count(*) filter (where audience = 'customer' and conversation_id is null) as orphaned
     from public.sms_messages`,
  )
  console.log(
    `  after · customer=${sanity[0].customer_rows} tradie=${sanity[0].tradie_rows} orphaned=${sanity[0].orphaned}`,
  )
  if (Number(sanity[0].orphaned) !== 0) {
    console.error('\nABORTING: a customer turn lost its conversation.')
    process.exit(2)
  }

  console.log('\nMigration 183 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
