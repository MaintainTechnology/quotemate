import { describe, expect, it } from 'vitest'
import { resolveTenantCapabilities } from './capabilities'

describe('resolveTenantCapabilities', () => {
  it('returns only the enabled trades', () => {
    const caps = resolveTenantCapabilities(['electrical'])
    expect(caps.map((c) => c.key)).toEqual(['electrical'])
    expect(caps[0].label).toBe('Electrical')
    expect(caps[0].examples.length).toBeGreaterThan(2)
  })

  it('renders multiple trades in a fixed order regardless of input order', () => {
    const caps = resolveTenantCapabilities(['solar', 'electrical', 'roofing'])
    expect(caps.map((c) => c.key)).toEqual(['electrical', 'roofing', 'solar'])
  })

  it('is tolerant of casing and whitespace', () => {
    const caps = resolveTenantCapabilities([' Plumbing ', 'SOLAR'])
    expect(caps.map((c) => c.key)).toEqual(['plumbing', 'solar'])
  })

  it('dedupes repeated trades', () => {
    const caps = resolveTenantCapabilities(['electrical', 'electrical'])
    expect(caps.map((c) => c.key)).toEqual(['electrical'])
  })

  it('drops unknown trade keys (forward-compatible)', () => {
    const caps = resolveTenantCapabilities(['electrical', 'carpentry', 'handyman'])
    expect(caps.map((c) => c.key)).toEqual(['electrical'])
  })

  it('covers every live trade key', () => {
    const caps = resolveTenantCapabilities([
      'electrical',
      'plumbing',
      'roofing',
      'solar',
      'aircon',
      'commercial_painting',
    ])
    expect(caps.map((c) => c.key)).toEqual([
      'electrical',
      'plumbing',
      'roofing',
      'solar',
      'aircon',
      'commercial_painting',
    ])
    for (const c of caps) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.tagline.length).toBeGreaterThan(0)
      expect(c.examples.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the scalar trade when trades[] is empty', () => {
    expect(resolveTenantCapabilities([], 'plumbing').map((c) => c.key)).toEqual(['plumbing'])
    expect(resolveTenantCapabilities(null, 'electrical').map((c) => c.key)).toEqual(['electrical'])
  })

  it('returns [] when nothing maps', () => {
    expect(resolveTenantCapabilities([])).toEqual([])
    expect(resolveTenantCapabilities(null, null)).toEqual([])
    expect(resolveTenantCapabilities(['carpentry'])).toEqual([])
  })
})
