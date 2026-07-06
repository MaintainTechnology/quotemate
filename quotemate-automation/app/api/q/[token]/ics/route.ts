// GET /api/q/[token]/ics — download an .ics calendar invite for a CONFIRMED
// booking. Token = quotes.share_token (same trust model as /q/[token]).
// 404s until the visit has a time (quotes.scheduled_at): an inspection
// deposit is pay-first, so the invite only exists once the tradie sets a
// time. Pure serialisation lives in lib/quote/calendar (unit-tested); this
// route just resolves the booking fields and streams text/calendar.

import { createClient } from '@supabase/supabase-js'
import { humanizeJobType } from '@/lib/sms/followup-context'
import {
  buildQuoteIcs,
  resolveEventWindow,
  type QuoteCalendarEvent,
} from '@/lib/quote/calendar'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function slugify(s: string | null | undefined): string {
  const out = String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'quotemax'
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, share_token, paid_tier, scheduled_at, scheduled_window, intake_id, tenant_id')
    .eq('share_token', token)
    .maybeSingle()

  if (!quote || !quote.scheduled_at) {
    return Response.json(
      { ok: false, error: 'No confirmed visit time for this quote yet' },
      { status: 404 },
    )
  }

  // Tradie name (best-effort) for the event title + filename.
  let businessName: string | null = null
  if (quote.tenant_id) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('business_name')
      .eq('id', quote.tenant_id as string)
      .maybeSingle()
    businessName = (tenant?.business_name as string | null) ?? null
  }

  // Job label + service address (best-effort) from the intake.
  let jobType: string | null = null
  let location: string | null = null
  if (quote.intake_id) {
    const { data: intake } = await supabase
      .from('intakes')
      .select('job_type, address, suburb')
      .eq('id', quote.intake_id as string)
      .maybeSingle()
    jobType = (intake?.job_type as string | null) ?? null
    location =
      (intake?.address as string | null) ?? (intake?.suburb as string | null) ?? null
  }

  const jobLabel = humanizeJobType(jobType) ?? 'Your job'
  const isInspection = quote.paid_tier === 'inspection'
  const tradie = businessName ?? 'QuoteMax'
  const summary = isInspection ? `Inspection — ${tradie}` : `${jobLabel} — ${tradie}`

  const appUrl = process.env.APP_URL?.replace(/\/$/, '') ?? null
  const link = appUrl && quote.share_token ? `${appUrl}/q/${quote.share_token}` : null
  const description = [
    isInspection
      ? `Site inspection${businessName ? ` with ${businessName}` : ''}.`
      : `Your ${jobLabel} visit${businessName ? ` with ${businessName}` : ''}.`,
    link ? `Quote: ${link}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const { start, end } = resolveEventWindow(
    quote.scheduled_at as string,
    quote.scheduled_window as string | null,
  )

  const event: QuoteCalendarEvent = {
    quoteId: quote.id as string,
    start,
    end,
    summary,
    description,
    location,
  }

  const ics = buildQuoteIcs(event)
  const filename = `${slugify(businessName)}-appointment.ics`

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
