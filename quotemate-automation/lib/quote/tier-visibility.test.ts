// Tests for the pure quote tier-visibility module.
// No DOM, no DB, no fetch — just the type-guard + visible-tier resolver.

import { describe, expect, it } from 'vitest'
import {
  asQuoteTierMode,
  resolveVisibleTiers,
  QUOTE_TIER_MODES,
} from './tier-visibility'

const ALL = { good: true, better: true, best: true }

describe('QUOTE_TIER_MODES', () => {
  it('has exactly the five modes', () => {
    expect(QUOTE_TIER_MODES).toEqual([
      'good_better_best',
      'single',
      'good',
      'better',
      'best',
    ])
  })
})

describe('asQuoteTierMode', () => {
  it('accepts valid modes verbatim', () => {
    for (const m of QUOTE_TIER_MODES) {
      expect(asQuoteTierMode(m)).toBe(m)
    }
  })

  it('falls back to single by default for invalid input', () => {
    expect(asQuoteTierMode(null)).toBe('single')
    expect(asQuoteTierMode(undefined)).toBe('single')
    expect(asQuoteTierMode('')).toBe('single')
    expect(asQuoteTierMode('garbage')).toBe('single')
    expect(asQuoteTierMode(42)).toBe('single')
    expect(asQuoteTierMode({})).toBe('single')
  })

  it('honours an explicit fallback', () => {
    expect(asQuoteTierMode(null, 'good_better_best')).toBe('good_better_best')
    expect(asQuoteTierMode('nope', 'better')).toBe('better')
  })

  it('is case-sensitive — uppercase/mixed-case is not accepted', () => {
    expect(asQuoteTierMode('Single')).toBe('single')
    expect(asQuoteTierMode('GOOD_BETTER_BEST')).toBe('single')
  })
})

describe('resolveVisibleTiers — good_better_best mode', () => {
  it('shows all priced tiers in good→better→best order', () => {
    expect(
      resolveVisibleTiers({ mode: 'good_better_best', present: ALL, selectedTier: 'better' }),
    ).toEqual(['good', 'better', 'best'])
  })

  it('shows only the priced tiers when fewer than three exist', () => {
    expect(
      resolveVisibleTiers({
        mode: 'good_better_best',
        present: { good: true, better: false, best: true },
        selectedTier: null,
      }),
    ).toEqual(['good', 'best'])
  })
})

describe('resolveVisibleTiers — single mode', () => {
  it('returns the selected_tier when it is priced', () => {
    expect(
      resolveVisibleTiers({ mode: 'single', present: ALL, selectedTier: 'best' }),
    ).toEqual(['best'])
    expect(
      resolveVisibleTiers({ mode: 'single', present: ALL, selectedTier: 'good' }),
    ).toEqual(['good'])
  })

  it('falls back better → good → best when selected_tier is missing/invalid', () => {
    expect(
      resolveVisibleTiers({ mode: 'single', present: ALL, selectedTier: null }),
    ).toEqual(['better'])
    expect(
      resolveVisibleTiers({ mode: 'single', present: ALL, selectedTier: 'inspection' }),
    ).toEqual(['better'])
  })

  it('falls back to the nearest priced tier when the recommended tier is absent', () => {
    // selected_tier='better' but better wasn't priced → better→good→best ⇒ good
    expect(
      resolveVisibleTiers({
        mode: 'single',
        present: { good: true, better: false, best: true },
        selectedTier: 'better',
      }),
    ).toEqual(['good'])
    // only best priced
    expect(
      resolveVisibleTiers({
        mode: 'single',
        present: { good: false, better: false, best: true },
        selectedTier: null,
      }),
    ).toEqual(['best'])
  })
})

describe('resolveVisibleTiers — forced single tier', () => {
  it('returns exactly the forced tier when it is priced', () => {
    expect(resolveVisibleTiers({ mode: 'good', present: ALL, selectedTier: 'better' })).toEqual(['good'])
    expect(resolveVisibleTiers({ mode: 'better', present: ALL, selectedTier: 'good' })).toEqual(['better'])
    expect(resolveVisibleTiers({ mode: 'best', present: ALL, selectedTier: 'good' })).toEqual(['best'])
  })

  it('falls back to the recommended tier when the forced tier is not priced', () => {
    // force best, but best absent; selected_tier=good is priced ⇒ good
    expect(
      resolveVisibleTiers({
        mode: 'best',
        present: { good: true, better: true, best: false },
        selectedTier: 'good',
      }),
    ).toEqual(['good'])
    // force good, but good absent; no selected_tier ⇒ better→good→best ⇒ better
    expect(
      resolveVisibleTiers({
        mode: 'good',
        present: { good: false, better: true, best: true },
        selectedTier: null,
      }),
    ).toEqual(['better'])
  })
})

describe('resolveVisibleTiers — no priced tiers (inspection / empty)', () => {
  it('returns an empty array regardless of mode', () => {
    const none = { good: false, better: false, best: false }
    for (const mode of QUOTE_TIER_MODES) {
      expect(resolveVisibleTiers({ mode, present: none, selectedTier: 'better' })).toEqual([])
    }
  })

  it('treats null/undefined presence flags as absent', () => {
    expect(
      resolveVisibleTiers({
        mode: 'single',
        present: { good: null, better: undefined, best: null },
        selectedTier: 'better',
      }),
    ).toEqual([])
  })
})
