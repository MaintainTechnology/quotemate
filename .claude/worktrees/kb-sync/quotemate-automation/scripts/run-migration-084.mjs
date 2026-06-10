// QuoteMate · run migration 084
// (seed shared_assembly_bom recipe for "Replace double GPO" — deterministic pilot)
// Usage: node --env-file=.env.local scripts/run-migration-084.mjs
//
// NOTE: this writes to the (prod) Supabase. The row is INERT until the
// loadDeterministicInputs shared-recipe fallback is deployed. Run the
// read-only dry-run FIRST:
//   node --import tsx --env-file=.env.local scripts/dry-run-gpo-determinism.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '084_seed_shared_gpo_recipe.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function gpoRecipeCount(client) {
  const { rows } = await client.query(`
    select count(*)::int as n
    from shared_assembly_bom b
    join shared_assemblies a on a.id = b.assembly_id
    where a.trade = 'electrical' and a.name = 'Replace double GPO'
      and lower(b.material_category) = 'gpo'
  `)
  return rows[0].n
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  console.log(`  before · "Replace double GPO" gpo recipe rows  ${await gpoRecipeCount(c)}`)

  console.log('\n─── executing migration 084 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const n = await gpoRecipeCount(c)
  console.log(`  after  · "Replace double GPO" gpo recipe rows  ${n}`)

  if (n < 1) {
    console.error('\nABORTING: expected at least 1 gpo recipe row for "Replace double GPO".')
    process.exit(2)
  }

  console.log('\nMigration 084 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
