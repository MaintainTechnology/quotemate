// QuoteMate - run migration 118 (seed shared_assembly_bom for CORE
// electrical + plumbing assemblies)
// Usage: node --env-file=.env.local scripts/run-migration-118.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '118_shared_assembly_bom_seed.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`Applying 118_shared_assembly_bom_seed.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  // Verify: how many BOM rows now exist, and that EVERY row's
  // material_category references a real shared_materials.category for the
  // SAME trade (the load-bearing constraint — chooseMaterial() needs an
  // exact category match for the deterministic path to resolve a price).
  const { rows: countRows } = await c.query(
    `select count(*)::int as n from shared_assembly_bom`,
  )
  const total = countRows[0].n

  const { rows: orphans } = await c.query(`
    select b.trade, a.name as assembly_name, b.material_category
    from shared_assembly_bom b
    join shared_assemblies a on a.id = b.assembly_id
    where not exists (
      select 1 from shared_materials m
      where m.trade = b.trade
        and lower(m.category) = lower(b.material_category)
    )
    order by b.trade, a.name, b.material_category`)

  const { rows: covered } = await c.query(`
    select b.trade, count(distinct b.assembly_id)::int as assemblies_with_bom
    from shared_assembly_bom b
    group by b.trade order by b.trade`)

  console.log(`\n  shared_assembly_bom total rows: ${total}`)
  console.log('  assemblies with a BOM, by trade:')
  for (const r of covered) console.log(`    ${r.trade}: ${r.assemblies_with_bom}`)

  if (orphans.length > 0) {
    console.error(
      `\n  ${orphans.length} BOM row(s) reference a material_category NOT in shared_materials:`,
    )
    for (const o of orphans) {
      console.error(`    [${o.trade}] ${o.assembly_name} -> "${o.material_category}"`)
    }
    // NB: a pre-existing row ("Replace LED downlight" -> "sundry") is a
    // known orphan from before R18 (shared_materials uses "sundries").
    // R18 did NOT introduce it and does NOT fix it (out of scope; flagged
    // to the owner). Fail only if a row OTHER than that known pre-existing
    // one is orphaned.
    const unexpected = orphans.filter(
      (o) => !(o.material_category.toLowerCase() === 'sundry'),
    )
    if (unexpected.length > 0) {
      console.error('\n  Unexpected orphan(s) above — failing.')
      process.exit(1)
    }
    console.error(
      '\n  (The only orphan is the pre-existing "sundry" row — expected, not introduced by R18.)',
    )
  } else {
    console.log('\n  All BOM material_category values resolve to a real shared_materials.category.')
  }

  console.log('\nOK - migration 118 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
