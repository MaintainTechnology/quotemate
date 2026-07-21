// QuoteMate · run migration 179 (tenants.trade_videos jsonb — per-trade trust videos)
// Usage: node --env-file=.env.local scripts/run-migration-179.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '179_tenant_trade_videos.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 179 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows } = await c.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name='tenants' and column_name='trade_videos'
     ) as present`,
  )
  console.log(`  after · tenants.trade_videos ${rows[0].present}`)
  if (!rows[0].present) {
    console.error('\nABORTING: expected tenants.trade_videos after migration.')
    process.exit(2)
  }
  console.log('\nMigration 179 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
