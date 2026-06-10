// READ-ONLY dry-run: what Good/Better/Best would each tenant get for
// "Replace double GPO" under the deterministic builder (recipe = 1 × gpo)?
// Imports the REAL buildDeterministicTiers so this proves the actual engine
// against live catalogue data — BEFORE any prod write.
// Run: node --import tsx --env-file=.env.local scripts/dry-run-gpo-determinism.mjs

import pg from 'pg'
import { buildDeterministicTiers } from '../lib/estimate/deterministic-bom.ts'

const { Client } = pg
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const LABOUR_HOURS = 0.3 // shared_assemblies."Replace double GPO".default_labour_hours
const BOM = [{ material_category: 'gpo', quantity: 1, required: true }]

const tenants = await c.query(`select id, business_name from tenants order by business_name`)

for (const t of tenants.rows) {
  const pb = await c.query(
    `select hourly_rate, default_markup_pct from pricing_book
      where tenant_id = $1 and trade = 'electrical' limit 1`,
    [t.id],
  )
  if (pb.rows.length === 0) {
    console.log(`\n## ${t.business_name}: no electrical pricing_book — skip`)
    continue
  }
  const { hourly_rate, default_markup_pct } = pb.rows[0]

  const cat = await c.query(
    `select id, category, name, brand, range_series, unit_price_ex_gst, tier_hint, is_preferred, active
       from tenant_material_catalogue
      where tenant_id = $1 and active and lower(category) = 'gpo'`,
    [t.id],
  )
  const shared = await c.query(
    `select name, category, default_unit_price_ex_gst, unit
       from shared_materials where trade = 'electrical' and lower(category) = 'gpo'`,
  )

  const res = buildDeterministicTiers({
    bom: BOM,
    tenantMaterials: cat.rows,
    sharedMaterials: shared.rows,
    labourHours: LABOUR_HOURS,
    hourlyRate: Number(hourly_rate),
    markupPct: Number(default_markup_pct),
  })

  console.log(
    `\n## ${t.business_name}  (rate $${hourly_rate}/h · markup ${default_markup_pct}% · ${cat.rows.length} gpo catalogue rows)`,
  )
  if (!res.tiers) {
    console.log(`   → NOT deterministic: ${res.reason}`)
    continue
  }
  for (const tier of ['good', 'better', 'best']) {
    const lines = res.tiers[tier].line_items
      .map((l) => `${l.description} ${l.quantity}×$${l.unit_price_ex_gst}=$${l.total_ex_gst}`)
      .join('  |  ')
    console.log(`   ${tier.toUpperCase().padEnd(6)} subtotal $${res.tiers[tier].subtotal_ex_gst}   [ ${lines} ]`)
  }
}

await c.end()
console.log('\n(done — read-only, no writes)')
