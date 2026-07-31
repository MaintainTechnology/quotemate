import { categorise, buildCandidatePrices, validateQuoteGrounding } from '../lib/estimate/validate'
import { isCategory } from '../lib/estimate/categories'

console.log('categorise("Cable, terminals, clips") =', [...categorise('Cable, terminals, clips')])
console.log('categorise("TPS cable 2.5mm² per metre") =', [...categorise('TPS cable 2.5mm² per metre')])
console.log('categorise("Sundries (terminals, wire, clips)") =', [...categorise('Sundries (terminals, wire, clips)')])
console.log('--- isCategory() on values ACTUALLY stored in shared_materials.category ---')
for (const v of ['sundries','sundry','ceiling_fan','fan','safety_switch','rcbo','hws_gas','hws_electric','hws_heat_pump','hot_water','tapware_kitchen','tap','toilet_repair','downlight','gpo','smoke_alarm','outdoor_light','toilet'])
  console.log('  isCategory(' + JSON.stringify(v) + ') =', isCategory(v))

const mats = [
  { name: 'Basic LED downlight', price: 28, category: 'downlight' },
  { name: 'Dimmable IP-rated downlight', price: 72, category: 'downlight' },
  { name: 'Hardwired smoke alarm', price: 95, category: 'smoke_alarm' },
  { name: 'Interconnected RF smoke alarm', price: 120, category: 'smoke_alarm' },
  { name: 'Premium 90+CRI warm-white LED downlight (5yr warranty)', price: 75, category: 'downlight' },
  { name: 'Premium DC ceiling fan + wall control', price: 380, category: 'ceiling_fan' },
  { name: 'Premium IP65 outdoor wall light', price: 75, category: 'outdoor_light' },
  { name: 'Quality AC ceiling fan + remote', price: 220, category: 'ceiling_fan' },
  { name: 'RCBO safety switch', price: 85, category: 'safety_switch' },
  { name: 'Smart dimmable outdoor light', price: 140, category: 'outdoor_light' },
  { name: 'Smart Wi-Fi double GPO', price: 95, category: 'gpo' },
  { name: 'Standard double GPO', price: 25, category: 'gpo' },
  { name: 'Sundries (terminals, wire, clips)', price: 50, category: 'sundries' },
  { name: 'TPS cable 2.5mm² per metre', price: 5, category: 'sundries' },
  { name: 'Tri-colour LED downlight', price: 48, category: 'downlight' },
  { name: 'USB double GPO', price: 70, category: 'gpo' },
  { name: 'Weatherproof double GPO (IP56)', price: 58, category: 'gpo' },
]
const book: any = { default_markup_pct: 28, hourly_rate: 110, min_labour_hours: 2 }
const cands = buildCandidatePrices(mats as any, [], book)
const at = (p: number) => JSON.stringify(cands.material.filter((c: any) => Math.abs(c.price - p) < 0.01).map((c: any) => ({ n: c.sourceName, cats: [...c.categories] })))
console.log('\ncandidates @ $6.40 :', at(6.4))
console.log('candidates @ $64.00:', at(64))

const mk = (price: number, desc = 'Cable, terminals, clips') => ({ good: { line_items: [
  { description: 'Supply & install Basic LED downlight', unit: 'each', quantity: 10, unit_price_ex_gst: 35.84 },
  { description: desc, unit: 'each', quantity: 1, unit_price_ex_gst: price },
], subtotal_ex_gst: 0 } } as any)

console.log('\n>>> PRODUCTION VALUE: "Cable, terminals, clips" @ $6.40 =', JSON.stringify(validateQuoteGrounding(mk(6.4), book, cands)))
console.log('\n>>> same desc @ $64.00 (Sundries pack x1.28) =', JSON.stringify(validateQuoteGrounding(mk(64), book, cands)))
console.log('\n>>> COUNTERFACTUAL A (drop the word "terminals") @ $6.40 =', JSON.stringify(validateQuoteGrounding(mk(6.4, 'Cable and clips'), book, cands)))
const fixed = mats.map(m => ({ ...m, category: m.category === 'sundries' ? 'sundry' : m.category }))
console.log('\n>>> COUNTERFACTUAL B (category spelled "sundry") @ $6.40 =', JSON.stringify(validateQuoteGrounding(mk(6.4), book, buildCandidatePrices(fixed as any, [], book))))
