// QuoteMate - run migration 120 (shared_materials brand A-pass: el+pl)
// Usage:
//   node --env-file=.env.local scripts/run-migration-120.mjs            # forward (set brand='Generic')
//   node --env-file=.env.local scripts/run-migration-120.mjs --rollback # reverse (run 120_down.sql)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '120_material_brand_category.sql')
const downSqlPath = join(here, '..', 'sql', 'migrations', '120_down.sql')

const rollback = process.argv.includes('--rollback')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(rollback ? downSqlPath : sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

// The 3 rows this migration sets brand='Generic' on (mixed-supplier
// consumables + generic cable). Verification asserts all three are
// branded after the run; the 5 branded-product rows are intentionally
// left NULL (flagged for owner input — see provenance doc).
const GENERIC_IDS = [
  '3ff08f92-830b-4ccf-b01e-83b16930ae83', // electrical Sundries (terminals, wire, clips)
  '7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250', // electrical TPS cable 2.5mm² per metre
  '23c751c4-ff97-49db-a34a-f8d676193819', // plumbing Plumbing sundries (fittings, seals, tape)
]

try {
  await c.connect()

  if (rollback) {
    console.log(`ROLLBACK — applying 120_down.sql (${sql.length.toLocaleString()} chars)...`)
    await c.query(sql)
    const { rows: reverted } = await c.query(
      `select id, trade, name, brand
         from shared_materials
        where id = any($1::uuid[])
        order by trade, name`,
      [GENERIC_IDS],
    )
    for (const r of reverted) {
      console.log(`  [${r.trade}] "${r.name}" -> brand=${JSON.stringify(r.brand)}`)
    }
    console.log('\nOK - migration 120 rolled back (the 3 Generic rows set back to NULL).')
    process.exit(0)
  }

  // FORWARD: snapshot the table BEFORE applying, so a bad brand-fill can be
  // reverted without data loss (spec: Migration backup + rollback). Idempotent
  // — never overwrites an existing snapshot.
  await c.query(
    `create table if not exists shared_materials_backup_mig120 as
       select * from shared_materials`,
  )
  console.log('Pre-apply backup snapshot: shared_materials_backup_mig120')

  console.log(`Applying 120_material_brand_category.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows } = await c.query(
    `select id, trade, name, brand
       from shared_materials
      where id = any($1::uuid[])
      order by trade, name`,
    [GENERIC_IDS],
  )
  let ok = rows.length === GENERIC_IDS.length
  for (const r of rows) {
    console.log(`  [${r.trade}] "${r.name}" -> brand=${JSON.stringify(r.brand)}`)
    if (r.brand !== 'Generic') ok = false
  }

  // Report (do not fail on) the remaining no-brand el+pl rows so the
  // operator sees the flagged-for-owner-input set after every run.
  const { rows: remaining } = await c.query(
    `select trade, name
       from shared_materials
      where trade in ('electrical','plumbing')
        and (brand is null or brand = '')
      order by trade, name`,
  )
  console.log(`\n  Remaining no-brand el+pl rows (flagged — owner input): ${remaining.length}`)
  for (const r of remaining) console.log(`    [${r.trade}] "${r.name}"`)

  if (!ok) {
    console.error('\nMigration 120 verification FAILED — expected 3 Generic-branded rows.')
    process.exit(1)
  }
  console.log('\nOK - migration 120 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
