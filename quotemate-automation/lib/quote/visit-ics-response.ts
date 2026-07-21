// lib/quote/visit-ics-response.ts
//
// Pure builder for the /q/roof/[token]/visit.ics HTTP response, split out from
// the route handler so its contract (headers + paid/scheduled gating) is
// testable without a running server or DB. The route just fetches the
// measurement row + tenant identity and delegates here.

import { tzForState } from './availability'
import { formatVisitSlot } from './trade-booking'
import { visitIcsText } from './calendar-links'

export interface VisitIcsRow {
  paid_at: string | null
  scheduled_at: string | null
  scheduled_window: string | null
  address: string | null
  state: string | null
}

/** Build the visit.ics response. 200 with a text/calendar attachment when the
 *  visit is paid AND scheduled; 404 otherwise (a calendar entry only exists
 *  once there is a booked time). */
export function visitIcsResponse(
  row: VisitIcsRow | null,
  businessName: string | null,
  tenantState: string | null,
): Response {
  if (!row || !row.paid_at || !row.scheduled_at) {
    return new Response('Not found', { status: 404 })
  }
  const tradieName = businessName ?? 'Your roofer'
  const tz = tzForState(tenantState ?? row.state ?? null)
  const slotLabel = formatVisitSlot(row.scheduled_at, row.scheduled_window, tz)
  const ics = visitIcsText({
    scheduledAt: row.scheduled_at,
    scheduledWindow: row.scheduled_window,
    tradieName,
    slotLabel,
    // Raw address already ends with the state; fall back to state alone.
    location: row.address?.trim() || row.state || null,
  })
  if (!ics) return new Response('Not found', { status: 404 })

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="site-visit.ics"',
      'Cache-Control': 'no-store',
    },
  })
}
