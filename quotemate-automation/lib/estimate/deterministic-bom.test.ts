// Phase 2 regression coverage — the deterministic BOM tier builder.
// Proves "same recipe + catalogue = identical good/better/best every
// time, at the operator's marked-up price", AND every safe-failure
// (no recipe / no rate / unpriceable required part → null, caller
// falls back to Opus). Pure logic, fully provable before it touches
// the live money path (which only runs behind DETERMINISTIC_BOM=1).

import { describe, expect, it } from 'vitest'
import { buildDeterministicTiers, type DeterministicTierInput } from './deterministic-bom'
import type { TenantMaterial, SharedMaterial, BomLine } from './catalogue'

// Three downlight products, one per tier (range/series drives the tier
// via resolveTierForBrandRange: 2000→good, Iconic→better, Signature→best).
const DL_CATALOGUE: TenantMaterial[] = [
  { category: 'downlight', name: 'Standard DL', brand: 'Acme', range_series: '2000', unit_price_ex_gst: 10, active: true },
  { category: 'downlight', name: 'Iconic DL', brand: 'Acme', range_series: 'Iconic', unit_price_ex_gst: 20, active: true },
  { category: 'downlight', name: 'Elite DL', brand: 'Acme', range_series: 'Signature', unit_price_ex_gst: 30, active: true },
]
const SHARED: SharedMaterial[] = [
  { name: 'Generic sundry', category: 'sundry', default_unit_price_ex_gst: 4 },
]
const BOM: BomLine[] = [
  { material_category: 'downlight', quantity: 2, required: true },
]

const BASE: DeterministicTierInput = {
  bom: BOM,
  tenantMaterials: DL_CATALOGUE,
  sharedMaterials: SHARED,
  labourHours: 1.5,
  hourlyRate: 110,
  markupPct: 25,
}

function matLine(t: { line_items: any[] }) {
  return t.line_items.find((l) => l.source === 'material')
}
function labourLine(t: { line_items: any[] }) {
  return t.line_items.find((l) => l.source === 'labour')
}

describe('buildDeterministicTiers — happy path', () => {
  it('builds all three tiers with the tier-appropriate product', () => {
    const r = buildDeterministicTiers(BASE)
    expect(r.tiers).not.toBeNull()
    const t = r.tiers!
    expect(matLine(t.good).description).toBe('Standard DL')
    expect(matLine(t.better).description).toBe('Iconic DL')
    expect(matLine(t.best).description).toBe('Elite DL')
  })

  it('marks the catalogue price up at the configured pct (validator band)', () => {
    const r = buildDeterministicTiers(BASE)
    const t = r.tiers!
    // good: 10 × (1+25/100) = 12.5; qty 2 → total 25
    expect(matLine(t.good).unit_price_ex_gst).toBeCloseTo(12.5, 5)
    expect(matLine(t.good).total_ex_gst).toBeCloseTo(25, 5)
    // best: 30 × 1.25 = 37.5; qty 2 → 75
    expect(matLine(t.best).unit_price_ex_gst).toBeCloseTo(37.5, 5)
    expect(matLine(t.best).total_ex_gst).toBeCloseTo(75, 5)
  })

  it('adds ONE labour line at hourly_rate and a consistent subtotal', () => {
    const r = buildDeterministicTiers(BASE)
    const t = r.tiers!
    const lab = labourLine(t.good)
    expect(lab.unit).toBe('hr')
    expect(lab.quantity).toBeCloseTo(1.5, 5)
    expect(lab.unit_price_ex_gst).toBeCloseTo(110, 5)
    expect(lab.total_ex_gst).toBeCloseTo(165, 5)
    // subtotal good = 25 (material) + 165 (labour)
    expect(t.good.subtotal_ex_gst).toBeCloseTo(190, 5)
  })

  it('is deterministic — identical output for identical input', () => {
    expect(buildDeterministicTiers(BASE)).toEqual(buildDeterministicTiers(BASE))
  })
})

describe('buildDeterministicTiers — fallback + safe-failure', () => {
  it('falls back to shared_materials when the catalogue lacks the category', () => {
    const r = buildDeterministicTiers({
      ...BASE,
      bom: [{ material_category: 'sundry', quantity: 1, required: true }],
      tenantMaterials: [], // no catalogue at all
    })
    expect(r.tiers).not.toBeNull()
    expect(matLine(r.tiers!.good).description).toBe('Generic sundry')
  })

  it('returns a typed authority failure when strict recipe pricing has only a shared price', () => {
    const r = buildDeterministicTiers({
      ...BASE,
      bom: [{ material_category: 'sundry', quantity: 1, required: true }],
      tenantMaterials: [],
      requireTenantMaterialAuthority: true,
    })
    expect(r).toMatchObject({
      tiers: null,
      code: 'missing_tenant_recipe_price',
    })
    expect(r.reason).toMatch(/sundry/i)
  })

  it('builds normally in strict mode when an active tenant row prices the category', () => {
    const r = buildDeterministicTiers({
      ...BASE,
      requireTenantMaterialAuthority: true,
    })
    expect(r.tiers).not.toBeNull()
  })

  it('returns null (no recipe) → caller keeps the Opus draft', () => {
    const r = buildDeterministicTiers({ ...BASE, bom: [] })
    expect(r.tiers).toBeNull()
    expect(r.reason).toMatch(/no recipe/i)
  })

  it('returns null when there is no usable hourly_rate', () => {
    expect(buildDeterministicTiers({ ...BASE, hourlyRate: 0 }).tiers).toBeNull()
    expect(buildDeterministicTiers({ ...BASE, hourlyRate: NaN }).tiers).toBeNull()
  })

  it('returns null + names the unpriceable REQUIRED category (never a hole)', () => {
    const r = buildDeterministicTiers({
      ...BASE,
      bom: [{ material_category: 'unobtanium', quantity: 1, required: true }],
      tenantMaterials: [],
      sharedMaterials: [],
    })
    expect(r.tiers).toBeNull()
    expect(r.reason).toMatch(/unobtanium/)
  })

  it('skips an OPTIONAL unpriceable line and still builds', () => {
    const r = buildDeterministicTiers({
      ...BASE,
      bom: [
        { material_category: 'downlight', quantity: 2, required: true },
        { material_category: 'unobtanium', quantity: 1, required: false },
      ],
    })
    expect(r.tiers).not.toBeNull()
    // only the downlight material + labour — the optional missing part is dropped
    expect(r.tiers!.good.line_items.filter((l) => l.source === 'material')).toHaveLength(1)
  })

  it('treats a zero/blank markup as no markup (raw catalogue price)', () => {
    const r = buildDeterministicTiers({ ...BASE, markupPct: 0 })
    expect(matLine(r.tiers!.good).unit_price_ex_gst).toBeCloseTo(10, 5)
  })
})

describe('Rank 1 authority path', () => {
  const strictInput = (): DeterministicTierInput => ({
    ...BASE,
    tenantMaterials: DL_CATALOGUE.map((row, index) => ({ ...row, id: `product-${index}` })),
    authority: {
      tenantId: 'tenant-a', pricingBookVersionId: 'book-1', recipeSourceId: 'tenant-recipe-1',
      approvedCatalogueIds: ['product-0', 'product-1', 'product-2'], gstRegistered: true,
      serviceMode: 'supply_and_install', minLabourHours: 2,
    },
  })

  it('returns exact cents and approved source provenance in every tier, including the labour minimum', () => {
    const result = buildDeterministicTiers(strictInput())
    expect(result.tiers).not.toBeNull()
    expect(result.tiers!.good.subtotal_ex_gst).toBe(245)
    expect(result.tiers!.good.calculation).toMatchObject({
      version: 'quote-core-v1', tenantId: 'tenant-a', pricingBookVersionId: 'book-1', recipeSourceId: 'tenant-recipe-1',
      subtotalExGstCents: 24500, gstCents: 2450, totalIncGstCents: 26950,
      labourPolicy: { recipeHours: '1.5', minimumHours: '2', billableHours: '2' },
      lines: [{ sourceId: 'product-0', sourceUnitPriceCents: 1000, unitPriceCents: 1250, totalExGstCents: 2500 },
        { sourceId: 'pricing_book:book-1:hourly_rate', quantity: '2', unitPriceCents: 11000, totalExGstCents: 22000 }],
    })
    for (const tier of ['good', 'better', 'best'] as const) {
      const calculation = result.tiers![tier].calculation!
      expect(calculation.subtotalExGstCents).toBe(calculation.lines.reduce((sum, line) => sum + line.totalExGstCents, 0))
    }
  })

  it('computes a half-cent markup exactly rather than preserving the composer float total', () => {
    const input = strictInput()
    input.markupPct = 0.5
    input.tenantMaterials.forEach((row) => { row.unit_price_ex_gst = '1.00' })
    const result = buildDeterministicTiers(input)
    expect(matLine(result.tiers!.good)).toMatchObject({ unit_price_ex_gst: 1.01, total_ex_gst: 2.02 })
  })

  it('rejects a missing approved catalogue price even when a shared fallback exists', () => {
    const input = strictInput()
    input.bom = [{ material_category: 'sundry', quantity: 1, required: true }]
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'missing_price' })
  })

  it('refuses ambiguous same-tier products rather than choosing source row order', () => {
    const input = strictInput()
    input.tenantMaterials.push({ ...input.tenantMaterials[0], id: 'duplicate-choice' })
    input.authority!.approvedCatalogueIds.push('duplicate-choice')
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'ambiguous_source' })
    input.tierLadder = [{ category: 'downlight', tier: 'good', catalogue_id: 'product-0' }]
    expect(buildDeterministicTiers(input).tiers).not.toBeNull()
  })

  it('does not silently replace missing, inactive, unapproved or wrong-category pinned products', () => {
    for (const mutation of ['missing', 'inactive', 'unapproved', 'wrong-category']) {
      const input = strictInput()
      input.chosenProduct = { category: 'downlight', tier: 'good', catalogue_id: mutation === 'missing' ? 'absent' : 'product-0' }
      if (mutation === 'inactive') input.tenantMaterials[0].active = false
      if (mutation === 'unapproved') input.authority!.approvedCatalogueIds = ['product-1', 'product-2']
      if (mutation === 'wrong-category') input.tenantMaterials[0].category = 'switch'
      expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'unapproved_source' })
    }
  })

  it('rejects conflicting tier pins and duplicate product IDs', () => {
    const input = strictInput()
    input.tierLadder = [{ category: 'downlight', tier: 'good', catalogue_id: 'product-0' },
      { category: 'downlight', tier: 'good', catalogue_id: 'product-1' }]
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'ambiguous_source' })
    input.tierLadder = []
    input.tenantMaterials.push({ ...input.tenantMaterials[0] })
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'ambiguous_source' })
  })

  it.each(['supply_only', 'install_only'] as const)('holds %s until recipe component roles exist', (serviceMode) => {
    const input = strictInput(); input.authority!.serviceMode = serviceMode
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'unsupported_service_mode' })
  })

  it('rejects missing tenant/book authority and malformed or absent labour policy', () => {
    const input = strictInput(); input.authority!.pricingBookVersionId = ''
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'missing_authority' })
    for (const value of ['', '-1', '0x10', '0.12345678901234567890']) {
      const invalid = strictInput(); invalid.authority!.minLabourHours = value
      expect(buildDeterministicTiers(invalid)).toMatchObject({ tiers: null, code: 'invalid_quantity' })
    }
  })

  it('refuses float artefacts from upstream quantity scaling and duplicate approved IDs', () => {
    const input = strictInput()
    input.bom = [{ material_category: 'downlight', quantity: 0.1 * 3, required: true }]
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'invalid_quantity' })
    input.bom[0].quantity = '0.125'
    expect(buildDeterministicTiers(input).tiers).not.toBeNull()
    input.authority!.approvedCatalogueIds.push('product-0')
    expect(buildDeterministicTiers(input)).toMatchObject({ tiers: null, code: 'ambiguous_source' })
  })
})
