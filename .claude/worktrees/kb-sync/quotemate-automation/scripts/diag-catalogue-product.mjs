// Look up a catalogue product by id across the candidate tables, to see
// its full properties (weatherproof / outdoor / IP rating etc.).
// Usage: node --env-file=.env.local scripts/diag-catalogue-product.mjs <id>

import pg from 'pg'

const id = process.argv[2]
if (!id) { console.error('pass a catalogue id'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

for (const t of ['tenant_material_catalogue', 'supplier_catalogue', 'shared_materials']) {
  try {
    const { rows } = await c.query(`select * from ${t} where id = $1`, [id])
    if (rows.length) {
      const r = rows[0]
      console.log(`FOUND in ${t}:`)
      for (const k of ['name', 'product_name', 'category', 'material_category', 'brand', 'description', 'properties', 'tier_hint', 'weatherproof', 'ip_rating', 'unit_price_ex_gst', 'default_unit_price_ex_gst']) {
        if (k in r && r[k] != null) console.log(`  ${k.padEnd(24)}: ${typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]}`)
      }
      console.log('  ALL COLUMNS:', Object.keys(r).join(', '))
    }
  } catch {
    /* table/column shape differs — skip */
  }
}
await c.end()
