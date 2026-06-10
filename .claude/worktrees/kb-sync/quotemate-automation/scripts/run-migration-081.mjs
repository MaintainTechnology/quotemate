// QuoteMate · run migration 081
// (roofing_measurements — multi-structure measurement persistence)
// Usage: node --env-file=.env.local scripts/run-migration-081.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '081_roofing_measurements.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function tablePresent(client) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'roofing_measurements'
     ) as present`,
  )
  return rows[0].present
}

async function rlsEnabled(client) {
  const { rows } = await client.query(
    `select relrowsecurity as on
       from pg_class
      where oid = 'public.roofing_measurements'::regclass`,
  )
  return rows[0]?.on ?? false
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  console.log(`  before · table present                 ${await tablePresent(c)}`)

  console.log('\n─── executing migration 081 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const present = await tablePresent(c)
  const rls = await rlsEnabled(c)
  console.log(`  after  · table present                 ${present}`)
  console.log(`  after  · RLS enabled                    ${rls}`)

  if (!present) {
    console.error('\nABORTING: roofing_measurements table was not created.')
    process.exit(2)
  }
  if (!rls) {
    console.error('\nABORTING: RLS is not enabled on roofing_measurements.')
    process.exit(2)
  }

  console.log('\nMigration 081 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
