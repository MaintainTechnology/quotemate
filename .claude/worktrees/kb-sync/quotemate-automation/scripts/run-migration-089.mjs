// QuoteMate · run migration 089
// (painting_measurements — saved-job persistence)
// Usage: node --env-file=.env.local scripts/run-migration-089.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '089_painting_measurements.sql')

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
        where table_schema = 'public' and table_name = 'painting_measurements'
     ) as present`,
  )
  return rows[0].present
}

async function rlsOn(client) {
  const { rows } = await client.query(
    `select relrowsecurity as on from pg_class where oid = 'public.painting_measurements'::regclass`,
  )
  return rows[0]?.on ?? false
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  console.log(`  before · table present                 ${await tablePresent(c)}`)

  console.log('\n─── executing migration 089 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const present = await tablePresent(c)
  const rls = await rlsOn(c)
  console.log(`  after  · table present                 ${present}`)
  console.log(`  after  · RLS enabled                   ${rls}`)

  if (!present) {
    console.error('\nABORTING: painting_measurements was not created.')
    process.exit(2)
  }
  if (!rls) {
    console.error('\nWARNING: RLS is not enabled on painting_measurements.')
  }

  console.log('\nMigration 089 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
