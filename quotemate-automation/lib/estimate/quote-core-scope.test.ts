import { describe, expect, it } from 'vitest'
import { captureQuoteCoreScope, quoteCoreScopeMatches } from './quote-core-scope'

describe('Quote Core saved scope', () => {
  it('copies pricing scope without contact data or retaining mutable references', () => {
    const intake = { trade: 'electrical', job_type: 'downlights', scope: { item_count: 2 }, caller: { phone: 'private' } }
    const snapshot = captureQuoteCoreScope(intake)
    intake.scope.item_count = 50
    expect(snapshot).toMatchObject({ trade: 'electrical', job_type: 'downlights', scope: { item_count: 2 } })
    expect(snapshot).not.toHaveProperty('caller')
  })
  it('compares JSON scope independent of object key order but preserves changed values', () => {
    const first = { trade: 'electrical', job_type: 'downlights', scope: { item_count: 2, specs: { supplied_by: 'tradie' } } }
    expect(quoteCoreScopeMatches(captureQuoteCoreScope(first), captureQuoteCoreScope({ scope: first.scope, job_type: first.job_type, trade: first.trade }))).toBe(true)
    expect(quoteCoreScopeMatches(captureQuoteCoreScope(first), captureQuoteCoreScope({ ...first, scope: { ...first.scope, item_count: 3 } }))).toBe(false)
  })
  it('rejects absent or malformed intake identities and permits genuinely unclassified inspection scope', () => {
    for (const value of [null, [], {}, { trade: 'electrical', scope: [] }, { trade: 'electrical', job_type: 1 }]) {
      expect(captureQuoteCoreScope(value)).toBeNull()
    }
    expect(captureQuoteCoreScope({ trade: 'electrical', job_type: null, scope: null }))
      .toEqual({ trade: 'electrical', job_type: null, scope: null, property: null, confidence: null, inspection_required: null, address: null })
    expect(quoteCoreScopeMatches(null, null)).toBe(false)
  })
})
