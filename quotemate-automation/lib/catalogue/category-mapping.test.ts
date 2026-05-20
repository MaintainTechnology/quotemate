// v7 Phase 2b regression coverage for the material→grounding category
// bridge used by /api/tenant/catalogue/bulk-add when copying
// supplier_catalogue rows into tenant_material_catalogue.

import { describe, expect, it } from 'vitest'
import { granularToGroundingCategory } from './category-mapping'

describe('granularToGroundingCategory', () => {
  it('maps tapware_* family to tap', () => {
    expect(granularToGroundingCategory('tapware_basin')).toBe('tap')
    expect(granularToGroundingCategory('tapware_kitchen')).toBe('tap')
    expect(granularToGroundingCategory('tapware_laundry')).toBe('tap')
    expect(granularToGroundingCategory('tapware_outdoor')).toBe('tap')
  })
  it('maps hws_* family to hot_water', () => {
    expect(granularToGroundingCategory('hws_gas')).toBe('hot_water')
    expect(granularToGroundingCategory('hws_electric')).toBe('hot_water')
    expect(granularToGroundingCategory('hws_heat_pump')).toBe('hot_water')
  })
  it('renames ceiling_fan → fan and safety_switch → rcbo', () => {
    expect(granularToGroundingCategory('ceiling_fan')).toBe('fan')
    expect(granularToGroundingCategory('safety_switch')).toBe('rcbo')
  })
  it('folds plural sundries to singular and sub-categories to parent', () => {
    expect(granularToGroundingCategory('sundries')).toBe('sundry')
    expect(granularToGroundingCategory('toilet_repair')).toBe('toilet')
  })
  it('is idempotent — known grounding values pass through unchanged', () => {
    expect(granularToGroundingCategory('downlight')).toBe('downlight')
    expect(granularToGroundingCategory('gpo')).toBe('gpo')
    expect(granularToGroundingCategory('smoke_alarm')).toBe('smoke_alarm')
    expect(granularToGroundingCategory('toilet')).toBe('toilet')
    expect(granularToGroundingCategory('outdoor_light')).toBe('outdoor_light')
  })
  it('case- and whitespace-insensitive', () => {
    expect(granularToGroundingCategory('  Tapware_Basin  ')).toBe('tap')
    expect(granularToGroundingCategory('HWS_GAS')).toBe('hot_water')
  })
  it('returns null for empty/unknown input', () => {
    expect(granularToGroundingCategory(null)).toBeNull()
    expect(granularToGroundingCategory(undefined)).toBeNull()
    expect(granularToGroundingCategory('')).toBeNull()
    expect(granularToGroundingCategory('   ')).toBeNull()
    expect(granularToGroundingCategory('totally_unknown_category')).toBeNull()
  })
})
