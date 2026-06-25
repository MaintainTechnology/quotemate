// Rolling booking-slot generator — regression coverage.
//
// The bug this guards against: a tenant's static `available_slots` decays
// to all-past, so the picker shows "no upcoming slots" forever. The fix
// (rollingSlots / resolveBookableSlots) must ALWAYS surface future,
// weekday, Sydney-business-hour times, while still letting a tenant's own
// future slots win. Tests pin `now` so they're deterministic.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SLOT_OPTS,
  futureStoredSlots,
  resolveBookableSlots,
  resolveBookingOptions,
  buildBookedKeys,
  rollingSlots,
} from './slots'
import { defaultAvailability } from './availability'

// A fixed reference instant: Fri 2026-06-05, 04:00 UTC (14:00 Sydney).
const NOW = Date.parse('2026-06-05T04:00:00.000Z')

// The Sydney-local hour for an instant — used to assert DST-correct times.
function sydneyHour(iso: string): number {
  const h = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(iso))
  return Number(h) % 24
}

// The Sydney-local weekday (0 Sun … 6 Sat) for an instant.
function sydneyDow(iso: string): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
  }).format(new Date(iso))
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? -1
}

describe('rollingSlots', () => {
  it('returns a non-empty, capped window of future slots', () => {
    const slots = rollingSlots(NOW)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.length).toBeLessThanOrEqual(DEFAULT_SLOT_OPTS.maxSlots)
  })

  it('every slot is a parseable ISO instant strictly in the future', () => {
    for (const s of rollingSlots(NOW)) {
      const t = Date.parse(s)
      expect(Number.isFinite(t)).toBe(true)
      expect(t).toBeGreaterThan(NOW)
    }
  })

  it('respects the minimum lead time', () => {
    const earliest = NOW + DEFAULT_SLOT_OPTS.minLeadHours * 3600_000
    for (const s of rollingSlots(NOW)) {
      expect(Date.parse(s)).toBeGreaterThanOrEqual(earliest)
    }
  })

  it('only offers weekdays at Sydney business hours', () => {
    for (const s of rollingSlots(NOW)) {
      expect([1, 2, 3, 4, 5]).toContain(sydneyDow(s)) // Mon–Fri
      expect(DEFAULT_SLOT_OPTS.hours).toContain(sydneyHour(s))
    }
  })

  it('returns slots sorted ascending by time', () => {
    const slots = rollingSlots(NOW)
    const sorted = [...slots].sort((a, b) => Date.parse(a) - Date.parse(b))
    expect(slots).toEqual(sorted)
  })

  it('is deterministic for a fixed now', () => {
    expect(rollingSlots(NOW)).toEqual(rollingSlots(NOW))
  })

  it('is DST-correct: summer slots carry +11:00, winter slots +10:00', () => {
    // January = Sydney daylight saving (+11:00).
    const summer = rollingSlots(Date.parse('2026-01-05T00:00:00.000Z'))
    expect(summer.length).toBeGreaterThan(0)
    for (const s of summer) {
      expect(s.endsWith('+11:00')).toBe(true)
      expect(DEFAULT_SLOT_OPTS.hours).toContain(sydneyHour(s))
    }
    // July = Sydney standard time (+10:00).
    const winter = rollingSlots(Date.parse('2026-07-06T00:00:00.000Z'))
    expect(winter.length).toBeGreaterThan(0)
    for (const s of winter) {
      expect(s.endsWith('+10:00')).toBe(true)
      expect(DEFAULT_SLOT_OPTS.hours).toContain(sydneyHour(s))
    }
  })

  it('honours custom hours and cap', () => {
    const slots = rollingSlots(NOW, { hours: [8], maxSlots: 3 })
    expect(slots.length).toBe(3)
    for (const s of slots) expect(sydneyHour(s)).toBe(8)
  })
})

describe('futureStoredSlots', () => {
  it('drops past slots, keeps future ones, sorted', () => {
    const stored = [
      '2026-06-09T09:00:00+10:00', // future
      '2026-05-19T09:00:00+10:00', // past
      '2026-06-08T12:00:00+10:00', // future (earlier)
    ]
    expect(futureStoredSlots(stored, NOW)).toEqual([
      '2026-06-08T12:00:00+10:00',
      '2026-06-09T09:00:00+10:00',
    ])
  })

  it('de-duplicates identical slots', () => {
    const stored = [
      '2026-06-09T09:00:00+10:00',
      '2026-06-09T09:00:00+10:00',
    ]
    expect(futureStoredSlots(stored, NOW)).toEqual(['2026-06-09T09:00:00+10:00'])
  })

  it('tolerates junk input', () => {
    expect(futureStoredSlots(null, NOW)).toEqual([])
    expect(futureStoredSlots(undefined, NOW)).toEqual([])
    expect(futureStoredSlots('not-an-array', NOW)).toEqual([])
    expect(futureStoredSlots([42, {}, 'nonsense', null], NOW)).toEqual([])
  })
})

describe('resolveBookableSlots — the fix', () => {
  it('curated future slots win over the rolling default', () => {
    const stored = ['2026-06-09T09:00:00+10:00', '2026-06-10T15:00:00+10:00']
    expect(resolveBookableSlots(stored, NOW)).toEqual([
      '2026-06-09T09:00:00+10:00',
      '2026-06-10T15:00:00+10:00',
    ])
  })

  it('all-past stored slots fall back to a generated rolling window (the actual prod bug)', () => {
    // Exactly the production state: 30 May slots, every one now in the past.
    const allPast = Array.from({ length: 30 }, (_, i) =>
      `2026-05-${String(19 + (i % 10)).padStart(2, '0')}T09:00:00+10:00`,
    )
    const resolved = resolveBookableSlots(allPast, NOW)
    expect(resolved.length).toBeGreaterThan(0)
    for (const s of resolved) expect(Date.parse(s)).toBeGreaterThan(NOW)
  })

  it('empty stored slots fall back to a generated rolling window', () => {
    expect(resolveBookableSlots([], NOW).length).toBeGreaterThan(0)
    expect(resolveBookableSlots(null, NOW).length).toBeGreaterThan(0)
  })

  it('page and API derive the identical list for the same now (no book 409)', () => {
    // The page renders from resolveBookableSlots; the API validates the
    // picked slot against resolveBookableSlots. They MUST match exactly.
    const pageList = resolveBookableSlots([], NOW)
    const apiList = resolveBookableSlots([], NOW)
    expect(pageList).toEqual(apiList)
    for (const picked of pageList) expect(apiList).toContain(picked)
  })
})

describe('resolveBookingOptions (availability template vs legacy)', () => {
  it('uses the weekly template → AM/PM windows when availability is set', () => {
    const opts = resolveBookingOptions({
      availability: defaultAvailability('Australia/Sydney'),
      availableSlots: [],
      now: NOW,
    })
    expect(opts.length).toBeGreaterThan(0)
    for (const o of opts) {
      expect(o.period === 'am' || o.period === 'pm').toBe(true)
      expect(o.chipLabel.length).toBeGreaterThan(0)
    }
  })

  it('falls back to legacy exact-time slots when no template is set', () => {
    const opts = resolveBookingOptions({ availability: null, availableSlots: [], now: NOW })
    expect(opts.length).toBeGreaterThan(0)
    for (const o of opts) expect(o.period).toBeNull()
  })

  it('falls back when the template is malformed', () => {
    const opts = resolveBookingOptions({
      availability: { version: 1, timezone: 'X', days: {} },
      availableSlots: [],
      now: NOW,
    })
    expect(opts.every((o) => o.period === null)).toBe(true)
  })

  it('page and API agree (same inputs → identical options)', () => {
    const args = { availability: defaultAvailability('Australia/Sydney'), availableSlots: [], now: NOW }
    expect(resolveBookingOptions(args)).toEqual(resolveBookingOptions(args))
  })

  it('excludes a window already booked by another quote', () => {
    const av = defaultAvailability('Australia/Sydney')
    const all = resolveBookingOptions({ availability: av, availableSlots: [], now: NOW })
    const target = all[0]
    const bookedKeys = buildBookedKeys(
      [{ scheduled_at: target.iso, scheduled_window: target.period }],
      'Australia/Sydney',
    )
    const filtered = resolveBookingOptions({ availability: av, availableSlots: [], now: NOW, bookedKeys })
    expect(filtered.find((o) => o.iso === target.iso)).toBeUndefined()
  })
})

describe('buildBookedKeys', () => {
  it('builds keys from booked rows and skips null/unparseable slots', () => {
    const keys = buildBookedKeys(
      [
        { scheduled_at: '2026-06-08T23:00:00Z', scheduled_window: 'am' },
        { scheduled_at: null, scheduled_window: 'pm' },
        { scheduled_at: 'nope', scheduled_window: null },
      ],
      'Australia/Sydney',
    )
    expect(keys.size).toBe(1)
  })
})
