import { describe, it, expect } from 'vitest'
import {
  FEATURE_TAB_SLUGS,
  isFeatureTab,
  slugForTab,
  tenantHasFeature,
  isTabEnabled,
  tenantFeatureSlugs,
} from './catalog'

describe('feature catalog', () => {
  describe('isFeatureTab / slugForTab', () => {
    it('recognises every feature tab and maps it to its gating slug', () => {
      for (const [tab, slug] of Object.entries(FEATURE_TAB_SLUGS)) {
        expect(isFeatureTab(tab)).toBe(true)
        expect(slugForTab(tab)).toBe(slug)
      }
    })

    it('treats core tabs as non-feature (always shown)', () => {
      for (const core of ['overview', 'quotes', 'chats', 'billing', 'pricing', 'invites']) {
        expect(isFeatureTab(core)).toBe(false)
        expect(slugForTab(core)).toBeNull()
      }
    })

    it('gates the estimator tab on the electrical slug', () => {
      expect(slugForTab('estimator')).toBe('electrical')
    })

    it('maps the hyphenated commercial-painting tab to the underscore slug', () => {
      expect(slugForTab('commercial-painting')).toBe('commercial_painting')
    })
  })

  describe('tenantHasFeature', () => {
    it('is true only when the slug is present (case-insensitive)', () => {
      expect(tenantHasFeature(['electrical', 'solar'], 'solar')).toBe(true)
      expect(tenantHasFeature(['Electrical'], 'electrical')).toBe(true)
      expect(tenantHasFeature(['electrical'], 'solar')).toBe(false)
    })

    it('is false for null/undefined/non-array trades', () => {
      expect(tenantHasFeature(null, 'solar')).toBe(false)
      expect(tenantHasFeature(undefined, 'solar')).toBe(false)
      // @ts-expect-error — defensive against bad runtime input
      expect(tenantHasFeature('solar', 'solar')).toBe(false)
    })
  })

  describe('isTabEnabled', () => {
    it('always shows core tabs regardless of trades', () => {
      expect(isTabEnabled('overview', [])).toBe(true)
      expect(isTabEnabled('billing', null)).toBe(true)
    })

    it('shows a feature tab only when its slug is present', () => {
      expect(isTabEnabled('solar', ['solar'])).toBe(true)
      expect(isTabEnabled('solar', ['electrical'])).toBe(false)
      expect(isTabEnabled('estimator', ['electrical'])).toBe(true)
      expect(isTabEnabled('estimator', ['plumbing'])).toBe(false)
      expect(isTabEnabled('commercial-painting', ['commercial_painting'])).toBe(true)
    })
  })

  describe('tenantFeatureSlugs', () => {
    it('returns trades that are known catalog slugs only', () => {
      expect(tenantFeatureSlugs(['electrical', 'solar', 'not_a_trade'])).toEqual([
        'electrical',
        'solar',
      ])
      expect(tenantFeatureSlugs([])).toEqual([])
      expect(tenantFeatureSlugs(null)).toEqual([])
    })
  })
})
