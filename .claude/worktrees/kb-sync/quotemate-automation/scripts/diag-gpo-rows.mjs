// READ-ONLY: dump id + name + raw properties for GPO rows so the amperage
// backfill migration can target rows precisely (by id) and match the existing
// properties.amperage key/format. No writes.
// Run: node --env-file=.env.local scripts/diag-gpo-rows.mjs

import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const where = `(category ilike '%gpo%' or name ilike '%gpo%' or name ilike '%power point%' or name ilike '%powerpoint%' or name ilike '%socket%' or name ilike '%outlet%')`

for (const tbl of ['shared_materials', 'shared_assemblies', 'tenant_material_catalogue']) {
  try {
    const r = await c.query(`select id, name, category, properties from ${tbl} where ${where} order by name`)
    console.log(`\n=== ${tbl} ===`)
    for (const row of r.rows) {
      console.log(`  ${row.id}  |  ${row.name}  |  cat=${row.category}  |  props=${JSON.stringify(row.properties)}`)
    }
  } catch (e) {
    console.log(`\n=== ${tbl} ===  (failed: ${e.message})`)
  }
}
await c.end()
console.log('\n[done] read-only.')
