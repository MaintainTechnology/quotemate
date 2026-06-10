// Throwaway diagnostic for v7 Phase 6: what's the canonical category
// vocabulary per trade? Used to drive the CatalogueTab category dropdown.
//
// Source of truth: union of distinct values from
//   shared_assembly_bom.material_category  (the BOM-side categories the
//     estimator resolves against)
//   shared_materials.category              (the generic fallback library)
//   supplier_catalogue.category            (the new master library — v7)
// per trade.
//
// Also reports any tenant_material_catalogue rows whose category is NOT
// in the canonical list — those would get a "deprecated category" badge
// in Phase 6's UI.

import pg from 'pg'

const { Client } = pg
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const sources = [
  { table: 'shared_assembly_bom', col: 'material_category', tradeCol: 'trade' },
  { table: 'shared_materials', col: 'category', tradeCol: 'trade' },
  { table: 'supplier_catalogue', col: 'category', tradeCol: 'trade' },
]

const canonical = new Map() // trade -> Set<category>
for (const s of sources) {
  const { rows } = await c.query(
    `select distinct ${s.tradeCol} as trade, ${s.col} as cat from ${s.table} where ${s.col} is not null and ${s.col} <> ''`,
  )
  for (const r of rows) {
    if (!canonical.has(r.trade)) canonical.set(r.trade, new Set())
    canonical.get(r.trade).add(r.cat)
  }
}

for (const trade of [...canonical.keys()].sort()) {
  const cats = [...canonical.get(trade)].sort()
  console.log(`${trade} (${cats.length}): ${cats.join(', ')}`)
}

// Check tenant_material_catalogue for any deprecated categories.
const { rows: tenantCats } = await c.query(
  "select trade, category, count(*)::int as n from tenant_material_catalogue group by trade, category order by trade, category",
)
console.log('\nTenant catalogue categories in use:')
let deprecated = 0
for (const r of tenantCats) {
  const set = canonical.get(r.trade) ?? new Set()
  const ok = set.has(r.category)
  if (!ok) deprecated++
  console.log(`  ${r.trade} / ${r.category} = ${r.n} row(s)${ok ? '' : '  ⚠ NOT IN CANONICAL'}`)
}
console.log(`\nDeprecated categories: ${deprecated}`)

await c.end()
