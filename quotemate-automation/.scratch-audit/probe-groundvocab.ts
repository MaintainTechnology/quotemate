import { Client } from 'pg'
import { categorise, buildCandidatePrices } from '../lib/estimate/validate'
import { isCategory } from '../lib/estimate/categories'

async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    'select id, trade, name, category, default_unit_price_ex_gst from shared_materials order by trade, name',
  )
  await c.end()

  let invalid = 0
  let actuallyLosesTag = 0
  console.log('=== rows whose DB category is NOT a grounding Category ===')
  for (const r of rows as any[]) {
    if (r.category == null) continue
    if (isCategory(r.category)) continue
    invalid++
    const nameTags = categorise(r.name)
    // what the intended grounding tag would be, best-effort mapping
    console.log(
      `${r.trade} | cat=${r.category} | name="${r.name}" | categorise(name)=[${[...nameTags].join(',')}]` +
        (nameTags.has('general') && nameTags.size === 1 ? '   <<< ONLY [general] — tag genuinely lost' : ''),
    )
    if (nameTags.has('general') && nameTags.size === 1) actuallyLosesTag++
  }
  console.log(`\ninvalid-vocab rows: ${invalid};  rows that fall back to bare [general]: ${actuallyLosesTag}`)

  // --- reproduce the production failure exactly -------------------------
  console.log('\n=== reproduce prod failure (electrical, markup 28%) ===')
  const elec = (rows as any[]).filter((r) => r.trade === 'electrical')
  const cands = buildCandidatePrices(
    elec.map((r) => ({ id: r.id, name: r.name, price: r.default_unit_price_ex_gst, category: r.category ?? null })),
    [],
    { default_markup_pct: 28 } as any,
  )
  const lineDesc = 'Cable, terminals, clips'
  const lineCats = categorise(lineDesc)
  console.log(`line "${lineDesc}" -> [${[...lineCats].join(',')}]`)
  const priceMatches = cands.material.filter((x) => Math.abs(x.price - 6.4) <= 0.5)
  for (const m of priceMatches) {
    console.log(`  price-match $${m.price} "${m.sourceName}" [${[...m.categories].join(',')}]`)
  }

  // now with the category FIXED to the grounding vocab
  const candsFixed = buildCandidatePrices(
    elec.map((r) => ({
      id: r.id,
      name: r.name,
      price: r.default_unit_price_ex_gst,
      category: r.category === 'sundries' ? 'sundry' : r.category,
    })),
    [],
    { default_markup_pct: 28 } as any,
  )
  const fixedMatches = candsFixed.material.filter((x) => Math.abs(x.price - 6.4) <= 0.5)
  for (const m of fixedMatches) {
    console.log(`  FIXED: price-match $${m.price} "${m.sourceName}" [${[...m.categories].join(',')}]`)
  }
}

main().catch((e) => {
  console.error('ERR', e)
  process.exit(1)
})
