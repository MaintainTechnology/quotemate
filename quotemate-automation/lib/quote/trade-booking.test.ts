// formatVisitSlot — the booked-visit label on the roof/paint quote pages and
// in the booking-confirmation SMS. Slot GENERATION is tenant-timezone-correct
// (tzForState), so the echo must render in the same zone or a WA evening slot
// displays as the next Sydney day (the "picked Friday, confirmed the wrong
// day" class of bug).

import { describe, it, expect } from 'vitest'
import { formatVisitSlot } from './trade-booking'

describe('formatVisitSlot', () => {
  it('defaults to Sydney and an explicit Sydney timezone changes nothing', () => {
    const iso = '2026-07-10T09:00:00+10:00'
    expect(formatVisitSlot(iso, 'am')).toBe(formatVisitSlot(iso, 'am', 'Australia/Sydney'))
    expect(formatVisitSlot(iso, 'am')).toMatch(/10 Jul\w* \(morning\)$/) // en-AU CLDR: 'Jul'/'July' varies by ICU
  })

  it('renders the tenant-local day for a WA tenant instead of rolling to the next Sydney day', () => {
    const iso = '2026-07-08T23:00:00+08:00' // 11pm Wed 8 Jul Perth = 1am Thu 9 Jul Sydney
    expect(formatVisitSlot(iso, null, 'Australia/Perth')).toContain('8 Jul')
    expect(formatVisitSlot(iso, null)).toContain('9 Jul') // Sydney default — old behaviour pinned
  })

  it('labels an am window on the tenant-local day', () => {
    expect(formatVisitSlot('2026-07-09T07:00:00+08:00', 'am', 'Australia/Perth')).toMatch(
      /9 Jul\w* \(morning\)$/,
    )
  })
})
