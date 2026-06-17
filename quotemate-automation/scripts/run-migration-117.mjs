// QuoteMate - run migration 117 (solar unknown/not-sure phase)
// Usage: node --env-file=.env.local scripts/run-migration-117.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '117_solar_unknown_phase.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`Applying 117_solar_unknown_phase.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       (
         select column_default
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'solar_estimates'
            and column_name = 'electrical_phase'
       ) as phase_default,
       exists (
         select 1
           from pg_constraint
          where conname = 'solar_estimates_electrical_phase_check'
            and pg_get_constraintdef(oid) like '%unknown%'
       ) as accepts_unknown`,
  )
  const r = rows[0]
  console.log(`  electrical_phase default: ${r.phase_default}`)
  console.log(`  accepts unknown: ${r.accepts_unknown}`)
  if (r.phase_default !== "'unknown'::text" || !r.accepts_unknown) process.exit(1)
  console.log('\nOK - migration 117 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}

