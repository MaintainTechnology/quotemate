import { describe, it, expect } from 'vitest'
import {
  PLAN_FEATURE_GRANTS,
  isPlanId,
  computePlanFeatureUpdate,
  type ProvenanceMap,
} from './plan'

describe('plan feature map', () => {
  it('isPlanId accepts the three plans only', () => {
    expect(isPlanId('starter')).toBe(true)
    expect(isPlanId('pro')).toBe(true)
    expect(isPlanId('crew')).toBe(true)
    expect(isPlanId('enterprise')).toBe(false)
    expect(isPlanId(null)).toBe(false)
    expect(isPlanId(undefined)).toBe(false)
  })

  describe('computePlanFeatureUpdate', () => {
    it('starter grants nothing beyond the core trade', () => {
      const r = computePlanFeatureUpdate(['electrical'], {}, 'starter')
      expect(r.added).toEqual([])
      expect(r.removed).toEqual([])
      expect(r.nextTrades.sort()).toEqual(['electrical'])
    })

    it('upgrading to pro adds the tool features, keeping the core trade', () => {
      const r = computePlanFeatureUpdate(['electrical'], { electrical: 'onboarding' }, 'pro')
      expect(r.added.sort()).toEqual(
        [...PLAN_FEATURE_GRANTS.pro].sort(),
      )
      expect(r.removed).toEqual([])
      expect(r.nextTrades).toContain('electrical')
      expect(r.nextTrades).toContain('solar')
    })

    it('is idempotent — re-applying the same plan changes nothing', () => {
      const prov: ProvenanceMap = {
        electrical: 'onboarding',
        signage: 'plan',
        painting: 'plan',
        commercial_painting: 'plan',
        aircon: 'plan',
        solar: 'plan',
      }
      const current = ['electrical', 'signage', 'painting', 'commercial_painting', 'aircon', 'solar']
      const r = computePlanFeatureUpdate(current, prov, 'pro')
      expect(r.added).toEqual([])
      expect(r.removed).toEqual([])
    })

    it('downgrading pro→starter strips ONLY plan-sourced slugs', () => {
      const prov: ProvenanceMap = {
        electrical: 'onboarding',
        signage: 'plan',
        solar: 'plan',
      }
      const r = computePlanFeatureUpdate(['electrical', 'signage', 'solar'], prov, 'starter')
      expect(r.removed.sort()).toEqual(['signage', 'solar'])
      expect(r.nextTrades).toEqual(['electrical'])
    })

    it('a manually-granted feature survives a downgrade', () => {
      const prov: ProvenanceMap = {
        electrical: 'onboarding',
        solar: 'manual', // admin granted — sticky
        signage: 'plan', // plan granted — strippable
      }
      const r = computePlanFeatureUpdate(['electrical', 'solar', 'signage'], prov, 'starter')
      expect(r.removed).toEqual(['signage'])
      expect(r.nextTrades.sort()).toEqual(['electrical', 'solar'])
    })

    it('never strips the base trades, even with no provenance', () => {
      const r = computePlanFeatureUpdate(['electrical', 'plumbing'], {}, 'starter')
      expect(r.removed).toEqual([])
      expect(r.nextTrades.sort()).toEqual(['electrical', 'plumbing'])
    })

    it('crew grants roofing on top of the tool features', () => {
      const r = computePlanFeatureUpdate(['plumbing'], { plumbing: 'onboarding' }, 'crew')
      expect(r.added).toContain('roofing')
      expect(r.nextTrades).toContain('plumbing')
      expect(r.nextTrades).toContain('roofing')
    })
  })
})
