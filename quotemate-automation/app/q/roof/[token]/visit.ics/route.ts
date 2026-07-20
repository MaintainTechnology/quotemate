// GET /q/roof/[token]/visit.ics — the booked site visit as a downloadable
// calendar file. Served from a real route (not a data: URI) with a proper
// text/calendar Content-Type + attachment disposition, which is the reliable
// "Add to Calendar" path on iOS Safari (it ignores the download attribute on
// data: URIs). Covers Apple Calendar, Outlook desktop / M365 and Thunderbird.
//
// Next 16: params is a Promise (await it).

import { createClient } from '@supabase/supabase-js'
import { loadTenantIdentity } from '@/lib/quote/tenant-identity'
import { tzForState } from '@/lib/quote/availability'
import { formatVisitSlot } from '@/lib/quote/trade-booking'
import { visitIcsText } from '@/lib/quote/calendar-links'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const supabase = getSupabase()

  const { data: row } = await supabase
    .from('roofing_measurements')
    .select('tenant_id, address, state, paid_at, scheduled_at, scheduled_window')
    .eq('public_token', token)
    .maybeSingle()
  // Only a paid, scheduled visit has a calendar entry.
  if (!row || !row.paid_at || !row.scheduled_at) {
    return new Response('Not found', { status: 404 })
  }

  const identity = await loadTenantIdentity(supabase, (row.tenant_id as string | null) ?? null)
  const tradieName = identity?.business_name ?? 'Your roofer'
  const tz = tzForState(identity?.state ?? (row.state as string | null) ?? null)
  const scheduledWindow = (row.scheduled_window as string | null) ?? null
  const slotLabel = formatVisitSlot(row.scheduled_at as string, scheduledWindow, tz)

  const ics = visitIcsText({
    scheduledAt: row.scheduled_at as string,
    scheduledWindow,
    tradieName,
    slotLabel,
    // Raw address already ends with the state; fall back to state alone.
    location: (row.address as string | null)?.trim() || (row.state as string | null) || null,
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
