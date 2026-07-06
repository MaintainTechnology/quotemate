import { describe, expect, it } from 'vitest'
import {
  buildGoogleCalendarUrl,
  buildQuoteIcs,
  resolveEventWindow,
  type QuoteCalendarEvent,
} from './calendar'

const baseEvent: QuoteCalendarEvent = {
  quoteId: '055f1dd4-4e8f-4802-ac9a-ab38a6fe2ed8',
  start: new Date('2026-07-11T22:00:00.000Z'),
  end: new Date('2026-07-12T02:00:00.000Z'),
  summary: 'Power Points — Sparky, Co',
  description: 'Your visit.\nQuote: https://x.test/q/abc',
  location: '670 London Road, Chandler',
}

describe('resolveEventWindow', () => {
  it('am/pm half-day window → 4h duration', () => {
    const { start, end } = resolveEventWindow('2026-07-11T22:00:00.000Z', 'am')
    expect(end.getTime() - start.getTime()).toBe(4 * 60 * 60 * 1000)
    expect(resolveEventWindow('2026-07-11T22:00:00.000Z', 'pm').end.getTime() - start.getTime()).toBe(
      4 * 60 * 60 * 1000,
    )
  })
  it('legacy exact-time slot (null window) → 2h duration', () => {
    const { start, end } = resolveEventWindow('2026-07-11T22:00:00.000Z', null)
    expect(end.getTime() - start.getTime()).toBe(2 * 60 * 60 * 1000)
  })
  it('start is exactly the scheduled instant', () => {
    expect(resolveEventWindow('2026-07-11T22:00:00.000Z', 'am').start.toISOString()).toBe(
      '2026-07-11T22:00:00.000Z',
    )
  })
})

describe('buildQuoteIcs', () => {
  const ics = buildQuoteIcs(baseEvent)

  it('emits the core VCALENDAR/VEVENT structure', () => {
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
  })
  it('UID + DTSTAMP are deterministic (no Date.now())', () => {
    expect(ics).toContain('UID:055f1dd4-4e8f-4802-ac9a-ab38a6fe2ed8@quotemate')
    expect(ics).toContain('DTSTAMP:20260711T220000Z')
    // Identical input → byte-identical output.
    expect(buildQuoteIcs(baseEvent)).toBe(ics)
  })
  it('datetimes are absolute UTC (Z)', () => {
    expect(ics).toContain('DTSTART:20260711T220000Z')
    expect(ics).toContain('DTEND:20260712T020000Z')
  })
  it('RFC-escapes commas and newlines in text fields', () => {
    expect(ics).toContain('SUMMARY:Power Points — Sparky\\, Co')
    expect(ics).toContain('DESCRIPTION:Your visit.\\nQuote: https://x.test/q/abc')
  })
  it('omits LOCATION when unknown', () => {
    const noLoc = buildQuoteIcs({ ...baseEvent, location: null })
    expect(noLoc).not.toContain('LOCATION:')
  })
})

describe('buildGoogleCalendarUrl', () => {
  const url = buildGoogleCalendarUrl(baseEvent)
  it('points at the Google render endpoint with a TEMPLATE action', () => {
    expect(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE')).toBe(true)
  })
  it('carries the start/end range as UTC stamps split by a literal slash', () => {
    expect(url).toContain('dates=20260711T220000Z/20260712T020000Z')
  })
  it('URL-encodes free-text fields', () => {
    expect(url).toContain(`text=${encodeURIComponent('Power Points — Sparky, Co')}`)
    expect(url).toContain(`location=${encodeURIComponent('670 London Road, Chandler')}`)
  })
})
