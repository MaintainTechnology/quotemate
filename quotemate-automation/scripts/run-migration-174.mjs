// QuoteMate · run migration 174
// (roofing_measurements.model3d_anatomy — roof-anatomy overlay paths)
// Usage: node --env-file=.env.local scripts/run-migration-174.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '174_roofing_model3d_anatomy.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 174 ──')
  await c.query(sql)
  const { rows } = await c.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name='roofing_measurements'
          and column_name='model3d_anatomy'
     ) as present`,
  )
  console.log(`  roofing_measurements.model3d_anatomy: ${rows[0].present ? 'OK' : 'MISSING'}`)
  if (!rows[0].present) process.exitCode = 1
} catch (err) {
  console.error('Migration failed:', err.message)
  process.exitCode = 1
} finally {
  await c.end()
}
