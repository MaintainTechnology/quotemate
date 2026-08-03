// Phase 4 R3 + R5 — the customer's pick anchors ONE tier, and the quote
// keeps all three.
//
// THE HALF OF THE BRIEF THAT WAS NEVER BUILT. Before this, a pick did two
// things and neither was what the feature promised:
//   1. applyChosenProduct rewrote the headline line of ALL THREE tiers
//      after the draft was built, so every tier held the same product at
//      the same price with the same label; and
//   2. run.ts then collapsed the quote to a single option to hide that.
// The pick could relabel one line. It could never change which PARTS a job
// needed, and the customer lost their choice of three in the process.
//
// R3 anchors the pick INSIDE the deterministic builder: the chosen product
// occupies the tier the customer saw it in, and the other two tiers resolve
// their own product for the category. R5 then stops collapsing, because
// three genuinely different tiers are worth showing.
//
// FOUR DECISIONS THIS ENCODES, each of which could reasonably have gone the
// other way, recorded here so they are choices rather than accidents:
//
//   1. THE PICK BEATS THE TRADIE'S TIER LADDER, for the picked tier only.
//      The two options were generated FROM this tradie's catalogue, so the
//      tradie already sanctioned every product on offer, and a pick that
//      visibly changes nothing is worse than not offering the pick. The
//      ladder still governs the two tiers the customer did not pick.
//   2. selected_tier IS STILL SET. quote_tier_mode defaults to 'single', so
//      a default tenant shows exactly one tier. Dropping selected_tier
//      would fall through to `better → good → best` and show a customer who
//      picked the cheap option the dearer tier — a silent price rise.
//   3. THE OPUS FALLBACK PATH KEEPS COLLAPSING. R3 only runs when the
//      deterministic builder produced the tiers. On the fallback,
//      applyChosenProduct still writes all three identically.
//   4. NO TIER ON THE PICK → NO ANCHOR. Intake rows written before the tier
//      was propagated cannot say which bucket the customer saw, and
//      guessing could anchor a product in a tier they never looked at.

import { describe, it, expect } from 'vitest'
import { buildDeterministicTiers, type DeterministicTierInput } from './deterministic-bom'
import { chooseMaterial } from './catalogue'
import type { TenantMaterial, SharedMaterial, BomLine } from './catalogue'
import { chosenProductFromChoice } from '../sms/product-options'

const CATALOGUE: TenantMaterial[] = [
  { id: 'dl-cheap', category: 'downlight', name: 'Budget DL', brand: 'Acme', range_series: '2000',      unit_price_ex_gst: 10, active: true },
  { id: 'dl-mid',   category: 'downlight', name: 'Iconic DL', brand: 'Acme', range_series: 'Iconic',    unit_price_ex_gst: 20, active: true },
  { id: 'dl-dear',  category: 'downlight', name: 'Elite DL',  brand: 'Acme', range_series: 'Signature', unit_price_ex_gst: 30, active: true },
  { id: 'dl-picked',category: 'downlight', name: 'SAL Anova', brand: 'SAL',  range_series: 'Anova',     unit_price_ex_gst: 25, active: true },
  { id: 'sw-1',     category: 'safety_switch', name: 'RCBO 20A', brand: 'Acme', unit_price_ex_gst: 40, active: true },
]
const SHARED: SharedMaterial[] = [
  { name: 'Generic sundry', category: 'sundry', default_unit_price_ex_gst: 4 },
]
const BOM: BomLine[] = [
  { material_category: 'downlight', quantity: 2, required: true },
  { material_category: 'safety_switch', quantity: 1, required: true },
]
const BASE: DeterministicTierInput = {
  bom: BOM,
  tenantMaterials: CATALOGUE,
  sharedMaterials: SHARED,
  labourHours: 1.5,
  hourlyRate: 110,
  markupPct: 25,
}
const PICK = { catalogue_id: 'dl-picked', category: 'downlight', tier: 'better' as const }

type Line = { source: string; description: string; unit_price_ex_gst: number }
const named = (t: { line_items: Line[] }, name: string) =>
  t.line_items.find((l) => l.description === name)
const downlight = (t: { line_items: Line[] }) =>
  t.line_items.find((l) => l.source === 'material' && /DL|Anova/.test(l.description))

describe('R3 — the pick occupies its own tier', () => {
  it('the chosen product lands in the tier the customer saw it in', () => {
    const t = buildDeterministicTiers({ ...BASE, chosenProduct: PICK }).tiers!
    expect(downlight(t.better)?.description).toBe('SAL Anova')
  })

  it('the other tiers resolve their OWN product — this is the whole point', () => {
    const t = buildDeterministicTiers({ ...BASE, chosenProduct: PICK }).tiers!
    expect(downlight(t.good)?.description).toBe('Budget DL')
    expect(downlight(t.best)?.description).toBe('Elite DL')
  })

  it('all three tiers hold three DIFFERENT products', () => {
    const t = buildDeterministicTiers({ ...BASE, chosenProduct: PICK }).tiers!
    const names = [t.good, t.better, t.best].map((x) => downlight(x)?.description)
    expect(new Set(names).size, `collapsed: ${names.join(' / ')}`).toBe(3)
  })

  it('prices the picked product at ITS price, marked up', () => {
    // 25 × 1.25 = 31.25. Reading 25.00 means the markup was skipped;
    // reading 20.00 means the anchor did nothing.
    const t = buildDeterministicTiers({ ...BASE, chosenProduct: PICK }).tiers!
    expect(downlight(t.better)?.unit_price_ex_gst).toBeCloseTo(31.25, 5)
  })

  it('does NOT touch a different category — a downlight pick is not a safety switch', () => {
    const t = buildDeterministicTiers({ ...BASE, chosenProduct: PICK }).tiers!
    for (const tier of [t.good, t.better, t.best]) {
      expect(named(tier, 'RCBO 20A')).toBeTruthy()
    }
  })

  it('no pick at all leaves today’s behaviour untouched', () => {
    expect(buildDeterministicTiers({ ...BASE, chosenProduct: null }))
      .toEqual(buildDeterministicTiers(BASE))
  })

  it('a pick naming a product this tenant does not stock falls through, never throws', () => {
    const t = buildDeterministicTiers({
      ...BASE,
      chosenProduct: { ...PICK, catalogue_id: 'not-in-catalogue' },
    }).tiers!
    expect(downlight(t.better)?.description).toBe('Iconic DL')
  })

  it('is deterministic — same pick twice, same quote', () => {
    expect(buildDeterministicTiers({ ...BASE, chosenProduct: PICK }))
      .toEqual(buildDeterministicTiers({ ...BASE, chosenProduct: PICK }))
  })

  it('honours a pick the tradie has since deactivated', () => {
    // Unlike the ladder branch, no `active` check. The customer was SHOWN
    // this product and chose it; a tradie deactivating it between the offer
    // and the quote must not silently swap what they are buying.
    const t = buildDeterministicTiers({
      ...BASE,
      tenantMaterials: CATALOGUE.map((r) =>
        r.id === 'dl-picked' ? { ...r, active: false } : r,
      ),
      chosenProduct: PICK,
    }).tiers!
    expect(downlight(t.better)?.description).toBe('SAL Anova')
  })
})

describe('R3 — precedence against the tradie’s tier ladder', () => {
  const LADDER = [{ category: 'downlight', tier: 'better' as const, catalogue_id: 'dl-dear' }]

  it('DECISION: the customer’s pick beats the ladder for the picked tier', () => {
    const t = buildDeterministicTiers({ ...BASE, chosenProduct: PICK, tierLadder: LADDER }).tiers!
    expect(downlight(t.better)?.description).toBe('SAL Anova')
  })

  it('the ladder still governs a tier the customer did NOT pick', () => {
    const t = buildDeterministicTiers({
      ...BASE,
      chosenProduct: PICK,
      tierLadder: [{ category: 'downlight', tier: 'good', catalogue_id: 'dl-dear' }],
    }).tiers!
    expect(downlight(t.good)?.description).toBe('Elite DL')
    expect(downlight(t.better)?.description).toBe('SAL Anova')
  })

  it('a ladder pin in another CATEGORY is unaffected by the pick', () => {
    const t = buildDeterministicTiers({
      ...BASE,
      chosenProduct: PICK,
      tierLadder: [{ category: 'safety_switch', tier: 'better', catalogue_id: 'sw-1' }],
    }).tiers!
    expect(named(t.better, 'RCBO 20A')).toBeTruthy()
  })
})

describe('R3 — chooseMaterial scoping, directly', () => {
  const call = (tier: 'good' | 'better' | 'best') =>
    chooseMaterial({
      tenantRows: CATALOGUE,
      sharedRows: SHARED,
      category: 'downlight',
      tier,
      chosenProduct: PICK,
    })

  it('anchors only the matching tier', () => {
    expect(call('better')?.row.name).toBe('SAL Anova')
    expect(call('good')?.row.name).not.toBe('SAL Anova')
    expect(call('best')?.row.name).not.toBe('SAL Anova')
  })

  it('ignores a pick whose category is not the one being resolved', () => {
    const r = chooseMaterial({
      tenantRows: CATALOGUE,
      sharedRows: SHARED,
      category: 'safety_switch',
      tier: 'better',
      chosenProduct: PICK,
    })
    expect(r?.row.name).toBe('RCBO 20A')
  })
})

describe('R3 — the tier survives the trip from the SMS offer', () => {
  // The tier existed on ProductOption all along and was computed, then
  // dropped by chosenProductFromChoice. Without it there is nothing to
  // anchor ON, so this is the load-bearing link in the whole feature.
  const choice = {
    status: 'chosen' as const,
    category: 'downlight',
    trade: 'electrical',
    token: 'tok-r3-test',
    chosen_catalogue_id: 'dl-picked',
    options: [
      { catalogue_id: 'dl-cheap',  name: 'Budget DL', brand: null, range_series: null, price_ex_gst: 10, image_path: null, description: null, tier: 'good' as const },
      { catalogue_id: 'dl-picked', name: 'SAL Anova', brand: null, range_series: null, price_ex_gst: 25, image_path: null, description: null, tier: 'better' as const },
    ],
  }

  it('carries the picked tier through to the intake', () => {
    expect(chosenProductFromChoice(choice)?.tier).toBe('better')
  })

  it('carries "good" when that is what they picked', () => {
    expect(
      chosenProductFromChoice({ ...choice, chosen_catalogue_id: 'dl-cheap' })?.tier,
    ).toBe('good')
  })

  it('is null when the option carries no tier — legacy rows get no anchor', () => {
    const legacy = {
      ...choice,
      options: [{ ...choice.options[1], tier: undefined as unknown as 'good' }],
    }
    expect(chosenProductFromChoice(legacy)?.tier).toBeNull()
  })
})
