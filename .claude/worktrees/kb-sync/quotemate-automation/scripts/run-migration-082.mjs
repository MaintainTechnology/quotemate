// QuoteMate · run migration 082
// (GIN index on tenant_material_catalogue.properties — spec-aware pricing)
// Usage: node --env-file=.env.local scripts/run-migration-082.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '082_catalogue_properties_index.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function indexPresent(client) {
  const { rows } = await client.query(
    `select exists (
       select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'tenant_material_catalogue_properties_gin'
     ) as present`,
  )
  return rows[0].present
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  console.log(`  before · index present                 ${await indexPresent(c)}`)

  console.log('\n─── executing migration 082 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const present = await indexPresent(c)
  console.log(`  after  · index present                 ${present}`)

  if (!present) {
    console.error('\nABORTING: properties GIN index was not created.')
    process.exit(2)
  }

  console.log('\nMigration 082 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
