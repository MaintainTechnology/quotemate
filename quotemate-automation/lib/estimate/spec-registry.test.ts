// Unit tests for the spec-registry pure module (canonicalise + getSpecDefs).

import { describe, expect, it } from 'vitest'
import { canonicalise, getSpecDefs, canonicaliseProperties } from './spec-registry'

describe('canonicalise — amperage', () => {
  it('normalises sloppy amp phrasings to "<n>A"', () => {
    expect(canonicalise('amperage', '15 amp')).toBe('15A')
    expect(canonicalise('amperage', '15amp')).toBe('15A')
    expect(canonicalise('amperage', '15A')).toBe('15A')
    expect(canonicalise('amperage', '15a')).toBe('15A')
    expect(canonicalise('amperage', '20-amp')).toBe('20A')
    expect(canonicalise('amperage', '10A')).toBe('10A')
  })

  it('accepts a bare integer (e.g. properties stored as a number)', () => {
    expect(canonicalise('amperage', 15)).toBe('15A')
    expect(canonicalise('amperage', '15')).toBe('15A')
  })

  it('returns null for non-amperage values', () => {
    expect(canonicalise('amperage', 'three phase')).toBeNull()
    expect(canonicalise('amperage', 'fifteenish')).toBeNull()
    expect(canonicalise('amperage', '')).toBeNull()
    expect(canonicalise('amperage', null)).toBeNull()
    expect(canonicalise('amperage', undefined)).toBeNull()
  })
})

describe('canonicalise — ip_rating / energy_source / litres', () => {
  it('normalises IP codes', () => {
    expect(canonicalise('ip_rating', 'IP56')).toBe('IP56')
    expect(canonicalise('ip_rating', 'ip 56')).toBe('IP56')
    expect(canonicalise('ip_rating', 'ip56 rated')).toBe('IP56')
    expect(canonicalise('ip_rating', 'weatherproof')).toBeNull()
  })

  it('normalises energy sources', () => {
    expect(canonicalise('energy_source', 'Gas')).toBe('gas')
    expect(canonicalise('energy_source', 'natural gas')).toBe('gas')
    expect(canonicalise('energy_source', 'Electric')).toBe('electric')
    expect(canonicalise('energy_source', 'electrical')).toBe('electric')
    expect(canonicalise('energy_source', 'heat pump')).toBe('heat-pump')
    expect(canonicalise('energy_source', 'solar')).toBe('solar')
    expect(canonicalise('energy_source', 'firewood')).toBeNull()
  })

  it('normalises litres', () => {
    expect(canonicalise('litres', '250L')).toBe('250')
    expect(canonicalise('litres', '250 litre')).toBe('250')
    expect(canonicalise('litres', 315)).toBe('315')
    expect(canonicalise('litres', 'big')).toBeNull()
  })

  it('litres ignores unrelated numbers and reads the one before L', () => {
    // Regression: "Rheem 5-star 260L gas storage HWS" must be 260, not 5.
    expect(canonicalise('litres', 'Rheem 5-star 260L gas storage HWS')).toBe('260')
    expect(canonicalise('litres', 'Dux Proflo 315L electric storage HWS')).toBe('315')
    expect(canonicalise('litres', 'Rheem 5-star gas HWS')).toBeNull()
  })
})

describe('canonicalise — phase / poles / unknown key', () => {
  it('normalises phase', () => {
    expect(canonicalise('phase', 'three-phase')).toBe('three-phase')
    expect(canonicalise('phase', '3 phase')).toBe('three-phase')
    expect(canonicalise('phase', 'single')).toBe('single-phase')
    expect(canonicalise('phase', '1 phase')).toBe('single-phase')
  })

  it('normalises poles', () => {
    expect(canonicalise('poles', 'double')).toBe('double')
    expect(canonicalise('poles', '2')).toBe('double')
    expect(canonicalise('poles', 'single')).toBe('single')
  })

  it('passes unknown keys through as lowercased/trimmed', () => {
    expect(canonicalise('colour', '  Red ')).toBe('red')
    expect(canonicalise('colour', null)).toBeNull()
  })
})

describe('getSpecDefs', () => {
  it('returns the seeded keys for known (trade, category)', () => {
    expect(getSpecDefs('electrical', 'gpo').map((d) => d.key)).toEqual(['amperage'])
    expect(getSpecDefs('electrical', 'outdoor_light').map((d) => d.key)).toEqual(['ip_rating'])
    expect(getSpecDefs('plumbing', 'hot_water').map((d) => d.key)).toEqual([
      'energy_source',
      'litres',
    ])
  })

  it('is case-insensitive on trade/category', () => {
    expect(getSpecDefs('Electrical', 'GPO').map((d) => d.key)).toEqual(['amperage'])
  })

  it('returns [] for unseeded combos and nullish input', () => {
    expect(getSpecDefs('electrical', 'fan')).toEqual([])
    expect(getSpecDefs('carpentry', 'whatever')).toEqual([])
    expect(getSpecDefs(null, undefined)).toEqual([])
  })

  it('overrides (trade_spec_defs rows) add keys for an unseeded (trade, category)', () => {
    const overrides = [
      { trade: 'carpentry', category: 'decking', spec_key: 'timber_grade' },
      { trade: 'carpentry', category: 'decking', spec_key: 'width_mm', hard: true },
    ]
    expect(getSpecDefs('carpentry', 'decking', overrides).map((d) => d.key)).toEqual([
      'timber_grade',
      'width_mm',
    ])
  })

  it('the code seed ALWAYS wins — an override cannot redefine a seeded key', () => {
    const overrides = [{ trade: 'electrical', category: 'gpo', spec_key: 'amperage', hard: true }]
    const defs = getSpecDefs('electrical', 'gpo', overrides)
    expect(defs).toEqual([{ key: 'amperage' }]) // not the hard:true override
  })

  it('overrides are scoped to the matching (trade, category) only', () => {
    const overrides = [{ trade: 'plumbing', category: 'hot_water', spec_key: 'warranty_years' }]
    expect(getSpecDefs('electrical', 'gpo', overrides).map((d) => d.key)).toEqual(['amperage'])
    expect(getSpecDefs('plumbing', 'hot_water', overrides).map((d) => d.key)).toEqual([
      'energy_source',
      'litres',
      'warranty_years',
    ])
  })

  it('empty / null overrides leave the seed unchanged', () => {
    expect(getSpecDefs('electrical', 'gpo', []).map((d) => d.key)).toEqual(['amperage'])
    expect(getSpecDefs('electrical', 'gpo', null).map((d) => d.key)).toEqual(['amperage'])
  })
})

describe('canonicaliseProperties (forward-fill on write)', () => {
  it('canonicalises the registry keys for the (trade, category)', () => {
    expect(canonicaliseProperties({ amperage: '15 amp' }, 'electrical', 'gpo')).toEqual({
      amperage: '15A',
    })
    expect(
      canonicaliseProperties({ energy_source: 'Gas', litres: '250L' }, 'plumbing', 'hot_water'),
    ).toEqual({ energy_source: 'gas', litres: '250' })
  })

  it('passes unknown keys through untouched', () => {
    expect(canonicaliseProperties({ colour: 'Red', amperage: '10A' }, 'electrical', 'gpo')).toEqual({
      colour: 'Red',
      amperage: '10A',
    })
  })

  it('keeps an unparseable registry value RAW (never drops tradie data)', () => {
    expect(canonicaliseProperties({ amperage: 'fifteenish' }, 'electrical', 'gpo')).toEqual({
      amperage: 'fifteenish',
    })
  })

  it('returns {} for null / non-object input', () => {
    expect(canonicaliseProperties(null, 'electrical', 'gpo')).toEqual({})
    expect(canonicaliseProperties(undefined, 'electrical', 'gpo')).toEqual({})
  })
})
