import { describe, it, expect } from 'vitest'
import {
  tzForState,
  STATE_TIMEZONES,
  defaultAvailability,
  defaultAvailabilityForState,
  parseAvailability,
  toMinutes,
  dayToWindows,
  generateAvailabilityWindows,
  bookedWindowKey,
  type WeeklyAvailability,
} from './availability'

// A fixed instant so window generation is deterministic.
// 2026-07-05T22:00:00Z === Mon 2026-07-06 08:00 in Sydney (AEST +10, no DST in July).
const NOW = Date.parse('2026-07-05T22:00:00Z')

describe('tzForState', () => {
  it('maps each AU state to an IANA zone', () => {
    expect(tzForState('NSW')).toBe('Australia/Sydney')
    expect(tzForState('VIC')).toBe('Australia/Sydney')
    expect(tzForState('ACT')).toBe('Australia/Sydney')
    expect(tzForState('TAS')).toBe('Australia/Sydney')
    expect(tzForState('QLD')).toBe('Australia/Brisbane')
    expect(tzForState('SA')).toBe('Australia/Adelaide')
    expect(tzForState('NT')).toBe('Australia/Darwin')
    expect(tzForState('WA')).toBe('Australia/Perth')
  })
  it('falls back to Sydney for unknown/empty', () => {
    expect(tzForState('')).toBe('Australia/Sydney')
    expect(tzForState(null)).toBe('Australia/Sydney')
    expect(tzForState('ZZ')).toBe('Australia/Sydney')
  })
  it('covers all eight states', () => {
    expect(Object.keys(STATE_TIMEZONES).sort()).toEqual(
      ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'],
    )
  })
})

describe('defaultAvailability', () => {
  it('is Mon–Fri 07:00–15:00, weekend off (spec R12)', () => {
    const a = defaultAvailability()
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      expect(a.days[d]).toEqual({ enabled: true, start: '07:00', end: '15:00' })
    }
    expect(a.days.sat.enabled).toBe(false)
    expect(a.days.sun.enabled).toBe(false)
    expect(a.version).toBe(1)
  })
  it('derives timezone from state (spec R13)', () => {
    expect(defaultAvailabilityForState('QLD').timezone).toBe('Australia/Brisbane')
    expect(defaultAvailabilityForState('WA').timezone).toBe('Australia/Perth')
    expect(defaultAvailabilityForState('NSW').timezone).toBe('Australia/Sydney')
  })
})

describe('toMinutes', () => {
  it('parses HH:MM', () => {
    expect(toMinutes('07:00')).toBe(420)
    expect(toMinutes('12:00')).toBe(720)
    expect(toMinutes('15:30')).toBe(930)
  })
  it('rejects malformed input', () => {
    expect(toMinutes('25:00')).toBeNull()
    expect(toMinutes('7:00')).toBeNull()
    expect(toMinutes('')).toBeNull()
    expect(toMinutes(null)).toBeNull()
  })
})

describe('parseAvailability (validation, spec R19)', () => {
  it('accepts a valid default', () => {
    expect(parseAvailability(defaultAvailability())).not.toBeNull()
  })
  it('rejects an enabled day with start >= end', () => {
    const bad = defaultAvailability()
    bad.days.mon = { enabled: true, start: '15:00', end: '07:00' }
    expect(parseAvailability(bad)).toBeNull()
  })
  it('rejects an enabled day missing times', () => {
    const bad = defaultAvailability()
    bad.days.tue = { enabled: true, start: null, end: null }
    expect(parseAvailability(bad)).toBeNull()
  })
  it('allows a disabled day to omit times', () => {
    const ok = defaultAvailability()
    ok.days.sat = { enabled: false, start: null, end: null }
    expect(parseAvailability(ok)).not.toBeNull()
  })
  it('rejects junk', () => {
    expect(parseAvailability(null)).toBeNull()
    expect(parseAvailability({ version: 1 })).toBeNull()
    expect(parseAvailability({ version: 1, timezone: 'X', days: {} })).toBeNull()
  })
})

describe('dayToWindows (AM/PM split at noon, spec R14)', () => {
  it('splits a full day into AM and PM', () => {
    const w = dayToWindows({ enabled: true, start: '07:00', end: '15:00' })
    expect(w.am).toEqual({ startMin: 420, endMin: 720 })
    expect(w.pm).toEqual({ startMin: 720, endMin: 900 })
  })
  it('morning-only hours yield AM only', () => {
    const w = dayToWindows({ enabled: true, start: '07:00', end: '11:00' })
    expect(w.am).toEqual({ startMin: 420, endMin: 660 })
    expect(w.pm).toBeNull()
  })
  it('afternoon-only hours yield PM only', () => {
    const w = dayToWindows({ enabled: true, start: '13:00', end: '17:00' })
    expect(w.am).toBeNull()
    expect(w.pm).toEqual({ startMin: 780, endMin: 1020 })
  })
  it('disabled / malformed day yields neither', () => {
    expect(dayToWindows({ enabled: false, start: null, end: null })).toEqual({ am: null, pm: null })
    expect(dayToWindows({ enabled: true, start: '15:00', end: '07:00' })).toEqual({ am: null, pm: null })
  })
})

describe('generateAvailabilityWindows (spec R14–R16)', () => {
  const av = defaultAvailability('Australia/Sydney')

  it('produces only AM/PM windows on enabled weekdays', () => {
    const wins = generateAvailabilityWindows(av, NOW)
    expect(wins.length).toBeGreaterThan(0)
    for (const w of wins) {
      expect(w.period === 'am' || w.period === 'pm').toBe(true)
      // weekend is disabled in the default template
      expect(w.display.startsWith('Sat')).toBe(false)
      expect(w.display.startsWith('Sun')).toBe(false)
    }
  })

  it('never returns a window starting in the past', () => {
    const wins = generateAvailabilityWindows(av, NOW)
    for (const w of wins) {
      expect(Date.parse(w.iso)).toBeGreaterThanOrEqual(NOW)
    }
  })

  it('excludes Monday morning (already past at 08:00) but keeps Monday afternoon', () => {
    const wins = generateAvailabilityWindows(av, NOW)
    const mon = wins.filter((w) => w.date === '2026-07-06')
    expect(mon.find((w) => w.period === 'am')).toBeUndefined()
    expect(mon.find((w) => w.period === 'pm')).toBeDefined()
  })

  it('excludes windows already booked (by key)', () => {
    const all = generateAvailabilityWindows(av, NOW)
    const target = all[0]
    const filtered = generateAvailabilityWindows(av, NOW, new Set([target.key]))
    expect(filtered.find((w) => w.key === target.key)).toBeUndefined()
    expect(filtered.length).toBe(all.length - 1)
  })

  it('is deterministic for a fixed now', () => {
    expect(generateAvailabilityWindows(av, NOW)).toEqual(generateAvailabilityWindows(av, NOW))
  })

  it('respects maxWindows', () => {
    const wins = generateAvailabilityWindows(av, NOW, new Set(), { maxWindows: 3 })
    expect(wins.length).toBeLessThanOrEqual(3)
  })

  it('returns nothing when all days are disabled (spec edge case)', () => {
    const off: WeeklyAvailability = defaultAvailability()
    for (const k of Object.keys(off.days) as (keyof typeof off.days)[]) {
      off.days[k] = { enabled: false, start: null, end: null }
    }
    expect(generateAvailabilityWindows(off, NOW)).toEqual([])
  })
})

describe('bookedWindowKey', () => {
  const tz = 'Australia/Sydney'
  it('uses the stored period when present', () => {
    // 2026-07-06T02:00:00Z === Mon 12:00 Sydney → pm
    expect(bookedWindowKey('2026-07-06T02:00:00Z', 'pm', tz)).toBe('2026-07-06:pm')
  })
  it('derives period from the local hour for legacy bookings', () => {
    // 2026-07-05T23:00:00Z === Mon 09:00 Sydney → am
    expect(bookedWindowKey('2026-07-05T23:00:00Z', null, tz)).toBe('2026-07-06:am')
    // 2026-07-06T05:00:00Z === Mon 15:00 Sydney → pm
    expect(bookedWindowKey('2026-07-06T05:00:00Z', null, tz)).toBe('2026-07-06:pm')
  })
  it('returns null for missing/unparseable input', () => {
    expect(bookedWindowKey(null, 'am', tz)).toBeNull()
    expect(bookedWindowKey('not-a-date', 'am', tz)).toBeNull()
  })
  it('round-trips a generated window key', () => {
    const wins = generateAvailabilityWindows(defaultAvailability(tz), NOW)
    const w = wins[0]
    expect(bookedWindowKey(w.iso, w.period, tz)).toBe(w.key)
  })
})
