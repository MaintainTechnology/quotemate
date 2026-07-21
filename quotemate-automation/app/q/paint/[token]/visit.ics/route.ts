// GET /q/paint/[token]/visit.ics — the booked painting visit as a downloadable
// calendar file. Served from a real route (not a data: URI) with a proper
// text/calendar Content-Type + attachment disposition, which is the reliable
// "Add to Calendar" path on iOS Safari (it ignores the download attribute on
// data: URIs). Covers Apple Calendar, Outlook desktop / M365 and Thunderbird.
//
// The response contract lives in lib/quote/visit-ics-response (visitIcsResponse)
// so it is unit-tested without a server/DB; this route is just the data fetch.
//
// Next 16: params is a Promise (await it).

import { createClient } from '@supabase/supabase-js'
import { loadTenantIdentity } from '@/lib/quote/tenant-identity'
import { visitIcsResponse } from '@/lib/quote/visit-ics-response'

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
    .from('painting_measurements')
    .select('tenant_id, address, state, paid_at, scheduled_at, scheduled_window')
    .eq('public_token', token)
    .maybeSingle()

  // Load identity only for an existing row (visitIcsResponse handles the
  // paid/scheduled 404 gating).
  const identity = row?.tenant_id
    ? await loadTenantIdentity(supabase, row.tenant_id as string)
    : null

  return visitIcsResponse(
    row
      ? {
          paid_at: (row.paid_at as string | null) ?? null,
          scheduled_at: (row.scheduled_at as string | null) ?? null,
          scheduled_window: (row.scheduled_window as string | null) ?? null,
          address: (row.address as string | null) ?? null,
          state: (row.state as string | null) ?? null,
        }
      : null,
    // visitIcsResponse's own fallback name is "Your roofer" — pass the painting
    // wording explicitly so an unnamed tenant never says roofer on a paint job.
    identity?.business_name ?? 'Your painter',
    identity?.state ?? null,
  )
}
