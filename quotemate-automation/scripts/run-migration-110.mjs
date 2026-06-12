// QuoteMate · run migration 110 (opensolar_proposals — solar OpenSolar tab)
// (Renumbered from 109 — that slot was taken by 109_pylon_settings.)
// Usage: node --env-file=.env.local scripts/run-migration-110.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '110_opensolar_proposals.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 110_opensolar_proposals.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='opensolar_proposals') as present`,
  )
  console.log(`  ${rows[0].present ? '✓' : '✗'} opensolar_proposals: ${rows[0].present}`)
  if (!rows[0].present) process.exit(1)
  console.log('\nOK — migration 110 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
