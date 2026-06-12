// QuoteMate · run migration 111 (solar Felt tab — quote_variant/felt/ai_brief)
// Usage: node --env-file=.env.local scripts/run-migration-111.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '111_solar_felt_maps.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 111_solar_felt_maps.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='quote_variant') as variant_ok,
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='felt') as felt_ok,
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='ai_brief') as brief_ok`,
  )
  const r = rows[0]
  console.log(`  ${r.variant_ok ? '✓' : '✗'} quote_variant: ${r.variant_ok}`)
  console.log(`  ${r.felt_ok ? '✓' : '✗'} felt: ${r.felt_ok}`)
  console.log(`  ${r.brief_ok ? '✓' : '✗'} ai_brief: ${r.brief_ok}`)
  if (!(r.variant_ok && r.felt_ok && r.brief_ok)) process.exit(1)
  console.log('\nOK — migration 111 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
