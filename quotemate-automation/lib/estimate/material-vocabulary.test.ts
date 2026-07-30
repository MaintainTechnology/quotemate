// Phase 2 R1/R3 — the material vocabulary a recipe line may name.
//
// The bug this pins: the Recipes "Material category" select is fed from
// CATEGORIES (the coarse GROUNDING vocabulary), but
// shared_assembly_bom.material_category must equal a shared_materials.category
// string exactly — migration 130's column comment says so. 23 of the 27
// dropdown options match no product, and three are near-miss synonyms a tradie
// would reasonably trust: fan→ceiling_fan, rcbo→safety_switch, sundry→sundries.
//
// Values verified read-only against the live DB on 2026-07-30:
//   electrical: ceiling_fan, downlight, gpo, outdoor_light, safety_switch,
//               smoke_alarm, sundries
//   plumbing:   hws_electric, hws_gas, hws_heat_pump, sundries, tapware_basin,
//               tapware_kitchen, tapware_laundry, tapware_outdoor, toilet,
//               toilet_repair
// The LIVE_DB test in live-material-vocabulary.test.ts re-checks that against
// the database so this list and the data cannot drift apart.

import { describe, it, expect } from 'vitest'
import { MATERIAL_VOCABULARY, materialCategoriesFor } from './material-vocabulary'
import { CATEGORIES } from './categories'
import { TenantBomLineSchema } from '@/lib/tenant/update-schema'

describe('Phase 2 R1 — the electrical material vocabulary', () => {
  it('is exactly the seven real shared_materials.category values', () => {
    expect(materialCategoriesFor('electrical').map((c) => c.value).sort()).toEqual([
      'ceiling_fan',
      'downlight',
      'gpo',
      'outdoor_light',
      'safety_switch',
      'smoke_alarm',
      'sundries',
    ])
  })

  it('EXCLUDES the three near-miss synonyms that make a line unpriceable', () => {
    const vals = materialCategoriesFor('electrical').map((c) => c.value)
    expect(vals).not.toContain('fan') // real value is ceiling_fan
    expect(vals).not.toContain('rcbo') // real value is safety_switch
    expect(vals).not.toContain('sundry') // real value is sundries
  })

  it('excludes the grounding-only values that have no material at all', () => {
    const vals = materialCategoriesFor('electrical').map((c) => c.value)
    for (const dead of [
      'switchboard',
      'oven_cooktop',
      'ev_charger',
      'fault_find',
      'strip_light',
      'security_camera',
      'doorbell_intercom',
      'general',
    ]) {
      expect(vals, `${dead} has no shared_materials row`).not.toContain(dead)
    }
  })

  it('leaks no plumbing value onto the electrical list', () => {
    const vals = materialCategoriesFor('electrical').map((c) => c.value)
    for (const p of materialCategoriesFor('plumbing').map((c) => c.value)) {
      if (p === 'sundries') continue // legitimately shared by both trades
      expect(vals, `${p} is plumbing`).not.toContain(p)
    }
  })

  it('carries a human label for every value, like CATEGORIES does', () => {
    for (const c of materialCategoriesFor('electrical')) {
      expect(c.label.length, c.value).toBeGreaterThan(0)
      expect(c.label).not.toBe(c.value)
    }
  })
})

describe('Phase 2 R1 — plumbing and the unknown-trade case', () => {
  it('is the ten real plumbing values', () => {
    expect(materialCategoriesFor('plumbing').map((c) => c.value).sort()).toEqual([
      'hws_electric',
      'hws_gas',
      'hws_heat_pump',
      'sundries',
      'tapware_basin',
      'tapware_kitchen',
      'tapware_laundry',
      'tapware_outdoor',
      'toilet',
      'toilet_repair',
    ])
  })

  it('returns EVERY trade’s values when no trade is given (the cross-trade view)', () => {
    // RecipesTab without a tradeFilter is a legacy deep-link view; it must
    // still offer something, and it must still be real vocabulary.
    const all = materialCategoriesFor(undefined).map((c) => c.value)
    expect(all).toContain('downlight')
    expect(all).toContain('toilet')
    expect(new Set(all).size, 'no duplicate across trades').toBe(all.length)
  })

  it('returns nothing for a trade with no material vocabulary', () => {
    // roofing shared_materials rows all have category NULL — there is no
    // vocabulary to offer, and inventing one would be worse than empty.
    expect(materialCategoriesFor('roofing')).toEqual([])
  })
})

describe('Phase 2 R1 — the boundary with CATEGORIES is deliberate', () => {
  it('does NOT replace CATEGORIES — validate.ts still gates every quote on it', () => {
    // Constraint: categories.ts stays untouched. Assert the grounding list is
    // still the old one, so a future edit that "unifies" them fails here.
    const grounding = CATEGORIES.map((c) => c.value)
    expect(grounding).toContain('fan')
    expect(grounding).toContain('rcbo')
    expect(grounding).toContain('sundry')
  })

  it('keeps sundry/sundries un-normalised in BOTH directions (migration 130)', () => {
    // shared_assemblies.category uses `sundry`; shared_materials.category uses
    // `sundries`. The two-vocabulary boundary is intentional — do not "fix" it.
    expect(CATEGORIES.map((c) => c.value)).toContain('sundry')
    expect(materialCategoriesFor('electrical').map((c) => c.value)).toContain('sundries')
    expect(materialCategoriesFor('electrical').map((c) => c.value)).not.toContain('sundry')
  })

  it('exposes the vocabulary keyed by trade for the importer to validate against', () => {
    expect(Object.keys(MATERIAL_VOCABULARY).sort()).toEqual(['electrical', 'plumbing'])
  })
})

describe('Phase 2 R3 — a bad category is rejected at write time', () => {
  const base = {
    assembly_id: '11111111-1111-4111-8111-111111111111',
    trade: 'electrical' as const,
    quantity: 1,
  }

  it('rejects `fan` — the synonym that silently makes the line unpriceable', () => {
    expect(TenantBomLineSchema.safeParse({ ...base, material_category: 'fan' }).success).toBe(false)
  })

  it('accepts `ceiling_fan`', () => {
    const r = TenantBomLineSchema.safeParse({ ...base, material_category: 'ceiling_fan' })
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
  })

  it('rejects rcbo and sundry, accepts safety_switch and sundries', () => {
    expect(TenantBomLineSchema.safeParse({ ...base, material_category: 'rcbo' }).success).toBe(false)
    expect(TenantBomLineSchema.safeParse({ ...base, material_category: 'sundry' }).success).toBe(false)
    expect(TenantBomLineSchema.safeParse({ ...base, material_category: 'safety_switch' }).success).toBe(true)
    expect(TenantBomLineSchema.safeParse({ ...base, material_category: 'sundries' }).success).toBe(true)
  })

  it('rejects a plumbing category on an electrical line', () => {
    expect(TenantBomLineSchema.safeParse({ ...base, material_category: 'toilet' }).success).toBe(false)
  })

  it('accepts a plumbing category on a plumbing line', () => {
    const r = TenantBomLineSchema.safeParse({
      ...base,
      trade: 'plumbing',
      material_category: 'toilet',
    })
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
  })

  it('still trims and lowercases before matching, as chooseMaterial does', () => {
    const r = TenantBomLineSchema.safeParse({ ...base, material_category: '  Ceiling_Fan ' })
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
    if (r.success) expect(r.data.material_category).toBe('ceiling_fan')
  })
})
