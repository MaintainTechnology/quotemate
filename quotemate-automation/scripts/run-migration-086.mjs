// QuoteMate · run migration 086
// (Roofing customer confirmation + AI "after" preview —
//  roofing_measurements.confirmed_at / confirmed_structure /
//  preview_image_path / preview_status)
// Usage: node --env-file=.env.local scripts/run-migration-086.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '086_roofing_confirm_and_preview.sql')

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
  console.log('─── executing migration 086 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasConfirmedAt = await columnExists(c, 'roofing_measurements', 'confirmed_at')
  const hasConfirmedStruct = await columnExists(c, 'roofing_measurements', 'confirmed_structure')
  const hasPreviewPath = await columnExists(c, 'roofing_measurements', 'preview_image_path')
  const hasPreviewStatus = await columnExists(c, 'roofing_measurements', 'preview_status')
  console.log(`  after · roofing_measurements.confirmed_at        ${hasConfirmedAt}`)
  console.log(`  after · roofing_measurements.confirmed_structure ${hasConfirmedStruct}`)
  console.log(`  after · roofing_measurements.preview_image_path  ${hasPreviewPath}`)
  console.log(`  after · roofing_measurements.preview_status      ${hasPreviewStatus}`)

  if (!hasConfirmedAt || !hasConfirmedStruct || !hasPreviewPath || !hasPreviewStatus) {
    console.error('\nABORTING: expected all four columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 086 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
