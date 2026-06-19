import { describe, it, expect } from 'vitest'
import {
  tenantStoreKey,
  tenantStoreDisplayName,
  displayNameMatchesTenant,
  quoteDocDisplayName,
  normalizeTradeForDoc,
} from './tenant-store-name'

const TID = '550e8400-e29b-41d4-a716-446655440000'

describe('tenantStoreKey', () => {
  it('is deterministic and prefixed', () => {
    expect(tenantStoreKey(TID)).toBe(tenantStoreKey(TID))
    expect(tenantStoreKey(TID).startsWith('qm-tenant-')).toBe(true)
  })
  it('is keyed on the tenant id, not the business name', () => {
    // No business-name input at all → key is purely tenant-derived.
    expect(tenantStoreKey(TID)).not.toContain(' ')
  })
  it('throws on empty', () => {
    expect(() => tenantStoreKey('')).toThrow()
    expect(() => tenantStoreKey('   ')).toThrow()
  })
})

describe('tenantStoreDisplayName + matcher', () => {
  it('appends a slugged business label after the stable key', () => {
    const dn = tenantStoreDisplayName(TID, "Joe's Sparkies Pty Ltd")
    expect(dn.startsWith(tenantStoreKey(TID) + ' ')).toBe(true)
    expect(dn.length).toBeLessThanOrEqual(128)
  })
  it('a business rename never breaks identity (label-tolerant match)', () => {
    expect(displayNameMatchesTenant(tenantStoreDisplayName(TID, 'Old Name'), TID)).toBe(true)
    expect(displayNameMatchesTenant(tenantStoreDisplayName(TID, 'New Name'), TID)).toBe(true)
    expect(displayNameMatchesTenant(tenantStoreKey(TID), TID)).toBe(true)
  })
  it('does not match another tenant', () => {
    expect(displayNameMatchesTenant('qm-tenant-other label', TID)).toBe(false)
    expect(displayNameMatchesTenant(null, TID)).toBe(false)
  })
})

describe('quoteDocDisplayName (conventions table)', () => {
  it('electrical/plumbing use trade + uuid', () => {
    expect(quoteDocDisplayName({ sourceKind: 'quote', trade: 'electrical', sourceId: 'abc' })).toBe('quote-electrical-abc')
    expect(quoteDocDisplayName({ sourceKind: 'quote', trade: 'plumbing', sourceId: 'abc' })).toBe('quote-plumbing-abc')
  })
  it('token trades normalise (commercial-painting → painting)', () => {
    expect(quoteDocDisplayName({ sourceKind: 'quote', trade: 'roofing', sourceId: 'tok' })).toBe('quote-roofing-tok')
    expect(quoteDocDisplayName({ sourceKind: 'quote', trade: 'solar', sourceId: 'tok' })).toBe('quote-solar-tok')
    expect(quoteDocDisplayName({ sourceKind: 'quote', trade: 'commercial-painting', sourceId: 'tok' })).toBe('quote-painting-tok')
    expect(quoteDocDisplayName({ sourceKind: 'quote', trade: 'painting', sourceId: 'tok' })).toBe('quote-painting-tok')
  })
  it('invoices use invoice- + uuid', () => {
    expect(quoteDocDisplayName({ sourceKind: 'invoice', sourceId: 'inv1' })).toBe('invoice-inv1')
  })
  it('throws on empty source id', () => {
    expect(() => quoteDocDisplayName({ sourceKind: 'quote', trade: 'electrical', sourceId: '' })).toThrow()
  })
})

describe('normalizeTradeForDoc', () => {
  it('maps painting variants to painting', () => {
    expect(normalizeTradeForDoc('commercial-painting')).toBe('painting')
    expect(normalizeTradeForDoc('painting')).toBe('painting')
  })
  it('passes through known trades and defaults empty', () => {
    expect(normalizeTradeForDoc('electrical')).toBe('electrical')
    expect(normalizeTradeForDoc('')).toBe('job')
    expect(normalizeTradeForDoc(null)).toBe('job')
  })
})
