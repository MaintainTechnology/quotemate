// QuoteMate · run migration 144 (aircon_recommendations table)
// Usage: node --env-file=.env.local scripts/run-migration-144.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '144_aircon_recommendations.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 144_aircon_recommendations.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows: tbl } = await c.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'aircon_recommendations'`,
  )
  const haveTable = tbl.length === 1

  const { rows: idx } = await c.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and indexname = 'aircon_recommendations_public_token_idx'`,
  )
  const haveIdx = idx.length === 1

  const { rows: rls } = await c.query(
    `select relrowsecurity from pg_class where oid = 'public.aircon_recommendations'::regclass`,
  )
  const rlsOn = rls.length === 1 && rls[0].relrowsecurity === true

  console.log(`  ${haveTable ? '✓' : '✗'} aircon_recommendations table present`)
  console.log(`  ${haveIdx ? '✓' : '✗'} public_token unique index present`)
  console.log(`  ${rlsOn ? '✓' : '✗'} RLS enabled`)
  if (!haveTable || !haveIdx || !rlsOn) process.exit(1)
  console.log('\nOK — migration 144 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
