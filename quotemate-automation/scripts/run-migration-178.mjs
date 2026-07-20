// QuoteMate · run migration 178 (tenants.trust_video_state jsonb)
// Usage: node --env-file=.env.local scripts/run-migration-178.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '178_tenant_trust_video_state.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 178 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows } = await c.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name='tenants' and column_name='trust_video_state'
     ) as present`,
  )
  console.log(`  after · tenants.trust_video_state ${rows[0].present}`)
  if (!rows[0].present) {
    console.error('\nABORTING: expected tenants.trust_video_state after migration.')
    process.exit(2)
  }
  console.log('\nMigration 178 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
