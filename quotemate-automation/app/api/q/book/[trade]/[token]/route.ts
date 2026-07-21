// Self-serve visit booking for the dedicated trade surfaces — roofing
// (/q/roof/[token]) and painting (/q/paint/[token]) — whose jobs live in
// roofing_measurements / painting_measurements, NOT the quotes table. The
// quotes book route (/api/q/[token]/book) doesn't apply here, so this is the
// parallel for those tables: validate the chosen half-day window the SAME way
// (loadTenantBookingOptions → resolveBookingOptions), stamp scheduled_at +
// scheduled_window, and text the customer a confirmation.
//
// These jobs book AFTER paying the deposit / $99 site visit (that's the "order"
// the customer places), so we require paid_at before accepting a slot. Re-picks
// are allowed (overwrite) until the tradie confirms on site.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  TRADE_BOOKING_TABLES,
  isTradeBookingKey,
  loadTenantBookingOptions,
} from '@/lib/quote/trade-booking'
import { tzForState } from '@/lib/quote/availability'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { buildBookingConfirmationSms } from '@/lib/sms/templates'
import { pipelineLog } from '@/lib/log/pipeline'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(
  req: Request,
  ctx: { params: Promise<{ trade: string; token: string }> },
) {
  const log = pipelineLog('dispatch')
  const { trade, token } = await ctx.params
  if (!isTradeBookingKey(trade)) {
    return Response.json({ ok: false, error: 'Unknown trade' }, { status: 404 })
  }
  const table = TRADE_BOOKING_TABLES[trade]

  let body: { slot?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const slot = typeof body.slot === 'string' ? body.slot : null
  if (!slot) return Response.json({ ok: false, error: 'slot is required' }, { status: 400 })
  const slotMs = Date.parse(slot)
  if (!Number.isFinite(slotMs)) {
    return Response.json({ ok: false, error: 'slot is not a valid ISO timestamp' }, { status: 400 })
  }
  if (slotMs <= Date.now()) {
    return Response.json({ ok: false, error: 'slot must be in the future' }, { status: 400 })
  }

  const { data: row, error: rowErr } = await supabase
    .from(table)
    .select('id, tenant_id, paid_at, scheduled_at, customer_name, customer_phone')
    .eq('public_token', token)
    .maybeSingle()
  if (rowErr) {
    log.err('trade job lookup failed', rowErr.message, { trade })
    return Response.json({ ok: false, error: 'Lookup failed' }, { status: 500 })
  }
  if (!row) return Response.json({ ok: false, error: 'Not found' }, { status: 404 })

  const r = row as {
    id: string
    tenant_id: string | null
    paid_at: string | null
    customer_name: string | null
    customer_phone: string | null
  }
  if (!r.tenant_id) {
    return Response.json({ ok: false, error: 'No tradie configured' }, { status: 409 })
  }
  // Booking follows the order — the deposit/$99 must be paid first.
  if (!r.paid_at) {
    return Response.json(
      { ok: false, error: 'Pay the deposit first, then pick your time.' },
      { status: 409 },
    )
  }

  const options = await loadTenantBookingOptions(supabase, {
    tenantId: r.tenant_id,
    table,
    excludeId: r.id,
  })
  const chosen = options.find((o) => o.iso === slot)
  if (!chosen) {
    log.err('trade slot not available', null, { trade, slot })
    return Response.json({ ok: false, error: 'That time is no longer available' }, { status: 409 })
  }

  const { error: updErr } = await supabase
    .from(table)
    .update({ scheduled_at: slot, scheduled_window: chosen.period })
    .eq('id', r.id)
  if (updErr) {
    log.err('trade booking write failed', updErr.message, { trade, id: r.id })
    return Response.json({ ok: false, error: 'Failed to book that time' }, { status: 500 })
  }
  log.ok('trade visit booked', { trade, id: r.id, slot })

  // Confirmation SMS — best-effort, deferred so the response is fast and a
  // failed text never undoes the booking (mirrors notifyBookingConfirmed).
  after(async () => {
    try {
      if (!r.customer_phone) return
      const { data: tenant } = await supabase
        .from('tenants')
        .select('twilio_sms_number, state')
        .eq('id', r.tenant_id)
        .maybeSingle()
      const t = tenant as { twilio_sms_number?: string | null; state?: string | null } | null
      const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'
      const text = buildBookingConfirmationSms({
        firstName: r.customer_name ?? undefined,
        scheduledAt: slot,
        bookingUrl: `${appUrl}/q/${trade}/${token}`,
        // The slot was generated in the tenant's state timezone — echo in it too.
        timeZone: tzForState(t?.state ?? null),
      })
      await dispatchQuoteMessage({
        to: r.customer_phone,
        text,
        from: t?.twilio_sms_number ?? undefined,
      })
    } catch (e) {
      log.err('trade booking SMS threw (booking IS committed)', e instanceof Error ? e.message : String(e), {
        trade,
        id: r.id,
      })
    }
  })

  // On to the thank-you page, which confirms the booking, shows what was paid
  // and offers the calendar links (spec booking-three-page-split R1/R4).
  return Response.json({ ok: true, scheduled_at: slot, next: `/q/${trade}/${token}/thanks` })
}
