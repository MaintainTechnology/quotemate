// Unit tests for the catalogue-coverage badge resolver (R37).
//
// The point of these tests: the SAME resolver drives Catalogue, Estimating,
// and Recipes, so a category is either 'catalogue' everywhere or 'generic'
// everywhere — the three tabs can never disagree.

import { describe, it, expect } from 'vitest'
import {
  resolveCatalogueBadge,
  mergeCatalogueToggleIntoCats,
  badgeLabel,
} from './badge-state'

describe('resolveCatalogueBadge (R37)', () => {
  it("returns 'catalogue' when the category is present (case/space-insensitive)", () => {
    expect(resolveCatalogueBadge('Downlight', ['downlight'])).toBe('catalogue')
    expect(resolveCatalogueBadge('  HWS_GAS ', ['hws_gas'])).toBe('catalogue')
  })
  it("returns 'generic' when the category is absent", () => {
    expect(resolveCatalogueBadge('downlight', ['gpo', 'switch'])).toBe('generic')
  })
  it("treats a blank/null line category as 'generic'", () => {
    expect(resolveCatalogueBadge('', ['downlight'])).toBe('generic')
    expect(resolveCatalogueBadge(null, ['downlight'])).toBe('generic')
    expect(resolveCatalogueBadge(undefined, ['downlight'])).toBe('generic')
  })
  it('ignores null/blank entries in the catalogue set', () => {
    expect(resolveCatalogueBadge('downlight', [null, '', '  ', 'downlight'])).toBe('catalogue')
    expect(resolveCatalogueBadge('downlight', [null, ''])).toBe('generic')
  })

  it('is consistent across the three tab surfaces given the SAME inputs', () => {
    const cats = ['downlight', 'gpo']
    const estimating = resolveCatalogueBadge('downlight', cats)
    const recipes = resolveCatalogueBadge('downlight', cats)
    const catalogue = resolveCatalogueBadge('downlight', cats)
    expect(estimating).toBe(recipes)
    expect(recipes).toBe(catalogue)
    expect(estimating).toBe('catalogue')
  })
})

describe('mergeCatalogueToggleIntoCats (R37 — in-session consistency)', () => {
  it('adds a newly-enabled category so the badge flips immediately', () => {
    const merged = mergeCatalogueToggleIntoCats(['gpo'], { category: 'Downlight', active: true })
    expect(merged).toContain('downlight')
    expect(resolveCatalogueBadge('downlight', merged)).toBe('catalogue')
  })
  it('does NOT add a disabled category (additive only, never claims removal)', () => {
    const merged = mergeCatalogueToggleIntoCats(['gpo'], { category: 'downlight', active: false })
    expect(merged).not.toContain('downlight')
  })
  it('de-duplicates and normalises the resulting set', () => {
    const merged = mergeCatalogueToggleIntoCats(
      ['Downlight', 'downlight', ' GPO '],
      { category: 'downlight', active: true },
    )
    expect(merged).toEqual(['downlight', 'gpo'])
  })
  it('does not mutate the input array', () => {
    const input = ['gpo']
    mergeCatalogueToggleIntoCats(input, { category: 'downlight', active: true })
    expect(input).toEqual(['gpo'])
  })
})

describe('badgeLabel', () => {
  it('returns matching long/short copy per state', () => {
    expect(badgeLabel('catalogue', 'long')).toBe('✓ priced from your catalogue')
    expect(badgeLabel('catalogue', 'short')).toBe('✓ your catalogue')
    expect(badgeLabel('generic', 'long')).toBe('⚠ no catalogue product — generic price')
    expect(badgeLabel('generic', 'short')).toBe('⚠ generic price')
  })
})
