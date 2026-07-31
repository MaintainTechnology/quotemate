// READ-ONLY probe. Reproduces the exact production grounding failure using the
// REAL validator + the REAL production row values. No DB writes, no LLM.
import {
  categorise,
  buildCandidatePrices,
  validateQuoteGrounding,
} from '../lib/estimate/validate'
import { isCategory } from '../lib/estimate/categories'

const book = {
  hourly_rate: 110,
  apprentice_rate: 65,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

// The exact prod rows (shared_materials, trade=electrical).
const MATERIALS = [
  { id: '7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250', name: 'TPS cable 2.5mm² per metre', price: 5.0, category: 'sundries' },
  { id: '3ff08f92-830b-4ccf-b01e-83b16930ae83', name: 'Sundries (terminals, wire, clips)', price: 50.0, category: 'sundries' },
  { id: 'cd2d4533-f0c2-42b6-9f92-acc0193d8b6a', name: 'Brilliant Halo 90 9W LED downlight', price: 19.5, category: 'downlight' },
]
const ASSEMBLIES = [
  { id: '8b5f7b97-367a-431f-8838-0aca658cf21e', name: 'Install LED downlight (new install, single-storey)', price: 35.0, category: 'downlight' },
]

console.log('--- 1. enum membership of the prod category values ---')
for (const v of ['sundries', 'sundry', 'ceiling_fan', 'fan', 'safety_switch', 'rcbo', 'hws_gas']) {
  console.log(`  isCategory(${JSON.stringify(v)}) = ${isCategory(v)}`)
}

console.log('\n--- 2. categorise() on the two sides ---')
console.log('  LINE "Cable, terminals, clips"      ->', [...categorise('Cable, terminals, clips')])
console.log('  ROW  "TPS cable 2.5mm² per metre"   ->', [...categorise('TPS cable 2.5mm² per metre')])
console.log('  ROW  "Sundries (terminals, wire, clips)" ->', [...categorise('Sundries (terminals, wire, clips)')])

console.log('\n--- 3. candidate variants built for the TPS cable row (markup 28%) ---')
const candidates = buildCandidatePrices(MATERIALS, ASSEMBLIES, book)
console.log(
  '  ',
  candidates.material
    .filter((c) => c.sourceName.startsWith('TPS'))
    .map((c) => `$${c.price} [${[...c.categories].join(',')}]`)
    .join('  '),
)

// The prod draft shape: tier "good", line 1 = the failing line, plus enough
// labour that the min-labour floor is satisfied (prod trace shows it was).
const mkDraft = (source: string) => ({
  needs_inspection: false,
  good: {
    label: 'Good',
    subtotal_ex_gst: 0,
    line_items: [
      { description: 'Labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, total_ex_gst: 220, source: 'labour' },
      { description: 'Cable, terminals, clips', quantity: 1, unit: 'each', unit_price_ex_gst: 6.4, total_ex_gst: 6.4, source },
    ],
  },
})

console.log('\n--- 4. REPRODUCTION: source has no typed UUID ref (loose path) ---')
const r1 = validateQuoteGrounding(mkDraft('material'), book, candidates)
console.log('  valid =', r1.valid)
if (!r1.valid) for (const f of r1.failures) console.log('  FAIL:', f.description, '$' + f.unit_price_ex_gst, '->', f.expected)

console.log('\n--- 5. COUNTERFACTUAL A: same line, typed UUID ref (strict path) ---')
const r2 = validateQuoteGrounding(
  mkDraft('material:7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250'),
  book,
  candidates,
)
console.log('  valid =', r2.valid, r2.valid ? '<-- strict path skips the category check entirely' : JSON.stringify(r2.failures))

console.log('\n--- 6. COUNTERFACTUAL B: loose path, but the row category spelled "sundry" ---')
const fixed = buildCandidatePrices(
  MATERIALS.map((m) => ({ ...m, category: m.category === 'sundries' ? 'sundry' : m.category })),
  ASSEMBLIES,
  book,
)
const r3 = validateQuoteGrounding(mkDraft('material'), book, fixed)
console.log('  valid =', r3.valid, r3.valid ? '<-- one-word enum fix makes the SAME draft ground' : JSON.stringify(r3.failures))

console.log('\n--- 7. ASYMMETRY: general-LINE vs sundry-ROW is allowed, the mirror is not ---')
const generalLine = {
  needs_inspection: false,
  good: {
    line_items: [
      { description: 'Labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, total_ex_gst: 220, source: 'labour' },
      // description categorises as [general]; row "Sundries (...)" is [sundry]
      { description: 'Miscellaneous bits', quantity: 1, unit: 'each', unit_price_ex_gst: 64, total_ex_gst: 64, source: 'material' },
    ],
  },
}
console.log('  general LINE + sundry ROW  ->', validateQuoteGrounding(generalLine as any, book, candidates).valid)
console.log('  sundry  LINE + general ROW ->', r1.valid, '(this is the prod case)')
