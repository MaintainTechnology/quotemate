// Unit tests for the licence-fieldset resolver (R39).
//
// Core requirement: after activating a NEW trade, the Account tab must render
// a BLANK fieldset for it. licenceFieldsetsForTrades back-fills that blank.

import { describe, it, expect } from 'vitest'
import {
  licenceFieldsetsForTrades,
  isBlankLicence,
  type LicenceLike,
} from './licence-fieldsets'

const elec: LicenceLike = {
  trade: 'electrical',
  licence_type: 'NECA NSW',
  licence_number: 'EC12345',
  licence_state: 'NSW',
  licence_expiry: '2027-01-01',
}

describe('licenceFieldsetsForTrades (R39)', () => {
  it('back-fills a BLANK fieldset for a newly-activated trade not yet in licences', () => {
    // Tenant just activated plumbing; licences payload still only has electrical.
    const out = licenceFieldsetsForTrades(['electrical', 'plumbing'], [elec], 'NSW')
    expect(out).toHaveLength(2)
    const plumbing = out.find((l) => l.trade === 'plumbing')!
    expect(plumbing).toBeDefined()
    expect(plumbing.licence_type).toBeNull()
    expect(plumbing.licence_number).toBeNull()
    expect(plumbing.licence_expiry).toBeNull()
    // seeds the operating state so the dropdown isn't empty
    expect(plumbing.licence_state).toBe('NSW')
    expect(isBlankLicence(plumbing)).toBe(true)
  })

  it('keeps existing licence rows intact for trades that have them', () => {
    const out = licenceFieldsetsForTrades(['electrical', 'plumbing'], [elec], 'NSW')
    const e = out.find((l) => l.trade === 'electrical')!
    expect(e).toEqual(elec)
    expect(isBlankLicence(e)).toBe(false)
  })

  it('orders fieldsets by trades[] order', () => {
    const out = licenceFieldsetsForTrades(['plumbing', 'electrical'], [elec])
    expect(out.map((l) => l.trade)).toEqual(['plumbing', 'electrical'])
  })

  it('drops a stale licence row for a trade the tenant no longer runs', () => {
    const plumb: LicenceLike = {
      trade: 'plumbing',
      licence_type: 'QBCC',
      licence_number: 'P999',
      licence_state: 'QLD',
      licence_expiry: '2028-01-01',
    }
    const out = licenceFieldsetsForTrades(['electrical'], [elec, plumb])
    expect(out.map((l) => l.trade)).toEqual(['electrical'])
  })

  it('de-duplicates a repeated trade', () => {
    const out = licenceFieldsetsForTrades(['electrical', 'electrical'], [elec])
    expect(out).toHaveLength(1)
  })

  it('falls back to the licences as-is when trades is empty/nullish', () => {
    expect(licenceFieldsetsForTrades([], [elec])).toEqual([elec])
    expect(licenceFieldsetsForTrades(null, [elec])).toEqual([elec])
    expect(licenceFieldsetsForTrades(undefined, [elec])).toEqual([elec])
  })

  it('handles a fully fresh tenant (no licences yet) by blanking every trade', () => {
    const out = licenceFieldsetsForTrades(['electrical', 'plumbing'], [], 'VIC')
    expect(out).toHaveLength(2)
    expect(out.every((l) => isBlankLicence(l))).toBe(true)
    expect(out.every((l) => l.licence_state === 'VIC')).toBe(true)
  })
})

describe('isBlankLicence', () => {
  it('is blank when type/number/expiry are all empty regardless of state', () => {
    expect(
      isBlankLicence({
        trade: 'plumbing',
        licence_type: null,
        licence_number: '',
        licence_state: 'NSW',
        licence_expiry: null,
      }),
    ).toBe(true)
  })
  it('is not blank when any of type/number/expiry is set', () => {
    expect(
      isBlankLicence({
        trade: 'plumbing',
        licence_type: 'QBCC',
        licence_number: null,
        licence_state: null,
        licence_expiry: null,
      }),
    ).toBe(false)
  })
})
