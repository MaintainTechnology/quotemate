// READ-ONLY: does the spec-guard have anything to bite on for GPO/power-points?
// Shows GPO-ish rows + whether their NAME carries an amperage (name-parse path)
// and whether properties carry one (structured path). No writes.
// Run: node --env-file=.env.local scripts/diag-gpo-specs.mjs

import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const AMP = /\b\d{1,2}\s?a\b/i // 10A, 15 A, etc.
const where = `(category ilike '%gpo%' or name ilike '%gpo%' or name ilike '%power point%' or name ilike '%powerpoint%' or name ilike '%socket%' or name ilike '%outlet%')`

async function look(tbl, extra = '') {
  try {
    const r = await c.query(`select name, category, properties from ${tbl} where ${where} ${extra} order by name`)
    const rows = r.rows.map((x) => ({
      name: x.name,
      category: x.category,
      amp_in_name: AMP.test(String(x.name || '')) ? 'YES' : '—',
      props_has_amp:
        x.properties && JSON.stringify(x.properties).toLowerCase().includes('amper') ? 'YES' : '—',
    }))
    console.log(`\n=== ${tbl} (${rows.length} GPO-ish rows) ===`)
    console.table(rows)
    const named = rows.filter((x) => x.amp_in_name === 'YES').length
    const propd = rows.filter((x) => x.props_has_amp === 'YES').length
    console.log(`  amperage in NAME: ${named}/${rows.length}   |   amperage in PROPERTIES: ${propd}/${rows.length}`)
  } catch (e) {
    console.log(`\n=== ${tbl} ===\n  (query failed: ${e.message})`)
  }
}

await look('shared_materials')
await look('shared_assemblies')
await look('tenant_material_catalogue', `and active`)

await c.end()
console.log('\n[done] read-only — no rows modified.')
