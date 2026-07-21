// Enhanced-capture cache — pure helper tests.

import { describe, expect, it } from 'vitest'
import { CAPTURE_VIEWS, cachePathFor, normalizeAddressKey } from './capture-cache'

describe('normalizeAddressKey', () => {
  it('is case- and punctuation-insensitive', () => {
    expect(normalizeAddressKey('670 LONDON RD, CHANDLER QLD 4155')).toBe(
      normalizeAddressKey('670 london rd chandler qld 4155'),
    )
  })

  it('collapses whitespace to single hyphens', () => {
    expect(normalizeAddressKey('  12   Smith  St ')).toBe('12-smith-st')
  })

  it('strips characters unsafe for storage paths', () => {
    expect(normalizeAddressKey('5/2 O\'Brien St #4')).toBe('5-2-o-brien-st-4')
    expect(normalizeAddressKey('Ünit 3, Café Lane')).toBe('unit-3-cafe-lane')
  })

  it('caps runaway input length', () => {
    expect(normalizeAddressKey('x'.repeat(500)).length).toBeLessThanOrEqual(120)
  })
})

describe('cachePathFor', () => {
  it('builds version-segmented enhanced/v4/{key}/{view} so stale-contract images are never reused', () => {
    expect(cachePathFor('670 London Rd, Chandler QLD', 'front')).toBe(
      'enhanced/v4/670-london-rd-chandler-qld/front',
    )
  })

  it('covers all five capture views', () => {
    expect(CAPTURE_VIEWS).toEqual(['front', 'left', 'right', 'back', 'top'])
  })

  it('separates anatomy overlays from enhanced captures (same version segment)', () => {
    expect(cachePathFor('670 London Rd', 'front', 'anatomy')).toBe(
      'anatomy/v4/670-london-rd/front',
    )
    expect(cachePathFor('670 London Rd', 'front', 'enhanced')).toBe(
      cachePathFor('670 London Rd', 'front'),
    )
  })

  it('keeps the synthesised 3D renders in their own namespace', () => {
    expect(cachePathFor('670 London Rd', 'front', 'synth')).toBe('synth/v4/670-london-rd/front')
    expect(cachePathFor('670 London Rd', 'back', 'synth')).toBe('synth/v4/670-london-rd/back')
  })
})
