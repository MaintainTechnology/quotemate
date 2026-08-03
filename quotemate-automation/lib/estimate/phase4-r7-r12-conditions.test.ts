// Phase 4 R7 / R8 / R9 / R11 / R12 — a recipe reshapes itself around the
// product that actually landed on the tier.
//
// Up to here a recipe was a fixed list: same parts, same quantities, whatever
// product got resolved. These four items make it conditional:
//
//   R7  include_when  — drop or keep a line based on the RESOLVED product's
//                       attributes (migrations 185/186)
//   R8  quantity_per  — a ratio line, one driver per four lights
//   R11 catalogue_id  — pin a line to one exact product
//   R12 precedence    — customer pick > tier ladder > recipe pin > scoring
//                       > shared fallback
//   R9  the two acceptance scenarios built from R7
//
// THE UNKNOWN-ATTRIBUTE RULE is the part worth reading. It differs by
// `required` and that asymmetry is deliberate — see shouldIncludeLine. A
// required line survives an unknown attribute (never put a hole in a quote
// because a tradie did not tag a product); an optional one does not (never
// bill for an upsell nobody established was needed).

import { describe, it, expect } from 'vitest'
import {
  buildBomQuoteLines,
  scaleBomToItemCount,
  shouldIncludeLine,
  chooseMaterial,
  type BomLine,
  type TenantMaterial,
  type SharedMaterial,
} from './catalogue'
import { buildDeterministicTiers, type DeterministicTierInput } from './deterministic-bom'

// ── R7: the condition itself ────────────────────────────────────────────

describe('R7 — shouldIncludeLine', () => {
  it('no condition means always include', () => {
    expect(shouldIncludeLine(null, null, true)).toBe(true)
    expect(shouldIncludeLine(undefined, { smart: true }, false)).toBe(true)
    expect(shouldIncludeLine({}, null, false)).toBe(true)
  })

  it('a matching attribute includes', () => {
    expect(shouldIncludeLine({ smart: true }, { smart: true }, false)).toBe(true)
  })

  it('a mismatching attribute excludes, required or not', () => {
    expect(shouldIncludeLine({ smart: true }, { smart: false }, false)).toBe(false)
    // A KNOWN mismatch on a required line is not a hole — it is the condition
    // working. An integrated-driver downlight genuinely needs no driver.
    expect(shouldIncludeLine({ integrated_driver: false }, { integrated_driver: true }, true)).toBe(false)
  })

  it('UNKNOWN attribute: a required line stays', () => {
    // The spec's "include-on-unknown so a missing attribute never drops a
    // required part".
    expect(shouldIncludeLine({ smart: true }, {}, true)).toBe(true)
    expect(shouldIncludeLine({ smart: true }, null, true)).toBe(true)
    expect(shouldIncludeLine({ smart: true }, { smart: null }, true)).toBe(true)
  })

  it('UNKNOWN attribute: an optional line goes', () => {
    // Optional lines are upsells. Adding one on a guess bills a customer for
    // something nobody established they need.
    expect(shouldIncludeLine({ smart: true }, {}, false)).toBe(false)
    expect(shouldIncludeLine({ smart: true }, { smart: '' }, false)).toBe(false)
  })

  it('tolerates the shapes a real jsonb catalogue holds', () => {
    // properties is filled from CSV imports, so "true"/1/"yes" all turn up
    // for the same tag. A strict === would fail every condition in the wild.
    for (const v of [true, 'true', 'TRUE', 1, 'yes', 'Y']) {
      expect(shouldIncludeLine({ smart: true }, { smart: v }, false), String(v)).toBe(true)
    }
    for (const v of [false, 'false', 0, 'no', 'N']) {
      expect(shouldIncludeLine({ smart: false }, { smart: v }, false), String(v)).toBe(true)
    }
  })

  it('every key must hold, not just one', () => {
    expect(shouldIncludeLine({ smart: true, dimmable: true }, { smart: true, dimmable: false }, false)).toBe(false)
    expect(shouldIncludeLine({ smart: true, dimmable: true }, { smart: true, dimmable: true }, false)).toBe(true)
  })

  it('a malformed condition includes rather than silently dropping', () => {
    expect(shouldIncludeLine([1, 2] as never, {}, true)).toBe(true)
    expect(shouldIncludeLine('smart' as never, {}, true)).toBe(true)
  })
})

// ── R8: ratios ──────────────────────────────────────────────────────────

describe('R8 — quantity_per', () => {
  const RECIPE = [
    { material_category: 'downlight', quantity: 6, sort: 1 },
    { material_category: 'driver', quantity: 1, sort: 2, quantity_per: 4 },
  ]

  it('the spec case: quantity_per 4 with item_count 10 gives 3, not 10', () => {
    const out = scaleBomToItemCount(RECIPE, 10)
    expect(out.find((r) => r.material_category === 'driver')?.quantity).toBe(3)
  })

  it('ceil, not round — 10/4 is 2.5 and two drivers leaves the job short', () => {
    expect(scaleBomToItemCount(RECIPE, 9).find((r) => r.material_category === 'driver')?.quantity).toBe(3)
    expect(scaleBomToItemCount(RECIPE, 8).find((r) => r.material_category === 'driver')?.quantity).toBe(2)
    expect(scaleBomToItemCount(RECIPE, 1).find((r) => r.material_category === 'driver')?.quantity).toBe(1)
  })

  it('the headline still takes item_count outright', () => {
    expect(scaleBomToItemCount(RECIPE, 10).find((r) => r.material_category === 'downlight')?.quantity).toBe(10)
  })

  it('a ratio line is never mistaken for the headline', () => {
    // Ratio-first ordering must not let the driver absorb item_count.
    const flipped = [
      { material_category: 'driver', quantity: 1, sort: 1, quantity_per: 4 },
      { material_category: 'downlight', quantity: 6, sort: 2 },
    ]
    const out = scaleBomToItemCount(flipped, 10)
    expect(out.find((r) => r.material_category === 'driver')?.quantity).toBe(3)
    expect(out.find((r) => r.material_category === 'downlight')?.quantity).toBe(10)
  })

  it('no item_count leaves ratio lines alone', () => {
    expect(scaleBomToItemCount(RECIPE, null).find((r) => r.material_category === 'driver')?.quantity).toBe(1)
  })

  it('a nonsense ratio is ignored rather than written onto a quote', () => {
    // Needs a real headline alongside it: with the driver as the ONLY
    // non-sundry line it legitimately becomes the headline and takes
    // item_count, which is correct pre-existing behaviour, not a ratio bug.
    for (const per of [0, -2, Number.NaN, null]) {
      const rows = [
        { material_category: 'downlight', quantity: 6, sort: 1 },
        { material_category: 'driver', quantity: 1, sort: 2, quantity_per: per as number },
      ]
      const out = scaleBomToItemCount(rows, 10)
      expect(out.find((r) => r.material_category === 'driver')?.quantity, String(per)).toBe(1)
      expect(out.find((r) => r.material_category === 'downlight')?.quantity, String(per)).toBe(10)
    }
  })
})

// ── R11 + R12: the pin and its place in the chain ───────────────────────

const CAT: TenantMaterial[] = [
  { id: 'dl-good',   category: 'downlight', name: 'Budget DL', brand: 'A', range_series: '2000',      unit_price_ex_gst: 10, active: true },
  { id: 'dl-better', category: 'downlight', name: 'Iconic DL', brand: 'A', range_series: 'Iconic',    unit_price_ex_gst: 20, active: true },
  { id: 'dl-best',   category: 'downlight', name: 'Elite DL',  brand: 'A', range_series: 'Signature', unit_price_ex_gst: 30, active: true },
  { id: 'dl-pin',    category: 'downlight', name: 'Pinned DL', brand: 'B', unit_price_ex_gst: 25, active: true },
]
const SHARED: SharedMaterial[] = [{ name: 'Generic', category: 'downlight', default_unit_price_ex_gst: 4 }]

describe('R11 — a recipe line pins an exact product', () => {
  const call = (extra: Partial<Parameters<typeof chooseMaterial>[0]> = {}) =>
    chooseMaterial({ tenantRows: CAT, sharedRows: SHARED, category: 'downlight', tier: 'better', ...extra })

  it('the pin wins over brand/range scoring', () => {
    expect(call({ pinnedCatalogueId: 'dl-pin' })?.row.name).toBe('Pinned DL')
  })

  it('no pin leaves scoring untouched', () => {
    expect(call()?.row.name).toBe('Iconic DL')
  })

  it('a deactivated pinned row falls through rather than failing the line', () => {
    const rows = CAT.map((r) => (r.id === 'dl-pin' ? { ...r, active: false } : r))
    expect(chooseMaterial({ tenantRows: rows, sharedRows: SHARED, category: 'downlight', tier: 'better', pinnedCatalogueId: 'dl-pin' })?.row.name).toBe('Iconic DL')
  })
})

describe('R12 — precedence, in the spec order', () => {
  const base = { tenantRows: CAT, sharedRows: SHARED, category: 'downlight', tier: 'better' as const }

  it('the tier ladder BEATS a recipe pin', () => {
    // The stated reason: the ladder is per-tier, the pin is not. A pin above
    // the ladder would put one product on all three tiers.
    const r = chooseMaterial({
      ...base,
      tierLadder: [{ category: 'downlight', tier: 'better', catalogue_id: 'dl-best' }],
      pinnedCatalogueId: 'dl-pin',
    })
    expect(r?.row.name).toBe('Elite DL')
  })

  it('the customer’s pick beats the ladder, which beats the pin', () => {
    const r = chooseMaterial({
      ...base,
      chosenProduct: { catalogue_id: 'dl-good', category: 'downlight', tier: 'better' },
      tierLadder: [{ category: 'downlight', tier: 'better', catalogue_id: 'dl-best' }],
      pinnedCatalogueId: 'dl-pin',
    })
    expect(r?.row.name).toBe('Budget DL')
  })

  it('the pin beats scoring when no ladder covers the tier', () => {
    const r = chooseMaterial({
      ...base,
      tierLadder: [{ category: 'downlight', tier: 'good', catalogue_id: 'dl-best' }],
      pinnedCatalogueId: 'dl-pin',
    })
    expect(r?.row.name).toBe('Pinned DL')
  })
})

// ── R9: the two acceptance scenarios, end to end ────────────────────────

describe('R9 — the recipe reshapes around the product', () => {
  const SMART: TenantMaterial[] = [
    { id: 'dl-plain', category: 'downlight', name: 'Plain DL', unit_price_ex_gst: 10, active: true, properties: { smart: false, integrated_driver: false } },
    { id: 'dl-smart', category: 'downlight', name: 'Smart DL', unit_price_ex_gst: 20, active: true, properties: { smart: true, integrated_driver: false } },
    { id: 'dl-integ', category: 'downlight', name: 'Integrated DL', unit_price_ex_gst: 30, active: true, properties: { smart: false, integrated_driver: true } },
    { id: 'dimmer-1', category: 'dimmer', name: 'Smart dimmer', unit_price_ex_gst: 55, active: true },
    { id: 'driver-1', category: 'driver', name: 'LED driver', unit_price_ex_gst: 35, active: true },
  ]
  const BOM: BomLine[] = [
    { material_category: 'downlight', quantity: 2, required: true },
    // Optional: only when the light is smart. Unknown → not added.
    { material_category: 'dimmer', quantity: 1, required: false, include_when: { smart: true } },
    // Required: dropped only when the light has its driver built in.
    { material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } },
  ]
  const input = (pin: string): DeterministicTierInput => ({
    bom: BOM,
    tenantMaterials: SMART,
    sharedMaterials: [],
    labourHours: 1,
    hourlyRate: 100,
    markupPct: 0,
    chosenProduct: { catalogue_id: pin, category: 'downlight', tier: 'good' },
  })
  const descs = (t: { line_items: Array<{ description: string }> }) => t.line_items.map((l) => l.description)

  it('a SMART product adds its dimmer part', () => {
    const t = buildDeterministicTiers(input('dl-smart')).tiers!
    expect(descs(t.good)).toContain('Smart dimmer')
  })

  it('a plain product does NOT get a dimmer', () => {
    const t = buildDeterministicTiers(input('dl-plain')).tiers!
    expect(descs(t.good)).not.toContain('Smart dimmer')
  })

  it('an INTEGRATED_DRIVER product drops the separate driver line', () => {
    const t = buildDeterministicTiers(input('dl-integ')).tiers!
    expect(descs(t.good)).not.toContain('LED driver')
  })

  it('a plain product KEEPS the driver line', () => {
    const t = buildDeterministicTiers(input('dl-plain')).tiers!
    expect(descs(t.good)).toContain('LED driver')
  })

  it('dropping the driver does NOT route the quote to inspection', () => {
    // The line is `required`, so a naive implementation would report it
    // missing and send a correct quote to the $99 inspection.
    const r = buildDeterministicTiers(input('dl-integ'))
    expect(r.tiers).not.toBeNull()
    expect(r.reason ?? null).toBeNull()
  })

  it('an untagged product keeps the required driver and skips the optional dimmer', () => {
    const untagged = SMART.map((r) => (r.id === 'dl-plain' ? { ...r, properties: null } : r))
    const t = buildDeterministicTiers({ ...input('dl-plain'), tenantMaterials: untagged }).tiers!
    expect(descs(t.good)).toContain('LED driver')
    expect(descs(t.good)).not.toContain('Smart dimmer')
  })

  it('is deterministic — same product twice, same parts', () => {
    expect(buildDeterministicTiers(input('dl-smart'))).toEqual(buildDeterministicTiers(input('dl-smart')))
  })
})

describe('R7 — an excluded line is not a missing part', () => {
  it('buildBomQuoteLines reports no missingRequired for a satisfied condition', () => {
    const { lines, missingRequired } = buildBomQuoteLines({
      bom: [
        // The headline. Conditions are judged against THIS product.
        { material_category: 'downlight', quantity: 2, required: true },
        { material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } },
      ],
      resolveMaterial: (l) =>
        l.material_category === 'downlight'
          ? { name: 'Integrated DL', markedUpPrice: 30, properties: { integrated_driver: true } }
          : { name: 'LED driver', markedUpPrice: 35 },
      labourHours: 0,
      labourRate: 0,
    })
    expect(lines.map((l) => l.description)).toEqual(['Integrated DL'])
    expect(missingRequired).toEqual([])
  })

  it('with NO headline to judge against, a required conditional line is kept', () => {
    // Nothing unconditional to measure the condition against, so the
    // unknown rule applies and the required part stays. A hole in the quote
    // would be the worse answer.
    const { lines, missingRequired } = buildBomQuoteLines({
      bom: [{ material_category: 'driver', quantity: 1, required: true, include_when: { integrated_driver: false } }],
      resolveMaterial: () => ({ name: 'LED driver', markedUpPrice: 35 }),
      labourHours: 0,
      labourRate: 0,
    })
    expect(lines.map((l) => l.description)).toEqual(['LED driver'])
    expect(missingRequired).toEqual([])
  })

  it('but an UNPRICEABLE required line is still missing', () => {
    const { missingRequired } = buildBomQuoteLines({
      bom: [{ material_category: 'driver', quantity: 1, required: true }],
      resolveMaterial: () => null,
      labourHours: 0,
      labourRate: 0,
    })
    expect(missingRequired).toEqual(['driver'])
  })
})
