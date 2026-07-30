// The regression Phase 2 R2 introduced, and the guard against it returning.
//
// R2 narrowed BOTH category selects to values that have a shared_materials row.
// That was wrong for the Catalogue select: chooseMaterial resolves the TENANT
// leg on category match ALONE (catalogue.ts:170-173) with no requirement that a
// shared material exists. So before R2 a tradie could price an EV charger or a
// security camera by adding their OWN product in that category — and R2 removed
// those categories from the dropdown, taking the capability with them.
//
// Live evidence it mattered: the pilot tenant already had a `security_camera`
// recipe line and a `cctv` catalogue product. Under R2 they could not recreate
// either.
//
// The real defect was always narrower than the spec claimed: three synonyms
// (fan/rcbo/sundry) and two values that needed splitting (hot_water → hws_*,
// tap → tapware_*). Everything else in CATEGORIES was unstocked-by-default but
// perfectly stockable.

import { describe, it, expect } from 'vitest'
import { CATEGORIES } from './categories'
import { MATERIAL_VOCABULARY, materialCategoriesFor, isMaterialCategory } from './material-vocabulary'

/** The ONLY CATEGORIES values that are genuinely wrong for a material. */
const CORRECTED = {
  fan: 'ceiling_fan',
  rcbo: 'safety_switch',
  sundry: 'sundries',
  hot_water: 'hws_electric | hws_gas | hws_heat_pump',
  tap: 'tapware_basin | tapware_kitchen | tapware_laundry | tapware_outdoor',
}

describe('no category a tradie could previously stock has been removed', () => {
  it('every CATEGORIES value is still offered, except the five corrected ones', () => {
    const offered = new Set(materialCategoriesFor(undefined).map((c) => c.value))
    const lost = CATEGORIES.map((c) => c.value)
      .filter((v) => !(v in CORRECTED))
      .filter((v) => !offered.has(v))
    expect(lost, `capability removed for: ${lost.join(', ')}`).toEqual([])
  })

  it('the five corrected values are absent — they are the actual bug', () => {
    const offered = materialCategoriesFor(undefined).map((c) => c.value)
    for (const [wrong, right] of Object.entries(CORRECTED)) {
      expect(offered, `${wrong} should be ${right}`).not.toContain(wrong)
    }
  })

  it('a tradie can still stock the electrical products R2 locked out', () => {
    for (const c of ['ev_charger', 'security_camera', 'oven_cooktop', 'switchboard',
      'strip_light', 'doorbell_intercom', 'fault_find']) {
      expect(isMaterialCategory(c, 'electrical'), c).toBe(true)
    }
  })

  it('a tradie can still stock the plumbing products R2 locked out', () => {
    for (const c of ['cctv', 'gas', 'prv', 'dishwasher', 'rainwater_tank',
      'water_filter', 'leak_detection', 'shower', 'drain']) {
      expect(isMaterialCategory(c, 'plumbing'), c).toBe(true)
    }
  })
})

describe('the real shared-material values are still all present', () => {
  it('electrical keeps its seven', () => {
    for (const c of ['ceiling_fan', 'downlight', 'gpo', 'outdoor_light',
      'safety_switch', 'smoke_alarm', 'sundries']) {
      expect(isMaterialCategory(c, 'electrical'), c).toBe(true)
    }
  })

  it('plumbing keeps its ten, including the split-out granularity', () => {
    for (const c of ['hws_electric', 'hws_gas', 'hws_heat_pump', 'sundries',
      'tapware_basin', 'tapware_kitchen', 'tapware_laundry', 'tapware_outdoor',
      'toilet', 'toilet_repair']) {
      expect(isMaterialCategory(c, 'plumbing'), c).toBe(true)
    }
  })
})

describe('trade scoping survives the widening', () => {
  it('an electrical hub is not offered plumbing parts', () => {
    const e = materialCategoriesFor('electrical').map((c) => c.value)
    for (const p of ['toilet', 'cctv', 'hws_gas', 'tapware_basin', 'shower']) {
      expect(e, p).not.toContain(p)
    }
  })

  it('a plumbing hub is not offered electrical parts', () => {
    const p = materialCategoriesFor('plumbing').map((c) => c.value)
    for (const e of ['downlight', 'gpo', 'ev_charger', 'switchboard']) {
      expect(p, e).not.toContain(e)
    }
  })

  it('sundries and general stay shared by both trades', () => {
    for (const t of ['electrical', 'plumbing']) {
      expect(isMaterialCategory('sundries', t), `sundries/${t}`).toBe(true)
      expect(isMaterialCategory('general', t), `general/${t}`).toBe(true)
    }
  })

  it('roofing still has no vocabulary', () => {
    expect(materialCategoriesFor('roofing')).toEqual([])
  })

  it('every value carries a label and no trade list has duplicates', () => {
    for (const [trade, opts] of Object.entries(MATERIAL_VOCABULARY)) {
      const vals = opts.map((o) => o.value)
      expect(new Set(vals).size, `${trade} has duplicates`).toBe(vals.length)
      for (const o of opts) expect(o.label.length, `${trade}/${o.value}`).toBeGreaterThan(0)
    }
  })
})
