import { Client } from 'pg'
import { buildCandidatePrices, validateQuoteGrounding } from '../lib/estimate/validate'

async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    "select id, name, category, default_unit_price_ex_gst from shared_materials where trade='electrical'",
  )
  const pb = (await c.query(
    "select * from pricing_book where trade='electrical' and tenant_id='6dca084c-10d5-4459-b48f-9b45e4bbc68a'",
  )).rows[0]
  await c.end()
  console.log('pricing_book:', JSON.stringify({
    hourly_rate: pb?.hourly_rate, apprentice_rate: pb?.apprentice_rate,
    call_out_minimum: pb?.call_out_minimum, default_markup_pct: pb?.default_markup_pct,
    min_labour_hours: pb?.min_labour_hours,
  }))

  // A minimal draft reproducing the production 'good' tier shape:
  // line 0 = downlight material, line 1 = the failing sundries line, line 2 = labour.
  const mk = () => ({
    needs_inspection: false,
    good: {
      line_items: [
        { description: '9W LED downlight', quantity: 10, unit: 'each', unit_price_ex_gst: 35.84, total_ex_gst: 358.4, source: 'material' },
        { description: 'Cable, terminals, clips', quantity: 10, unit: 'each', unit_price_ex_gst: 6.4, total_ex_gst: 64, source: 'material' },
        { description: 'Electrician labour', quantity: 3, unit: 'hr', unit_price_ex_gst: Number(pb.hourly_rate), total_ex_gst: 3 * Number(pb.hourly_rate), source: 'labour' },
      ],
      subtotal_ex_gst: 0,
    },
  })

  const rowsFor = (fix: boolean) =>
    (rows as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      price: r.default_unit_price_ex_gst,
      category: fix && r.category === 'sundries' ? 'sundry' : r.category,
    }))

  for (const fix of [false, true]) {
    const cands = buildCandidatePrices(rowsFor(fix), [], pb)
    const res: any = validateQuoteGrounding(mk(), pb, cands)
    console.log(`\n--- category ${fix ? "MAPPED to 'sundry'" : "as-is ('sundries')"} ---`)
    console.log('valid =', res.valid)
    for (const f of res.failures ?? []) console.log('  FAIL:', f.description, '$' + f.unit_price_ex_gst, '::', f.expected)
  }
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
