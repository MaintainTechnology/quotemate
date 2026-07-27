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
import { notifyRoofingTradie } from '@/lib/sms/roofing-notify'
import { combinedTotalsForIndices, resolveEffectiveIndices } from '@/lib/roofing/selection'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { pipelineLog } from '@/lib/log/pipeline'

export const maxDuration = 300

/** Columns beyond the shared set that each trade needs for the tradie alert.
 *  The two tables model their headline total differently: roofing keeps the
 *  full multi-structure quote and must be narrowed to the served selection,
 *  painting stores its figure denormalised. */
const TRADE_ALERT_COLUMNS = {
  roof: 'address, quote, included_indices, confirmed_structure',
  paint: 'address, better_inc_gst',
} as const

const TRADE_LABEL = { roof: 'roofing', paint: 'painting' } as const

/**
 * The figure the CUSTOMER was shown, which is what belongs on the tradie's
 * alert. For roofing that is never combined_better_inc_gst: a customer who
 * picked one of three buildings saw $69,652 while that column held $115,117
 * (live token ff6f67ce…). combinedTotalsForIndices is the canonical headline
 * total every other surface derives from, so using it here can't drift.
 */
function servedIncGst(trade: keyof typeof TRADE_ALERT_COLUMNS, row: Record<string, unknown>): number | null {
  if (trade === 'paint') {
    const v = row.better_inc_gst
    return typeof v === 'number' ? v : null
  }
  const quote = (row.quote ?? null) as MultiRoofQuote | null
  if (!quote) return null
  const indices = resolveEffectiveIndices(
    {
      included: (row.included_indices as number[] | null) ?? null,
      confirmedStructure: (row.confirmed_structure as number | null) ?? null,
    },
    quote,
  )
  const total = combinedTotalsForIndices(quote, indices).incGst[1]
  return total > 0 ? total : null
}

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
    .select(
      `id, tenant_id, paid_at, scheduled_at, customer_name, customer_phone, ${TRADE_ALERT_COLUMNS[trade]}`,
    )
    .eq('public_token', token)
    .maybeSingle()
  if (rowErr) {
    log.err('trade job lookup failed', rowErr.message, { trade })
    return Response.json({ ok: false, error: 'Lookup failed' }, { status: 500 })
  }
  if (!row) return Response.json({ ok: false, error: 'Not found' }, { status: 404 })

  // Cast through unknown: the select list is built per trade, so supabase-js
  // cannot resolve the row shape statically.
  const r = row as unknown as {
    id: string
    tenant_id: string | null
    paid_at: string | null
    customer_name: string | null
    customer_phone: string | null
    address: string | null
  } & Record<string, unknown>
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
    const { data: tenant } = await supabase
      .from('tenants')
      .select('twilio_sms_number, state, owner_mobile, owner_first_name')
      .eq('id', r.tenant_id)
      .maybeSingle()
    const t = tenant as {
      twilio_sms_number?: string | null
      state?: string | null
      owner_mobile?: string | null
      owner_first_name?: string | null
    } | null
    const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'
    // The slot was generated in the tenant's state timezone — both SMSes echo
    // in it, from the one formatter, or they name different days for it.
    const timeZone = tzForState(t?.state ?? null)
    const jobUrl = `${appUrl}/q/${trade}/${token}`

    try {
      if (r.customer_phone) {
        const text = buildBookingConfirmationSms({
          firstName: r.customer_name ?? undefined,
          scheduledAt: slot,
          bookingUrl: jobUrl,
          timeZone,
        })
        await dispatchQuoteMessage({
          to: r.customer_phone,
          text,
          from: t?.twilio_sms_number ?? undefined,
        })
      }
    } catch (e) {
      log.err('trade booking SMS threw (booking IS committed)', e instanceof Error ? e.message : String(e), {
        trade,
        id: r.id,
      })
    }

    // Tell the tradie. Its OWN try/catch: a customer-SMS failure must not
    // swallow this one, which is the half that was missing entirely until
    // 2026-07-27 — a paid, booked roofing job reached nobody.
    try {
      await notifyRoofingTradie({
        kind: 'booking_confirmed',
        tenant: {
          owner_mobile: t?.owner_mobile ?? null,
          owner_first_name: t?.owner_first_name ?? null,
          twilio_sms_number: t?.twilio_sms_number ?? null,
        },
        customerName: r.customer_name,
        // A job can reach here with no number on the row (dashboard-created,
        // legacy). Still worth telling the tradie — say so rather than
        // rendering "Customer: " with nothing after it.
        customerPhone: r.customer_phone ?? 'no number on file',
        address: r.address ?? 'address not captured',
        betterIncGst: servedIncGst(trade, r),
        quoteUrl: jobUrl,
        scheduledAt: slot,
        timeZone,
        tradeLabel: TRADE_LABEL[trade],
        dispatch: (o) =>
          dispatchQuoteMessage({
            to: o.to,
            text: o.text,
            from: o.from,
            audience: 'tradie',
            tenantId: r.tenant_id,
          }),
      })
    } catch (e) {
      log.err('tradie booking notify threw (booking IS committed)', e instanceof Error ? e.message : String(e), {
        trade,
        id: r.id,
      })
    }
  })

  // On to the thank-you page, which confirms the booking, shows what was paid
  // and offers the calendar links (spec booking-three-page-split R1/R4).
  return Response.json({ ok: true, scheduled_at: slot, next: `/q/${trade}/${token}/thanks` })
}
