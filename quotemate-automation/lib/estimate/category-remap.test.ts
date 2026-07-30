// Step 1 — resolve the categories that a one-to-one rename cannot.
//
// `hot_water` maps to three real values and `tap` to four, so the R8 script
// refuses to guess. But the guess is unnecessary: the PRODUCT NAME says which
// one it is. "Rheem 5-star 260L gas storage HWS" is not ambiguous to a human
// and should not be ambiguous to the code.
//
// Fixtures are the real live rows (2026-07-30), so this is tested against the
// data it will actually run on, not invented examples.
//
// Deliberately conservative: no name evidence → null → the row is left alone
// and still reported. Wrong beats unresolved here, because a mis-set category
// puts a $1,845 gas unit's price on an electric job.

import { describe, it, expect } from 'vitest'
import { resolveByProductName } from './category-remap'
import { isMaterialCategory } from './material-vocabulary'

describe('Step 1 — hot_water resolves from the product name', () => {
  it('reads "electric" as hws_electric', () => {
    expect(resolveByProductName('hot_water', 'Dux Proflo 315L electric storage HWS', 'plumbing'))
      .toBe('hws_electric')
    expect(resolveByProductName('hot_water', 'Rheem Stellar 250L electric storage HWS', 'plumbing'))
      .toBe('hws_electric')
  })

  it('reads "gas" as hws_gas', () => {
    expect(resolveByProductName('hot_water', 'Rheem 5-star 260L gas storage HWS', 'plumbing'))
      .toBe('hws_gas')
  })

  it('reads a heat pump as hws_heat_pump, not as electric', () => {
    // A heat pump IS electric, so a naive "contains electric" rule would
    // mis-file it. Heat pump must win.
    expect(resolveByProductName('hot_water', 'Reclaim 270L heat pump HWS', 'plumbing'))
      .toBe('hws_heat_pump')
    expect(resolveByProductName('hot_water', 'Sanden Eco Plus electric heat-pump HWS', 'plumbing'))
      .toBe('hws_heat_pump')
  })

  it('returns null when the name says nothing — never a coin flip', () => {
    expect(resolveByProductName('hot_water', 'Hot water unit', 'plumbing')).toBeNull()
    expect(resolveByProductName('hot_water', '', 'plumbing')).toBeNull()
  })

  it('does not read "gas" out of an unrelated word', () => {
    // "Gasket" contains "gas". Word-boundary matching, not substring.
    expect(resolveByProductName('hot_water', 'HWS gasket kit', 'plumbing')).toBeNull()
  })
})

describe('Step 1 — tap resolves from the product name', () => {
  it('reads "garden" as tapware_outdoor', () => {
    expect(resolveByProductName('tap', 'Phoenix garden tap', 'plumbing')).toBe('tapware_outdoor')
    expect(resolveByProductName('tap', 'Reece Tradeflow garden tap', 'plumbing'))
      .toBe('tapware_outdoor')
  })

  it('reads the other three rooms', () => {
    expect(resolveByProductName('tap', 'Methven basin mixer', 'plumbing')).toBe('tapware_basin')
    expect(resolveByProductName('tap', 'Phoenix kitchen sink mixer', 'plumbing'))
      .toBe('tapware_kitchen')
    expect(resolveByProductName('tap', 'Laundry trough tap set', 'plumbing'))
      .toBe('tapware_laundry')
  })

  it('returns null for a bare "tap" with no room', () => {
    expect(resolveByProductName('tap', 'Chrome tap', 'plumbing')).toBeNull()
  })
})

describe('Step 1 — guard rails', () => {
  it('only ever returns a REAL material category', () => {
    const names = [
      'Dux Proflo 315L electric storage HWS',
      'Rheem 5-star 260L gas storage HWS',
      'Reclaim 270L heat pump HWS',
      'Phoenix garden tap',
      'Methven basin mixer',
      'Phoenix kitchen sink mixer',
      'Laundry trough tap set',
    ]
    for (const n of names) {
      const out = resolveByProductName(n.includes('HWS') ? 'hot_water' : 'tap', n, 'plumbing')
      expect(out, n).not.toBeNull()
      expect(isMaterialCategory(out as string, 'plumbing'), `${n} → ${out}`).toBe(true)
    }
  })

  it('refuses a category it has no rules for — cctv stays unresolved', () => {
    // "Rent CCTV system" is a hire, not a material. No shared_materials row
    // exists and inventing one is not this step's job.
    expect(resolveByProductName('cctv', 'Rent CCTV system', 'plumbing')).toBeNull()
  })

  it('refuses to touch a category that is already valid', () => {
    expect(resolveByProductName('toilet', 'Caroma Profile toilet suite', 'plumbing')).toBeNull()
  })

  it('is case- and whitespace-insensitive on the name', () => {
    expect(resolveByProductName('hot_water', '  RHEEM 260L GAS STORAGE HWS  ', 'plumbing'))
      .toBe('hws_gas')
  })
})
