// QuoteMate · run migration 157
// (painting tradie-release gate — painting_measurements.released_at + backfill)
// Usage: node --env-file=.env.local scripts/run-migration-157.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '157_painting_release_gate.sql')

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
  console.log('─── executing migration 157 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasReleased = await columnExists(c, 'painting_measurements', 'released_at')
  const { rows } = await c.query(
    `select count(*)::int as n from public.painting_measurements where released_at is null`,
  )
  console.log(`  after · painting_measurements.released_at   ${hasReleased}`)
  console.log(`  after · unreleased rows (drafts)            ${rows[0].n}`)

  if (!hasReleased) {
    console.error('\nABORTING: expected released_at to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 157 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
