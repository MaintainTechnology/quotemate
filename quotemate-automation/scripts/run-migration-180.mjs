// QuoteMate · run migration 180 (tenants.photo_url / photo_path — tradie photo)
// Usage: node --env-file=.env.local scripts/run-migration-180.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '180_tenant_photo.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 180 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows } = await c.query(
    `select
       count(*) filter (where column_name = 'photo_url')  as url_col,
       count(*) filter (where column_name = 'photo_path') as path_col
     from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'`,
  )
  console.log(`  after · tenants.photo_url=${rows[0].url_col} photo_path=${rows[0].path_col}`)
  if (Number(rows[0].url_col) !== 1 || Number(rows[0].path_col) !== 1) {
    console.error('\nABORTING: expected tenants.photo_url + photo_path after migration.')
    process.exit(2)
  }
  console.log('\nMigration 180 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
