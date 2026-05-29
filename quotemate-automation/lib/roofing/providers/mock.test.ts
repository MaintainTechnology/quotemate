import { describe, expect, it } from 'vitest'
import { MockRoofingProvider, hash } from './mock'

describe('MockRoofingProvider', () => {
  const p = new MockRoofingProvider()

  it('returns ok metrics for any valid address', async () => {
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.provider).toBe('mock')
      expect(r.metrics.footprint_m2).toBeGreaterThan(0)
      expect(r.metrics.sloped_area_m2).toBeGreaterThan(r.metrics.footprint_m2)
      expect(['gable', 'hip', 'gable_hip']).toContain(r.metrics.form)
    }
  })

  it('is deterministic — same input → same metrics', async () => {
    const a = await p.measure({ address: '7 Smith St', postcode: '2750', state: 'NSW' })
    const b = await p.measure({ address: '7 Smith St', postcode: '2750', state: 'NSW' })
    expect(a).toEqual(b)
  })

  it('throws on empty address (programmer error)', async () => {
    await expect(
      p.measure({ address: '', postcode: '2000', state: 'NSW' }),
    ).rejects.toThrow(/address is required/)
  })
})

describe('hash', () => {
  it('returns the same number for the same string', () => {
    expect(hash('abc')).toBe(hash('abc'))
  })
  it('returns a different number for different strings', () => {
    expect(hash('abc')).not.toBe(hash('def'))
  })
  it('is always non-negative', () => {
    expect(hash('whatever-this-is')).toBeGreaterThanOrEqual(0)
  })
})
