// QuoteMate · run migration 173
// (roofing_measurements 3D-model cache columns — Track B visual feature)
// Usage: node --env-file=.env.local scripts/run-migration-173.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '173_roofing_model3d.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name=$1 and column_name=$2
     ) as present`,
    [table, column],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 173 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const checks = ['model3d_status', 'model3d_task_id', 'model3d_glb_path', 'model3d_error']
  for (const col of checks) {
    const present = await columnExists(c, 'roofing_measurements', col)
    console.log(`  roofing_measurements.${col}: ${present ? 'OK' : 'MISSING'}`)
    if (!present) process.exitCode = 1
  }
} catch (err) {
  console.error('Migration failed:', err.message)
  process.exitCode = 1
} finally {
  await c.end()
}
