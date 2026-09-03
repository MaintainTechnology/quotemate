// Booking endpoint — called by BookingCalendar on /q/<token>/book.
//
// PAY FIRST, BOOK SECOND (2026-07-22). The deposit is already paid by the
// time the customer reaches this route, so picking a time is the FINAL step:
// it writes status='accepted' + booking_state='booked', prunes the slot from
// the tenant's availability, fires the confirmation SMS, and hands back
// /q/<token>/thanks as `next`.
//
// [History: under the WP6 book-first order this route only RESERVED a slot on
// an unpaid quote and the Stripe webhook finalised on payment. That split is
// gone — every booking here is post-payment. See
// docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md R5.]
//
// Because payment precedes booking, an abandoned checkout can no longer
// strand a slot: nothing is held until money has changed hands.
//
// Hardening rules:
//   - share_token must resolve to a quote
//   - the quote must be PAID (409 otherwise) — booking follows the order
//   - if the quote is already PAID + scheduled → already booked (409)
//   - slot must be one the server itself offers (resolveBookingOptions)
//   - slot must be a parseable ISO timestamp in the future

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pipelineLog } from '@/lib/log/pipeline'
import { BOOKING_STATE, isPriceHoldExpired } from '@/lib/quote/hold'
import { resolveNextTier } from '@/lib/quote/booking'
import { resolveBookingOptions, buildBookedKeys } from '@/lib/quote/slots'
import { tzForState } from '@/lib/quote/availability'
import { notifyBookingConfirmed } from '@/lib/quote/booking-notify'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const log = pipelineLog('dispatch')
  const { token } = await ctx.params
  log.step('slot reservation attempt', { token: token.slice(0, 8) + '…' })

  let body: { slot?: unknown; tier?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const slot = typeof body.slot === 'string' ? body.slot : null
  if (!slot) {
    return Response.json({ ok: false, error: 'slot is required' }, { status: 400 })
  }

  const slotMs = Date.parse(slot)
  if (!Number.isFinite(slotMs)) {
    return Response.json({ ok: false, error: 'slot is not a valid ISO timestamp' }, { status: 400 })
  }
  if (slotMs <= Date.now()) {
    return Response.json({ ok: false, error: 'slot must be in the future' }, { status: 400 })
  }

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .select('id, paid_at, scheduled_at, selected_tier, share_token, intake_id, tenant_id, good, better, best, stripe_links, created_at, price_hold_until, needs_inspection, quote_kind')
    .eq('share_token', token)
    .maybeSingle()

  if (quoteErr) {
    log.err('quote lookup failed', quoteErr.message)
    return Response.json({ ok: false, error: 'Lookup failed' }, { status: 500 })
  }
  if (!quote) {
    return Response.json({ ok: false, error: 'Quote not found' }, { status: 404 })
  }
  // A post-site-visit child ('final'/'balance') has no visit to book — the
  // site visit is what created it (spec post-visit-money-sequence R11).
  // Booking one would stamp a phantom appointment, prune a real slot out of
  // the tenant's availability, and fire the tradie's "booked and paid the
  // deposit" SMS for a job with no time attached. The /book PAGE redirects
  // children; this is the API-level guard behind it.
  {
    const kind = (quote as { quote_kind?: string | null }).quote_kind ?? null
    if (kind === 'final' || kind === 'balance') {
      return Response.json(
        { ok: false, error: 'This payment has no visit to book.' },
        { status: 409 },
      )
    }
  }

  // Already booked + paid → terminal, don't let them re-pick.
  if (quote.paid_at && quote.scheduled_at) {
    return Response.json(
      { ok: false, error: 'This quote is already booked' },
      { status: 409 },
    )
  }

  // PAY-FIRST on every tier (2026-07-22). Booking follows the order the
  // customer placed, matching the dedicated trade surfaces
  // (app/api/q/book/[trade]/[token]: "these jobs book AFTER paying"). Was
  // inspection-only under the WP6 book-first order.
  const requestedTier = typeof body.tier === 'string' ? body.tier : null
  if (!quote.paid_at) {
    return Response.json(
      { ok: false, error: 'Pay the deposit first, then pick your time.' },
      { status: 409 },
    )
  }

  // Price-hold gate (defense in depth for the UI block): a lapsed price must
  // not be booked against a stale figure. Already-paid quotes (legacy
  // paid-then-pick recovery) have transacted and may still pick a time.
  // Inspection-required quotes are exempt — their prices are indicative
  // (final price confirmed on-site), matching /q and /r.
  if (
    !quote.paid_at &&
    !quote.needs_inspection &&
    isPriceHoldExpired(
      (quote as { price_hold_until?: string | null }).price_hold_until ?? null,
      (quote as { created_at?: string | null }).created_at ?? null,
    )
  ) {
    log.step('booking blocked — price hold expired', { quote_id: quote.id })
    return Response.json(
      {
        ok: false,
        error:
          "This quote's price has expired. Reply to your tradie's SMS for a refreshed quote.",
      },
      { status: 409 },
    )
  }

  // Read the owning tenant's slot list. Mig 062 moved `available_slots`
  // off the legacy `tradies` table and onto `tenants` so each tradie has
  // their own slots; the orphan-tenant case (quote.tenant_id IS NULL) is
  // a Phase-3 cleanup target — those quotes were never sent, so this
  // path never fires for them in production.
  if (!quote.tenant_id) {
    log.err('quote has no tenant_id', null, { quote_id: quote.id })
    return Response.json({ ok: false, error: 'No tradie configured' }, { status: 409 })
  }
  const { data: tenantSlots, error: slotsErr } = await supabase
    .from('tenants')
    .select('id, available_slots, default_availability, state')
    .eq('id', quote.tenant_id)
    .maybeSingle()

  if (slotsErr) {
    log.err('tenant slot lookup failed', slotsErr.message)
    return Response.json({ ok: false, error: 'Lookup failed' }, { status: 500 })
  }
  if (!tenantSlots) {
    return Response.json({ ok: false, error: 'No tradie configured' }, { status: 409 })
  }

  // The bookable set MUST be derived the same way the booking page renders
  // it (resolveBookingOptions): AM/PM half-day windows from the tenant's
  // weekly availability template when set — with already-booked windows
  // excluded — otherwise the legacy curated/rolling exact-time slots.
  // Validating against the raw stored list would 409 every customer once a
  // static seed decayed to all-past, and would reject the windows the page
  // now offers.
  const tz = tzForState(tenantSlots.state as string | null)
  const { data: bookedRows } = await supabase
    .from('quotes')
    .select('scheduled_at, scheduled_window')
    .eq('tenant_id', quote.tenant_id)
    .in('booking_state', ['reserved', 'booked'])
    .not('scheduled_at', 'is', null)
    .neq('id', quote.id)
  const bookedKeys = buildBookedKeys(bookedRows ?? [], tz)

  const options = resolveBookingOptions({
    availability: tenantSlots.default_availability ?? null,
    availableSlots: tenantSlots.available_slots,
    timezone: tz,
    bookedKeys,
  })
  const chosen = options.find((o) => o.iso === slot)

  if (!chosen) {
    log.err('slot not available', null, {
      slot,
      bookable: options.slice(0, 10).map((o) => o.iso),
    })
    return Response.json({ ok: false, error: 'That slot is no longer available' }, { status: 409 })
  }

  const nowIso = new Date().toISOString()

  // Every booking here is post-payment now, so this is always the FINAL step:
  // booked + accepted, prune the slot, send the confirmation SMS. (Under
  // book-first this route only RESERVED, and the Stripe webhook finalised on
  // payment; that split is gone with the pay-first reversal.)
  const { error: quoteUpdateErr } = await supabase
    .from('quotes')
    .update({
      scheduled_at: slot,
      scheduled_window: chosen.period, // 'am' | 'pm' | null (legacy exact-time)
      booking_state: BOOKING_STATE.BOOKED,
      status: 'accepted',
      accepted_at: nowIso,
      last_status_at: nowIso,
    })
    .eq('id', quote.id)

  if (quoteUpdateErr) {
    log.err('quote booking failed', quoteUpdateErr.message, { quote_id: quote.id })
    return Response.json({ ok: false, error: 'Failed to book that time' }, { status: 500 })
  }

  // Prune the chosen slot from the tenant's curated list (if present) and fire
  // the confirmation SMS. Best-effort — the booking is already recorded above,
  // so neither failure may undo it.
  try {
    const stored = Array.isArray(tenantSlots.available_slots)
      ? (tenantSlots.available_slots as string[])
      : []
    if (stored.includes(slot)) {
      await supabase
        .from('tenants')
        .update({ available_slots: stored.filter((s) => s !== slot) })
        .eq('id', tenantSlots.id)
    }
  } catch (e: unknown) {
    log.err('slot prune failed (non-fatal — booking IS confirmed)',
      e instanceof Error ? e.message : String(e), { quote_id: quote.id })
  }
  after(() =>
    notifyBookingConfirmed(supabase, {
      quoteId: quote.id as string,
      intakeId: (quote.intake_id as string | null) ?? null,
      tenantId: (quote.tenant_id as string | null) ?? null,
      shareToken: token,
      slotIso: slot,
    }),
  )

  // Tier is still resolved for logging + the thank-you page's query string.
  const tier = resolveNextTier(requestedTier, quote.selected_tier as string | null)
  const next = `/q/${token}/thanks`

  // The early-booking discount is NOT realised here any more. Under pay-first
  // the customer has already paid by the time they reach this route, so the
  // old `!alreadyPaid` gate would never fire. Realisation moved to the Stripe
  // mint in /r/<token>/<tier> (resolveMintDiscount) — the money choke-point.

  log.done('booking confirmed — sending customer to the thank-you page', {
    quote_id: quote.id,
    slot,
    tier,
  })

  return Response.json({ ok: true, scheduled_at: slot, next })
}
