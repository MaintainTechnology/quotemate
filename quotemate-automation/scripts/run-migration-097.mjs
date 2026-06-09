// QuoteMate · run migration 097 (air-conditioning trade Phase 1)
// Usage: node --env-file=.env.local scripts/run-migration-097.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '097_aircon_trade_phase1.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function scalar(client, q, params = []) {
  const { rows } = await client.query(q, params)
  return rows[0]?.n ?? 0
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeTrade = await scalar(c, `select count(*)::int as n from public.trades where name='aircon'`)
  console.log(`  before · aircon trade rows   ${beforeTrade}`)

  console.log('\n─── executing migration 097 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterTrade = await scalar(c, `select count(*)::int as n from public.trades where name='aircon'`)
  const afterAsm = await scalar(c, `select count(*)::int as n from public.shared_assemblies where trade='aircon'`)
  console.log(`  after  · aircon trade rows   ${afterTrade}`)
  console.log(`  after  · aircon assemblies   ${afterAsm}`)

  if (afterTrade < 1) {
    console.error('\nABORTING: aircon trade row not present after migration.')
    process.exit(2)
  }

  console.log('\nMigration 097 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
