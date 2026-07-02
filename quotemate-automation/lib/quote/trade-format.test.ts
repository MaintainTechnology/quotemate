import { describe, expect, it, vi } from 'vitest'
import { resolveTradeFormat, usesGenericCard, tierLabelsForTrade } from './trade-format'

describe('resolveTradeFormat', () => {
  it('keeps electrical on the generic baseline card', () => {
    const f = resolveTradeFormat('electrical')
    expect(f.key).toBe('electrical')
    expect(f.usesGenericCard).toBe(true)
    expect(f.dashboardRenderer).toBe('generic')
    expect(f.customerRouteBase).toBeNull()
    expect(f.isFallback).toBe(false)
  })

  it('keeps plumbing on the generic baseline card', () => {
    const f = resolveTradeFormat('plumbing')
    expect(f.key).toBe('plumbing')
    expect(f.usesGenericCard).toBe(true)
    expect(f.dashboardRenderer).toBe('generic')
  })

  it('routes roofing to its bespoke format, not the generic card', () => {
    const f = resolveTradeFormat('roofing')
    expect(f.usesGenericCard).toBe(false)
    expect(f.dashboardRenderer).toBe('roofing')
    expect(f.customerRouteBase).toBe('/q/roof')
  })

  it('routes solar to its bespoke format', () => {
    const f = resolveTradeFormat('solar')
    expect(f.usesGenericCard).toBe(false)
    expect(f.customerRouteBase).toBe('/q/solar')
  })

  it('normalises spelling variants to canonical keys', () => {
    expect(resolveTradeFormat('Air Conditioning').key).toBe('aircon')
    expect(resolveTradeFormat('air_con').key).toBe('aircon')
    expect(resolveTradeFormat('commercial_painting').key).toBe('commercial-painting')
    expect(resolveTradeFormat('commercial-paint').key).toBe('commercial-painting')
    expect(resolveTradeFormat('paint').key).toBe('painting')
    expect(resolveTradeFormat('estimator').key).toBe('electrical-estimation')
    expect(resolveTradeFormat('ROOF').key).toBe('roofing')
  })

  it('falls back to the generic baseline and warns for an unknown trade (R3)', () => {
    const warn = vi.fn()
    const f = resolveTradeFormat('underwater-basket-weaving', warn)
    expect(f.key).toBe('electrical')
    expect(f.usesGenericCard).toBe(true)
    expect(f.isFallback).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[1]).toEqual({ trade: 'underwater-basket-weaving' })
  })

  it('falls back and warns for null/empty trade', () => {
    const warn = vi.fn()
    const f = resolveTradeFormat(null, warn)
    expect(f.isFallback).toBe(true)
    expect(f.usesGenericCard).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('does not warn for a known trade', () => {
    const warn = vi.fn()
    resolveTradeFormat('roofing', warn)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('usesGenericCard', () => {
  it('is true for electrical and plumbing only', () => {
    expect(usesGenericCard('electrical')).toBe(true)
    expect(usesGenericCard('plumbing')).toBe(true)
    expect(usesGenericCard('roofing')).toBe(false)
    expect(usesGenericCard('solar')).toBe(false)
    expect(usesGenericCard('aircon')).toBe(false)
  })

  it('treats unknown trades as generic (mirrors the logged fallback)', () => {
    expect(usesGenericCard('something-new')).toBe(true)
  })
})

describe('tierLabelsForTrade', () => {
  it('gives roofing its own tier framing', () => {
    expect(tierLabelsForTrade('roofing')).toEqual({
      good: 'Patch / repair',
      better: 'Re-roof',
      best: 'Upgrade',
    })
  })

  it('labels every commercial-painting tier slot as the tender price', () => {
    // buildTenderTier wraps ONE tender into good/better/best identically, so
    // whichever slot the tier mode surfaces must read as the tender.
    expect(tierLabelsForTrade('commercial_painting')).toEqual({
      good: 'Tender price',
      better: 'Tender price',
      best: 'Tender price',
    })
  })

  it('keeps Good/Better/Best for electrical, plumbing, and unknown trades', () => {
    const generic = { good: 'Good', better: 'Better', best: 'Best' }
    expect(tierLabelsForTrade('electrical')).toEqual(generic)
    expect(tierLabelsForTrade('plumbing')).toEqual(generic)
    expect(tierLabelsForTrade('solar')).toEqual(generic)
    expect(tierLabelsForTrade(null)).toEqual(generic)
  })
})
