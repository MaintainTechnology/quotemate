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
