// QuoteMate · run migration 112 (invitation codes)
// Usage: node --env-file=.env.local scripts/run-migration-112.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '112_invitation_codes.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 112_invitation_codes.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       exists (select 1 from information_schema.tables
         where table_schema='public' and table_name='onboarding_codes') as codes_ok,
       exists (select 1 from information_schema.tables
         where table_schema='public' and table_name='code_redemptions') as redemptions_ok,
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='tenants'
           and column_name='used_onboarding_code_id') as col_ok,
       exists (select 1 from pg_proc where proname='increment_code_quota') as rpc_ok`,
  )
  const r = rows[0]
  console.log(`  ${r.codes_ok ? '✓' : '✗'} onboarding_codes: ${r.codes_ok}`)
  console.log(`  ${r.redemptions_ok ? '✓' : '✗'} code_redemptions: ${r.redemptions_ok}`)
  console.log(`  ${r.col_ok ? '✓' : '✗'} tenants.used_onboarding_code_id: ${r.col_ok}`)
  console.log(`  ${r.rpc_ok ? '✓' : '✗'} increment_code_quota(): ${r.rpc_ok}`)
  if (!(r.codes_ok && r.redemptions_ok && r.col_ok && r.rpc_ok)) process.exit(1)
  console.log('\nOK — migration 112 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
