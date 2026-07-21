import { describe, it, expect } from 'vitest'
import { toCalendarDays } from './calendar-days'
import type { BookingOption } from '@/lib/quote/slots'

function opt(iso: string, dayLabel: string, chipLabel: string): BookingOption {
  return { iso, dayLabel, chipLabel, period: null } as BookingOption
}

describe('toCalendarDays', () => {
  it('groups options onto one day per calendar date', () => {
    const days = toCalendarDays(
      [
        opt('2026-07-27T00:00:00+10:00', 'Mon, 27 July', 'Morning'),
        opt('2026-07-27T04:00:00+10:00', 'Mon, 27 July', 'Afternoon'),
        opt('2026-07-28T00:00:00+10:00', 'Tue, 28 July', 'Morning'),
      ],
      'Australia/Brisbane',
    )
    expect(days).toHaveLength(2)
    expect(days[0].times.map((t) => t.chip)).toEqual(['Morning', 'Afternoon'])
    expect(days[1].times.map((t) => t.chip)).toEqual(['Morning'])
  })

  it('dates each day in the TENANT timezone, not the server one', () => {
    // 2026-07-27T23:30Z is already the 28th in Brisbane (UTC+10). Dating this
    // in UTC would file it under the 27th and the customer would tap the wrong
    // square — the same class of bug as the WA slot that displayed a day late.
    const [day] = toCalendarDays(
      [opt('2026-07-27T23:30:00Z', 'Tue, 28 July', 'Morning')],
      'Australia/Brisbane',
    )
    expect(day.key).toBe('2026-07-28')
    expect(day.date).toBe(28)
    expect(day.monthIndex).toBe(6)
    expect(day.year).toBe(2026)
  })

  it('reports the correct weekday for the grid offset', () => {
    // 27 July 2026 is a Monday.
    const [day] = toCalendarDays(
      [opt('2026-07-27T00:00:00+10:00', 'Mon, 27 July', 'Morning')],
      'Australia/Brisbane',
    )
    expect(day.weekday).toBe(1)
  })

  it('sorts days ascending regardless of input order', () => {
    const days = toCalendarDays(
      [
        opt('2026-08-03T00:00:00+10:00', 'Mon, 3 August', 'Morning'),
        opt('2026-07-27T00:00:00+10:00', 'Mon, 27 July', 'Morning'),
      ],
      'Australia/Brisbane',
    )
    expect(days.map((d) => d.key)).toEqual(['2026-07-27', '2026-08-03'])
  })

  it('carries the server-rendered day label through', () => {
    const [day] = toCalendarDays(
      [opt('2026-07-27T00:00:00+10:00', 'Mon, 27 July', 'Morning')],
      'Australia/Brisbane',
    )
    expect(day.label).toBe('Mon, 27 July')
  })

  it('returns an empty list for no options', () => {
    expect(toCalendarDays([], 'Australia/Sydney')).toEqual([])
  })
})
