import { describe, expect, it } from 'vitest'
import { asPeriod, inPeriod, periodLabel, periodRange, PERIODS } from './period'

// Dates are built with the multi-arg LOCAL constructor so the assertions hold
// regardless of the runner's timezone (periodRange reads local getters, and the
// quotes below are expressed in the same local frame). 8 Jul 2026 is a
// Wednesday → the current week's Monday is 6 Jul.
const WED_8_JUL = new Date(2026, 6, 8, 12, 0)

describe('asPeriod', () => {
  it('passes through known periods', () => {
    expect(asPeriod('year')).toBe('year')
    expect(asPeriod('month')).toBe('month')
    expect(asPeriod('week')).toBe('week')
  })
  it('falls back to all for unknown / empty input', () => {
    expect(asPeriod('all')).toBe('all')
    expect(asPeriod('quarter')).toBe('all')
    expect(asPeriod(null)).toBe('all')
    expect(asPeriod(undefined)).toBe('all')
  })
})

describe('periodLabel / PERIODS', () => {
  it('labels every period and leads with All time', () => {
    expect(PERIODS[0]).toEqual({ key: 'all', label: 'All time' })
    expect(periodLabel('year')).toBe('This year')
    expect(periodLabel('month')).toBe('This month')
    expect(periodLabel('week')).toBe('This week')
  })
})

describe('periodRange', () => {
  it('returns null for all-time (unbounded)', () => {
    expect(periodRange('all', WED_8_JUL)).toBeNull()
  })

  it('year → local midnight of Jan 1 through end of today', () => {
    const r = periodRange('year', WED_8_JUL)!
    expect(r.start).toEqual(new Date(2026, 0, 1))
    expect(r.end).toEqual(new Date(2026, 6, 8, 23, 59, 59, 999))
  })

  it('month → local midnight of the 1st through end of today', () => {
    const r = periodRange('month', WED_8_JUL)!
    expect(r.start).toEqual(new Date(2026, 6, 1))
    expect(r.end).toEqual(new Date(2026, 6, 8, 23, 59, 59, 999))
  })

  it('week → local midnight of the current Monday through end of today', () => {
    const r = periodRange('week', WED_8_JUL)!
    expect(r.start).toEqual(new Date(2026, 6, 6)) // Mon 6 Jul
  })

  it('week starting mid-week resolves to the prior Monday across a month edge', () => {
    // Wed 1 Jul 2026 → its Monday is Mon 29 Jun 2026.
    const r = periodRange('week', new Date(2026, 6, 1, 12))!
    expect(r.start).toEqual(new Date(2026, 5, 29))
  })

  it('week on a Sunday still resolves to the prior Monday', () => {
    // Sun 5 Jul 2026 → Monday is 29 Jun 2026 (Sunday closes the week).
    const r = periodRange('week', new Date(2026, 6, 5, 12))!
    expect(r.start).toEqual(new Date(2026, 5, 29))
  })
})

describe('inPeriod', () => {
  const week = periodRange('week', WED_8_JUL)

  it('a null window matches everything (all-time)', () => {
    expect(inPeriod('2020-01-01T00:00:00Z', null)).toBe(true)
    expect(inPeriod(null, null)).toBe(true)
  })

  it('counts a Monday-morning quote whose UTC date is the prior day', () => {
    // The whole point of comparing instants, not date slices: Mon 6 Jul 08:00
    // LOCAL is inside "This week" even though in a UTC+ zone its UTC date reads
    // as Sunday. Expressed in the local frame here it must be included.
    const monMorning = new Date(2026, 6, 6, 8, 0).toISOString()
    expect(inPeriod(monMorning, week)).toBe(true)
  })

  it('excludes an instant just before the window start', () => {
    // Sun 5 Jul 23:00 local is before Monday midnight → out of "This week".
    const sunNight = new Date(2026, 6, 5, 23, 0).toISOString()
    expect(inPeriod(sunNight, week)).toBe(false)
  })

  it('includes anything created earlier today, up to end-of-day', () => {
    const todayNoon = new Date(2026, 6, 8, 12, 0).toISOString()
    expect(inPeriod(todayNoon, week)).toBe(true)
  })

  it('excludes missing / unparseable timestamps once a window is set', () => {
    expect(inPeriod(null, week)).toBe(false)
    expect(inPeriod('not-a-date', week)).toBe(false)
  })
})
