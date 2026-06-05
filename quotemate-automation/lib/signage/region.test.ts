import { describe, it, expect } from 'vitest'
import { regionMatches, filterStudiosByRegion, distinctRegions } from './region'

describe('regionMatches', () => {
  it('matches case-insensitively (the AU-QLD bug)', () => {
    // studio saved "Au-Qld", sweep filter "AU-QLD" → must match
    expect(regionMatches({ region: 'Au-Qld' }, 'AU-QLD')).toBe(true)
    expect(regionMatches({ region: 'au-qld' }, 'AU-QLD')).toBe(true)
    expect(regionMatches({ region: 'AU-QLD' }, 'au-qld')).toBe(true)
  })

  it('matches on state when region is absent (Places-added studio)', () => {
    expect(regionMatches({ region: null, state: 'QLD' }, 'qld')).toBe(true)
    expect(regionMatches({ region: null, state: 'QLD' }, 'AU-NSW')).toBe(false)
  })

  it('an empty/blank filter matches every studio', () => {
    expect(regionMatches({ region: 'AU-NSW' }, '')).toBe(true)
    expect(regionMatches({ region: 'AU-NSW' }, null)).toBe(true)
    expect(regionMatches({ region: 'AU-NSW' }, '   ')).toBe(true)
  })

  it('does not match a different region', () => {
    expect(regionMatches({ region: 'AU-NSW' }, 'AU-QLD')).toBe(false)
    expect(regionMatches({ region: null, state: null }, 'AU-QLD')).toBe(false)
  })

  it('trims whitespace on both sides', () => {
    expect(regionMatches({ region: '  AU-QLD  ' }, ' au-qld ')).toBe(true)
  })
})

describe('filterStudiosByRegion', () => {
  const studios = [
    { id: '1', region: 'AU-NSW', state: null },
    { id: '2', region: 'Au-Qld', state: null },
    { id: '3', region: null, state: 'QLD' },
    { id: '4', region: 'US-TX', state: null },
  ]

  it('selects the QLD studios regardless of casing or region-vs-state', () => {
    const got = filterStudiosByRegion(studios, 'AU-QLD').map((s) => s.id)
    expect(got).toContain('2') // "Au-Qld" region
  })

  it('matches the state-only studio when filtering by state code', () => {
    const got = filterStudiosByRegion(studios, 'QLD').map((s) => s.id)
    expect(got).toContain('3')
  })

  it('returns all studios for a blank filter', () => {
    expect(filterStudiosByRegion(studios, '').length).toBe(4)
    expect(filterStudiosByRegion(studios, null).length).toBe(4)
  })

  it('returns none for an unknown region', () => {
    expect(filterStudiosByRegion(studios, 'AU-WA').length).toBe(0)
  })
})

describe('distinctRegions', () => {
  it('de-duplicates case-insensitively, keeping first-seen casing', () => {
    const got = distinctRegions([
      { region: 'AU-QLD' },
      { region: 'Au-Qld' },
      { region: 'au-qld' },
      { region: 'AU-NSW' },
    ])
    expect(got).toEqual(['AU-NSW', 'AU-QLD'])
  })

  it('falls back to state when region is missing', () => {
    const got = distinctRegions([{ region: null, state: 'QLD' }, { region: 'AU-NSW' }])
    expect(got).toEqual(['AU-NSW', 'QLD'])
  })

  it('ignores studios with neither region nor state', () => {
    expect(distinctRegions([{ region: null, state: null }, { region: '  ' }])).toEqual([])
  })
})
