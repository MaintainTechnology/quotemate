// Group bookable windows into the month-grid model BookingCalendar renders.
//
// Lives in its own (server-safe) module so all three /book pages share one
// implementation instead of copying the timezone maths — BookingCalendar.tsx
// is 'use client', and this runs during the server render.
//
// TIMEZONE: dating happens in the TENANT's zone, not the server's. Slots are
// generated in the tenant's state timezone (tzForState), so filing a
// 2026-07-27T23:30Z window under "27 July" would put a Brisbane customer's
// Tuesday morning on Monday's square — the same class of bug as the WA slot
// that confirmed a day late (lib/quote/trade-booking.test.ts:17).

import type { BookingOption } from '@/lib/quote/slots'
import type { CalendarDay } from './BookingCalendar'

export function toCalendarDays(
  options: BookingOption[],
  timeZone: string,
): CalendarDay[] {
  // en-CA gives a sortable YYYY-MM-DD, and the timeZone option does the
  // conversion for us — no manual offset arithmetic to get wrong.
  const keyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const byKey = new Map<string, CalendarDay>()
  for (const o of options) {
    const key = keyFmt.format(new Date(o.iso))
    let day = byKey.get(key)
    if (!day) {
      const [y, m, d] = key.split('-').map(Number)
      // Midday UTC so the weekday can't slip across a date boundary.
      const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
      day = {
        key,
        year: y,
        monthIndex: m - 1,
        date: d,
        weekday,
        label: o.dayLabel,
        times: [],
      }
      byKey.set(key, day)
    }
    day.times.push({ iso: o.iso, chip: o.chipLabel })
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}
