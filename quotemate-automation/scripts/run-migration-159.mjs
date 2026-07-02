// QuoteMate · run migration 159
// (sms_conversations.followup_2h_sent_at + partial pending index —
//  2-hour MID-CONVERSATION check-in for the /api/cron/followup-2h sweep)
// Usage: node --env-file=.env.local scripts/run-migration-159.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '159_conversation_followup_2h.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(client, table, col) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, col],
  )
  return rows.length > 0
}

async function hasIndex(client, table, name) {
  const { rows } = await client.query(
    `select 1 from pg_indexes
       where schemaname='public' and tablename=$1 and indexname=$2`,
    [table, name],
  )
  return rows.length > 0
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeCol = await hasColumn(c, 'sms_conversations', 'followup_2h_sent_at')
  const beforeIdx = await hasIndex(c, 'sms_conversations', 'sms_conversations_followup_2h_pending_idx')
  console.log(`  before · sms_conversations.followup_2h_sent_at ${beforeCol ? 'present' : 'absent'}`)
  console.log(`  before · followup_2h_pending index             ${beforeIdx ? 'present' : 'absent'}`)

  console.log('\n─── executing migration 159 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterCol = await hasColumn(c, 'sms_conversations', 'followup_2h_sent_at')
  const afterIdx = await hasIndex(c, 'sms_conversations', 'sms_conversations_followup_2h_pending_idx')
  console.log(`  after  · sms_conversations.followup_2h_sent_at ${afterCol ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · followup_2h_pending index             ${afterIdx ? '✓ present' : '✗ MISSING'}`)

  // Visibility — how many open customer threads sit in the sweep's
  // current 2h..24h idle window right now (pre-gates, so an upper bound).
  const { rows: pending } = await c.query(
    `select count(*)::int as n
       from public.sms_conversations
      where followup_2h_sent_at is null
        and status = 'open'
        and conversation_type = 'customer_quote'
        and tenant_id is not null
        and last_message_at >= now() - interval '24 hours'
        and last_message_at <= now() - interval '2 hours'`,
  )
  console.log(`  info   · threads currently in the 2h..24h idle window: ${pending[0].n}`)

  if (!afterCol || !afterIdx) {
    console.error('\nABORTING: column or index missing post-migration.')
    process.exit(2)
  }

  console.log('\nMigration 159 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
