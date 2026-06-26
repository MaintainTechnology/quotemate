// QuoteMate · run migration 150 (flyers table + flyer-assets storage bucket)
// Usage: node --env-file=.env.local scripts/run-migration-150.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '150_flyers.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 150_flyers.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows: tbl } = await c.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'flyers'`,
  )
  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'flyers'`,
  )
  const have = new Set(cols.map((r) => r.column_name))
  const required = ['id', 'tenant_id', 'name', 'template_id', 'document', 'png_path', 'pdf_path', 'created_at', 'updated_at']
  const missing = required.filter((c) => !have.has(c))
  const { rows: bucket } = await c.query(`select 1 from storage.buckets where id = 'flyer-assets'`)

  const tblOk = tbl.length === 1 && missing.length === 0
  const bucketOk = bucket.length === 1
  console.log(`  ${tblOk ? '✓' : '✗'} public.flyers table (${missing.length ? 'missing: ' + missing.join(', ') : 'all columns present'})`)
  console.log(`  ${bucketOk ? '✓' : '✗'} storage bucket 'flyer-assets'`)
  if (!tblOk || !bucketOk) process.exit(1)
  console.log('\nOK — migration 150 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
