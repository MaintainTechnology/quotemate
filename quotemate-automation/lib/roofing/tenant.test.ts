import { describe, expect, it } from 'vitest'
import { tenantHasRoofingTrade } from './tenant'

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
