// QuoteMate · run migration 116 (solar phase + preferred system size)
// Usage: node --env-file=.env.local scripts/run-migration-116.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '116_solar_phase_and_requested_size.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 116_solar_phase_and_requested_size.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='electrical_phase') as phase_ok,
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='requested_system_kw') as size_ok`,
  )
  const r = rows[0]
  console.log(`  ${r.phase_ok ? '✓' : '✗'} electrical_phase: ${r.phase_ok}`)
  console.log(`  ${r.size_ok ? '✓' : '✗'} requested_system_kw: ${r.size_ok}`)
  if (!(r.phase_ok && r.size_ok)) process.exit(1)
  console.log('\nOK — migration 116 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
