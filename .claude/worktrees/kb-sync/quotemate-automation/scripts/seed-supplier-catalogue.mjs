// QuoteMate · v7 Phase 2a seed — initial supplier_catalogue starter set.
//
// Scope (honest about what this is): ~50 SKUs, hand-curated from common AU
// brands across the most-quoted categories. Brand + range_series strings
// are accurate (Clipsal Iconic IS the better-tier line, Caroma Liano IS a
// popular better-tier basin mixer, etc.). default_unit_price_ex_gst values
// are APPROXIMATE RRPs — tradies set their own price when they copy a SKU
// into their tenant_material_catalogue, so RRP wrong by ±20% doesn't reach
// a customer quote. The grounding validator NEVER reads supplier_catalogue.
//
// The v7 strategy entry said ~300 SKUs as the aspirational target; this
// seed is the realistic starter set per the scope-deviation note in v7's
// "Trigger for the next iteration" list. Expand as pilot tradies ask
// for brands not covered here.
//
// Idempotent: uses ON CONFLICT (trade, brand, lower(name)) WHERE retired_at
// IS NULL DO UPDATE — re-running refreshes prices but keeps existing IDs
// (so any tenant_material_catalogue rows linked via supplier_catalogue_id
// keep their link).
//
// Two modes:
//   node --env-file=.env.local scripts/seed-supplier-catalogue.mjs
//     → dry-run; prints what WOULD be upserted
//   node --env-file=.env.local scripts/seed-supplier-catalogue.mjs --apply
//     → upserts the rows

import pg from 'pg'

const { Client } = pg
const APPLY = process.argv.includes('--apply')

// ────────────────────────────────────────────────────────────────
// Seed data
// ────────────────────────────────────────────────────────────────

const SKUS = [
  // ── ELECTRICAL ────────────────────────────────────────────────
  // GPOs (general-purpose outlets) — the most-quoted electrical category.
  // HPM Excel = good (builder-grade); Clipsal Iconic = better; Saturn Zen = best.
  { trade: 'electrical', category: 'gpo', brand: 'HPM',     range_series: 'Excel',      name: 'HPM Excel single GPO 10A',                         supplier_label: 'L&H Group',          default_unit_price_ex_gst:   5.50, tier_hint: 'good'   },
  { trade: 'electrical', category: 'gpo', brand: 'HPM',     range_series: 'Excel',      name: 'HPM Excel double GPO 10A',                         supplier_label: 'L&H Group',          default_unit_price_ex_gst:   8.50, tier_hint: 'good'   },
  { trade: 'electrical', category: 'gpo', brand: 'Clipsal', range_series: '2000',       name: 'Clipsal 2000 series double GPO 10A',               supplier_label: 'MM Electrical',      default_unit_price_ex_gst:   9.50, tier_hint: 'good'   },
  { trade: 'electrical', category: 'gpo', brand: 'Clipsal', range_series: 'Iconic',     name: 'Clipsal Iconic double GPO 10A',                    supplier_label: 'MM Electrical',      default_unit_price_ex_gst:  25.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'gpo', brand: 'Clipsal', range_series: 'Iconic',     name: 'Clipsal Iconic double GPO with USB-A+C',           supplier_label: 'MM Electrical',      default_unit_price_ex_gst:  95.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'gpo', brand: 'Clipsal', range_series: 'Saturn Zen', name: 'Clipsal Saturn Zen double GPO',                    supplier_label: 'MM Electrical',      default_unit_price_ex_gst:  70.00, tier_hint: 'best'   },

  // Downlights — second most-quoted. SAL = good/budget; Versalux & Brilliant span range; Saturn = best.
  { trade: 'electrical', category: 'downlight', brand: 'SAL',       range_series: 'Aniko',          name: 'SAL Aniko 9W LED downlight warm white',            supplier_label: 'Reece Electrical', default_unit_price_ex_gst:  22.00, tier_hint: 'good'   },
  { trade: 'electrical', category: 'downlight', brand: 'SAL',       range_series: 'Anova',          name: 'SAL Anova 13W LED downlight tri-colour',           supplier_label: 'Reece Electrical', default_unit_price_ex_gst:  45.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'downlight', brand: 'Brilliant', range_series: 'Halo 90',        name: 'Brilliant Halo 90 9W LED downlight',               supplier_label: 'Bunnings',         default_unit_price_ex_gst:  19.50, tier_hint: 'good'   },
  { trade: 'electrical', category: 'downlight', brand: 'Versalux',  range_series: 'LED Plus',       name: 'Versalux LED Plus 10W tri-colour dimmable',        supplier_label: 'L&H Group',        default_unit_price_ex_gst:  52.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'downlight', brand: 'Versalux',  range_series: 'Trio Pro',       name: 'Versalux Trio Pro 13W downlight',                  supplier_label: 'L&H Group',        default_unit_price_ex_gst:  78.00, tier_hint: 'best'   },
  { trade: 'electrical', category: 'downlight', brand: 'Brilliant', range_series: 'Lumiere Wifi',   name: 'Brilliant Lumiere WiFi downlight',                 supplier_label: 'Bunnings',         default_unit_price_ex_gst:  92.00, tier_hint: 'best'   },

  // Smoke alarms — required-by-law category in AU. Brooks + Cavius are the two real volume brands.
  { trade: 'electrical', category: 'smoke_alarm', brand: 'Brooks', range_series: '9V Photoelectric',     name: 'Brooks 9V photoelectric smoke alarm',          supplier_label: 'MM Electrical',     default_unit_price_ex_gst:  32.00, tier_hint: 'good'   },
  { trade: 'electrical', category: 'smoke_alarm', brand: 'Cavius', range_series: '10yr Lithium',        name: 'Cavius 10yr lithium photoelectric smoke alarm', supplier_label: 'L&H Group',         default_unit_price_ex_gst:  42.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'smoke_alarm', brand: 'Brooks', range_series: '240V Interconnected', name: 'Brooks 240V interconnected smoke alarm',       supplier_label: 'MM Electrical',     default_unit_price_ex_gst:  82.00, tier_hint: 'best'   },

  // Ceiling fans — the two AU brands tradies actually install. Brilliant = good; Hunter Pacific = better/best.
  { trade: 'electrical', category: 'ceiling_fan', brand: 'Brilliant',       range_series: 'Tempest 48"',   name: 'Brilliant Tempest 48" ceiling fan (no light)',     supplier_label: 'Bunnings',           default_unit_price_ex_gst: 178.00, tier_hint: 'good'   },
  { trade: 'electrical', category: 'ceiling_fan', brand: 'Hunter Pacific', range_series: 'Eco2 52" DC',   name: 'Hunter Pacific Eco2 52" DC ceiling fan',          supplier_label: 'Hunter Pacific',     default_unit_price_ex_gst: 415.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'ceiling_fan', brand: 'Hunter Pacific', range_series: 'Concept 52" DC', name: 'Hunter Pacific Concept 52" DC fan with LED light', supplier_label: 'Hunter Pacific',     default_unit_price_ex_gst: 518.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'ceiling_fan', brand: 'Hunter Pacific', range_series: 'Spitfire DC',    name: 'Hunter Pacific Spitfire DC fan with LED',         supplier_label: 'Hunter Pacific',     default_unit_price_ex_gst: 752.00, tier_hint: 'best'   },

  // Safety switches (RCBOs) — switchboard category. HPM = good; Clipsal Resi9 = better; Clipsal Pro = best.
  { trade: 'electrical', category: 'safety_switch', brand: 'HPM',     range_series: '2-pole RCBO',  name: 'HPM 2-pole RCBO 32A',          supplier_label: 'L&H Group',     default_unit_price_ex_gst:  45.00, tier_hint: 'good'   },
  { trade: 'electrical', category: 'safety_switch', brand: 'Clipsal', range_series: 'Resi9 RCBO',   name: 'Clipsal Resi9 RCBO 32A',       supplier_label: 'MM Electrical', default_unit_price_ex_gst:  82.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'safety_switch', brand: 'Clipsal', range_series: 'Pro RCBO',     name: 'Clipsal Pro RCBO 40A',         supplier_label: 'MM Electrical', default_unit_price_ex_gst: 118.00, tier_hint: 'best'   },

  // Outdoor lights — the "deck/garden lighting" easy-5 category.
  { trade: 'electrical', category: 'outdoor_light', brand: 'Brilliant', range_series: 'Lumiere Outdoor', name: 'Brilliant Lumiere outdoor wall light',  supplier_label: 'Bunnings',         default_unit_price_ex_gst:  42.00, tier_hint: 'good'   },
  { trade: 'electrical', category: 'outdoor_light', brand: 'SAL',       range_series: 'Marine LED',      name: 'SAL Marine LED outdoor wall light',     supplier_label: 'Reece Electrical', default_unit_price_ex_gst:  85.00, tier_hint: 'better' },
  { trade: 'electrical', category: 'outdoor_light', brand: 'Versalux',  range_series: 'Outdoor Pro',     name: 'Versalux Outdoor Pro spotlight',        supplier_label: 'L&H Group',        default_unit_price_ex_gst: 128.00, tier_hint: 'best'   },

  // ── PLUMBING ──────────────────────────────────────────────────
  // Basin tapware — most-quoted plumbing category after HWS.
  { trade: 'plumbing', category: 'tapware_basin', brand: 'Methven', range_series: 'Maku',            name: 'Methven Maku basin mixer',                supplier_label: 'Reece',     default_unit_price_ex_gst: 138.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'tapware_basin', brand: 'Caroma',  range_series: 'Saracom',         name: 'Caroma Saracom basin tap pair',           supplier_label: 'Reece',     default_unit_price_ex_gst:  88.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'tapware_basin', brand: 'Caroma',  range_series: 'Liano',           name: 'Caroma Liano basin mixer',                supplier_label: 'Reece',     default_unit_price_ex_gst: 338.00, tier_hint: 'better' },
  { trade: 'plumbing', category: 'tapware_basin', brand: 'Methven', range_series: 'Aurajet',         name: 'Methven Aurajet basin mixer',             supplier_label: 'Reece',     default_unit_price_ex_gst: 282.00, tier_hint: 'better' },
  { trade: 'plumbing', category: 'tapware_basin', brand: 'Phoenix', range_series: 'Vivid Slimline',  name: 'Phoenix Vivid Slimline basin mixer',      supplier_label: 'Reece',     default_unit_price_ex_gst: 318.00, tier_hint: 'better' },

  // Kitchen tapware.
  { trade: 'plumbing', category: 'tapware_kitchen', brand: 'Methven', range_series: 'Maku',           name: 'Methven Maku sink mixer',                  supplier_label: 'Reece',     default_unit_price_ex_gst: 158.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'tapware_kitchen', brand: 'Phoenix', range_series: 'Lexi MKII',      name: 'Phoenix Lexi MKII sink mixer',             supplier_label: 'Reece',     default_unit_price_ex_gst: 218.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'tapware_kitchen', brand: 'Phoenix', range_series: 'Vivid Slimline', name: 'Phoenix Vivid Slimline pull-down kitchen mixer', supplier_label: 'Reece', default_unit_price_ex_gst: 448.00, tier_hint: 'better' },
  { trade: 'plumbing', category: 'tapware_kitchen', brand: 'Caroma',  range_series: 'Liano Nexus',    name: 'Caroma Liano Nexus pull-down kitchen mixer', supplier_label: 'Reece',   default_unit_price_ex_gst: 422.00, tier_hint: 'better' },

  // Laundry + outdoor tapware (smaller categories).
  { trade: 'plumbing', category: 'tapware_laundry', brand: 'Caroma',  range_series: 'Saracom',     name: 'Caroma Saracom laundry trough tap pair', supplier_label: 'Reece',     default_unit_price_ex_gst:  94.00, tier_hint: 'good' },
  { trade: 'plumbing', category: 'tapware_laundry', brand: 'Methven', range_series: 'Maku',        name: 'Methven Maku laundry mixer',             supplier_label: 'Reece',     default_unit_price_ex_gst: 148.00, tier_hint: 'good' },
  { trade: 'plumbing', category: 'tapware_outdoor', brand: 'Reece',   range_series: 'Tradeflow',   name: 'Reece Tradeflow garden tap',             supplier_label: 'Reece',     default_unit_price_ex_gst:  28.00, tier_hint: 'good' },
  { trade: 'plumbing', category: 'tapware_outdoor', brand: 'Phoenix', range_series: 'Garden Tap',  name: 'Phoenix garden tap',                     supplier_label: 'Reece',     default_unit_price_ex_gst:  44.00, tier_hint: 'good' },

  // Toilet suites — Caroma is dominant in AU.
  { trade: 'plumbing', category: 'toilet', brand: 'Caroma', range_series: 'Carina',              name: 'Caroma Carina back-to-wall toilet suite',           supplier_label: 'Reece',     default_unit_price_ex_gst:  515.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'toilet', brand: 'Caroma', range_series: 'Cleanflush',          name: 'Caroma Cleanflush wall-faced toilet suite',         supplier_label: 'Reece',     default_unit_price_ex_gst:  885.00, tier_hint: 'better' },
  { trade: 'plumbing', category: 'toilet', brand: 'Caroma', range_series: 'Smartflush Mira',     name: 'Caroma Smartflush Mira easy-height toilet suite',   supplier_label: 'Reece',     default_unit_price_ex_gst: 1095.00, tier_hint: 'better' },
  { trade: 'plumbing', category: 'toilet', brand: 'Caroma', range_series: 'Urbane II Cleanflush', name: 'Caroma Urbane II wall-faced cleanflush toilet suite', supplier_label: 'Reece',   default_unit_price_ex_gst: 1448.00, tier_hint: 'best'   },

  // Gas HWS — Rheem + Rinnai dominate AU.
  { trade: 'plumbing', category: 'hws_gas', brand: 'Rheem',  range_series: '5-star 260L',       name: 'Rheem 5-star 260L gas storage HWS',             supplier_label: 'Reece',     default_unit_price_ex_gst: 1845.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'hws_gas', brand: 'Rinnai', range_series: 'Builders Hotflo 270L', name: 'Rinnai Builders Hotflo 270L gas storage HWS', supplier_label: 'Reece',     default_unit_price_ex_gst: 1898.00, tier_hint: 'good'   },
  { trade: 'plumbing', category: 'hws_gas', brand: 'Rinnai', range_series: 'Infinity 26',       name: 'Rinnai Infinity 26 continuous-flow gas HWS',    supplier_label: 'Reece',     default_unit_price_ex_gst: 1445.00, tier_hint: 'better' },

  // Electric HWS.
  { trade: 'plumbing', category: 'hws_electric', brand: 'Rheem', range_series: 'Stellar 250L', name: 'Rheem Stellar 250L electric storage HWS',  supplier_label: 'Reece',     default_unit_price_ex_gst: 1448.00, tier_hint: 'good' },
  { trade: 'plumbing', category: 'hws_electric', brand: 'Dux',   range_series: 'Proflo 315L',  name: 'Dux Proflo 315L electric storage HWS',     supplier_label: 'Reece',     default_unit_price_ex_gst: 1645.00, tier_hint: 'good' },

  // Heat pump HWS — premium category, government-rebate eligible.
  { trade: 'plumbing', category: 'hws_heat_pump', brand: 'Sanden',          range_series: 'Eco Plus 250L',     name: 'Sanden Eco Plus 250L heat pump HWS',         supplier_label: 'Reece',     default_unit_price_ex_gst: 3848.00, tier_hint: 'better' },
  { trade: 'plumbing', category: 'hws_heat_pump', brand: 'Reclaim Energy',  range_series: 'CO2 270L',          name: 'Reclaim Energy 270L CO2 heat pump HWS',      supplier_label: 'Reece',     default_unit_price_ex_gst: 4945.00, tier_hint: 'best'   },
  { trade: 'plumbing', category: 'hws_heat_pump', brand: 'Stiebel Eltron',  range_series: 'Accelera 300L',     name: 'Stiebel Eltron Accelera 300L heat pump HWS', supplier_label: 'Reece',     default_unit_price_ex_gst: 4248.00, tier_hint: 'best'   },
]

// ────────────────────────────────────────────────────────────────
// Apply
// ────────────────────────────────────────────────────────────────

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  console.log(`Mode: ${APPLY ? 'APPLY (will upsert rows)' : 'DRY-RUN (read-only)'}\n`)
  console.log(`Seed rows: ${SKUS.length}`)
  const byTrade = SKUS.reduce((acc, s) => ((acc[s.trade] = (acc[s.trade] ?? 0) + 1), acc), {})
  for (const [t, n] of Object.entries(byTrade)) console.log(`  ${t}: ${n}`)
  const categories = [...new Set(SKUS.map((s) => `${s.trade}:${s.category}`))].sort()
  console.log(`Categories covered: ${categories.length}`)
  for (const c of categories) {
    const n = SKUS.filter((s) => `${s.trade}:${s.category}` === c).length
    console.log(`  ${c}: ${n}`)
  }

  const before = await client.query('select count(*)::int as n from supplier_catalogue')
  console.log(`\nsupplier_catalogue rows before: ${before.rows[0].n}`)

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to seed.')
    process.exit(0)
  }

  // Upsert one row at a time so the unique constraint's WHERE-clause
  // matches (PostgREST-style batched upsert with partial indexes is
  // brittle; per-row is slow but bulletproof for a 50-row seed).
  let inserted = 0
  let updated = 0
  for (const s of SKUS) {
    const { rows } = await client.query(
      `insert into supplier_catalogue
         (trade, category, brand, range_series, name, supplier_label,
          default_unit_price_ex_gst, tier_hint)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (trade, brand, lower(name)) where retired_at is null
       do update set
         category = excluded.category,
         range_series = excluded.range_series,
         supplier_label = excluded.supplier_label,
         default_unit_price_ex_gst = excluded.default_unit_price_ex_gst,
         tier_hint = excluded.tier_hint,
         supplier_revision = supplier_catalogue.supplier_revision + 1
       returning (xmax = 0) as inserted`,
      [s.trade, s.category, s.brand, s.range_series, s.name, s.supplier_label, s.default_unit_price_ex_gst, s.tier_hint],
    )
    if (rows[0]?.inserted) inserted++
    else updated++
  }
  console.log(`\nUpsert complete — inserted: ${inserted}, updated: ${updated}`)

  const after = await client.query('select count(*)::int as n from supplier_catalogue')
  console.log(`supplier_catalogue rows after: ${after.rows[0].n}`)
} catch (err) {
  console.error('Seed failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
