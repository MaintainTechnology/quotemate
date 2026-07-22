import { describe, expect, it } from 'vitest'
import { tenantHasRoofingTrade, tenantIsRoofingOnly } from './tenant'

describe('tenantHasRoofingTrade', () => {
  it('returns false for null / undefined', () => {
    expect(tenantHasRoofingTrade(null)).toBe(false)
    expect(tenantHasRoofingTrade(undefined)).toBe(false)
  })
  it('returns false for empty array', () => {
    expect(tenantHasRoofingTrade([])).toBe(false)
  })
  it('returns false when only electrical / plumbing are present', () => {
    expect(tenantHasRoofingTrade(['electrical'])).toBe(false)
    expect(tenantHasRoofingTrade(['electrical', 'plumbing'])).toBe(false)
  })
  it('returns true when roofing is listed', () => {
    expect(tenantHasRoofingTrade(['roofing'])).toBe(true)
    expect(tenantHasRoofingTrade(['electrical', 'roofing'])).toBe(true)
  })
  it('matches case-insensitively', () => {
    expect(tenantHasRoofingTrade(['Roofing'])).toBe(true)
    expect(tenantHasRoofingTrade(['ROOFING'])).toBe(true)
  })
  it('tolerates non-string entries in the array', () => {
    expect(tenantHasRoofingTrade([null as unknown as string, 'roofing'])).toBe(true)
    expect(tenantHasRoofingTrade([null as unknown as string])).toBe(false)
  })
})

// Drives whether the SMS roofing receptionist may engage WITHOUT a roofing
// keyword: a tenant with no second trade has nothing to route to.
describe('tenantIsRoofingOnly', () => {
  it('is true only when roofing is the sole trade', () => {
    expect(tenantIsRoofingOnly(['roofing'])).toBe(true)
    expect(tenantIsRoofingOnly(['Roofing'])).toBe(true)
    expect(tenantIsRoofingOnly([' roofing '])).toBe(true)
    expect(tenantIsRoofingOnly(['roofing', 'roofing'])).toBe(true)
  })
  it('is false for a cross-trade tenant — routing between trades still matters', () => {
    expect(tenantIsRoofingOnly(['electrical', 'roofing'])).toBe(false)
    expect(tenantIsRoofingOnly(['roofing', 'plumbing'])).toBe(false)
  })
  it('is false for non-roofing, empty and nullish', () => {
    expect(tenantIsRoofingOnly(['electrical'])).toBe(false)
    expect(tenantIsRoofingOnly([])).toBe(false)
    expect(tenantIsRoofingOnly(null)).toBe(false)
    expect(tenantIsRoofingOnly(undefined)).toBe(false)
  })
  it('ignores blank and non-string entries', () => {
    expect(tenantIsRoofingOnly(['roofing', '  '])).toBe(true)
    expect(tenantIsRoofingOnly([null as unknown as string, 'roofing'])).toBe(true)
    expect(tenantIsRoofingOnly([null as unknown as string])).toBe(false)
  })
})
