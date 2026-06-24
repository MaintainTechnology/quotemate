// QuoteMate · run migration 141 (tradie identity fields + tenant-logos bucket)
// Usage: node --env-file=.env.local scripts/run-migration-141.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '141_tradie_identity_fields.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 141_tradie_identity_fields.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const want = ['contact_name', 'website_url', 'business_address', 'logo_url']
  const { rows: cols } = await c.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
        and column_name = any($1::text[])
      order by column_name`,
    [want],
  )
  const names = cols.map((r) => r.column_name)
  const haveAll = want.every((w) => names.includes(w))

  const { rows: bucket } = await c.query(
    `select id, public from storage.buckets where id = 'tenant-logos'`,
  )
  const bucketOk = bucket.length === 1 && bucket[0].public === true

  console.log(`  ${haveAll ? '✓' : '✗'} tenants columns present: ${names.join(', ') || '(none)'}`)
  console.log(`  ${bucketOk ? '✓' : '✗'} tenant-logos bucket public: ${bucket.length ? bucket[0].public : 'missing'}`)
  if (!haveAll || !bucketOk) process.exit(1)
  console.log('\nOK — migration 141 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
