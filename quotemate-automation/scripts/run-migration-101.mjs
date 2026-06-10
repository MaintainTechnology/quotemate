// QuoteMate · run migration 101
// (solar_estimates app-contract columns)
// Usage: node --env-file=.env.development.local scripts/run-migration-101.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '101_solar_estimates_app_contract.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, column) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'solar_estimates'
          and column_name = $1
     ) as present`,
    [column],
  )
  return rows[0].present
}

async function hasPrivilege(client, table) {
  const { rows } = await client.query(
    `select has_table_privilege('service_role', $1, 'select, insert, update, delete') as ok`,
    [`public.${table}`],
  )
  return rows[0].ok
}

try {
  await c.connect()

  console.log('--- pre-flight ---')
  console.log(`  before · estimate column              ${await columnExists(c, 'estimate')}`)
  console.log(`  before · satellite_image_url column   ${await columnExists(c, 'satellite_image_url')}`)

  console.log('\n--- executing migration 101 ---')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n--- post-verify ---')
  const hasEstimate = await columnExists(c, 'estimate')
  const hasSatelliteUrl = await columnExists(c, 'satellite_image_url')
  const hasEstimateGrants = await hasPrivilege(c, 'solar_estimates')
  const hasConfigGrants = await hasPrivilege(c, 'solar_config')
  console.log(`  after  · estimate column              ${hasEstimate}`)
  console.log(`  after  · satellite_image_url column   ${hasSatelliteUrl}`)
  console.log(`  after  · service_role solar_estimates ${hasEstimateGrants}`)
  console.log(`  after  · service_role solar_config    ${hasConfigGrants}`)

  if (!hasEstimate || !hasSatelliteUrl || !hasEstimateGrants || !hasConfigGrants) {
    console.error('\nABORTING: expected solar_estimates app-contract columns and grants to exist.')
    process.exit(2)
  }

  console.log('\nMigration 101 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
