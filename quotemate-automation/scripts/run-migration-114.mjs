// QuoteMate · run migration 114 (solar multi-roof building picker)
// Usage: node --env-file=.env.local scripts/run-migration-114.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '114_solar_multi_building.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 114_solar_multi_building.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='buildings') as buildings_ok,
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='selected_building_id') as selected_ok,
       exists (select 1 from information_schema.tables
         where table_schema='public' and table_name='solar_building_cache') as cache_ok`,
  )
  const r = rows[0]
  console.log(`  ${r.buildings_ok ? '✓' : '✗'} solar_estimates.buildings: ${r.buildings_ok}`)
  console.log(`  ${r.selected_ok ? '✓' : '✗'} solar_estimates.selected_building_id: ${r.selected_ok}`)
  console.log(`  ${r.cache_ok ? '✓' : '✗'} solar_building_cache: ${r.cache_ok}`)
  if (!(r.buildings_ok && r.selected_ok && r.cache_ok)) process.exit(1)
  console.log('\nOK — migration 114 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
