import { describe, it, expect } from 'vitest'
import { resolveTierSelection, isTierKey } from './select-tier'

const tiers = {
  good: { subtotal_ex_gst: 1000 },
  better: { subtotal_ex_gst: 2500 },
  best: { subtotal_ex_gst: 4000 },
}

describe('resolveTierSelection', () => {
  it('selects a priced tier and computes the inc-GST headline (registered)', () => {
    const r = resolveTierSelection({ tier: 'good', tiers, gstRegistered: true })
    expect(r).toEqual({ ok: true, selectedTier: 'good', totalIncGst: 1100 })
  })

  it('does not add GST for an unregistered tenant', () => {
    const r = resolveTierSelection({ tier: 'best', tiers, gstRegistered: false })
    expect(r).toEqual({ ok: true, selectedTier: 'best', totalIncGst: 4000 })
  })

  it('rejects an unknown tier value', () => {
    expect(resolveTierSelection({ tier: 'premium', tiers, gstRegistered: true })).toEqual({
      ok: false,
      error: 'invalid_tier',
    })
    expect(resolveTierSelection({ tier: null, tiers, gstRegistered: true })).toEqual({
      ok: false,
      error: 'invalid_tier',
    })
  })

  it('rejects a tier that is not present (null) — never send a $0 option', () => {
    const r = resolveTierSelection({
      tier: 'good',
      tiers: { good: null, better: tiers.better, best: tiers.best },
      gstRegistered: true,
    })
    expect(r).toEqual({ ok: false, error: 'tier_not_priced' })
  })

  it('rejects a tier priced at 0 (unpriceable roof — asbestos/unknown)', () => {
    const r = resolveTierSelection({
      tier: 'good',
      tiers: { good: { subtotal_ex_gst: 0 }, better: tiers.better, best: tiers.best },
      gstRegistered: true,
    })
    expect(r).toEqual({ ok: false, error: 'tier_not_priced' })
  })
})

describe('isTierKey', () => {
  it('accepts only good/better/best', () => {
    expect(isTierKey('good')).toBe(true)
    expect(isTierKey('better')).toBe(true)
    expect(isTierKey('best')).toBe(true)
    expect(isTierKey('BEST')).toBe(false)
    expect(isTierKey(undefined)).toBe(false)
  })
})
