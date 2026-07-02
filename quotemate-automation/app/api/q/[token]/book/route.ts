// Booking endpoint — called by the SlotPicker on the booking page.
//
// WP6 reorder: BOOK FIRST, PAY LAST. This route no longer requires a
// paid deposit. It records the customer's chosen time on the quote and
// puts it into 'reserved', then hands back the pay URL as `next` so the
// customer is sent to the deposit step (the LAST step). The booking is
// only CONFIRMED — status='accepted', booking_state='booked', slot
// removed from availability, confirmation SMS sent — when the deposit is
// actually paid, which now happens in the Stripe webhook.
//
// Slot-hold model ("confirm slot on payment"): the picked slot is NOT
// removed from tradies.available_slots here, so an abandoned checkout
// never strands a slot. The (small, pilot-tolerated) trade-off is two
// customers could pick the same time before either pays — the webhook
// resolves that when finalising.
//
// Hardening rules:
//   - share_token must resolve to a quote
//   - if the quote is already PAID + scheduled → already booked (409)
//   - a not-yet-paid quote may (re-)pick a slot freely
//   - slot must be a published slot in tradies.available_slots
//   - slot must be a parseable ISO timestamp in the future

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pipelineLog } from '@/lib/log/pipeline'
import { BOOKING_STATE, isPriceHoldExpired } from '@/lib/quote/hold'
import { earlyBirdStatus } from '@/lib/quote/early-bird'
import { resolveBookingOptions, buildBookedKeys } from '@/lib/quote/slots'
import { tzForState } from '@/lib/quote/availability'
import { notifyBookingConfirmed } from '@/lib/quote/booking-notify'
import { expireCheckoutSession } from '@/lib/stripe/checkout'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const PAY_TIERS = new Set(['good', 'better', 'best'])

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
    .select('id, paid_at, scheduled_at, selected_tier, share_token, intake_id, tenant_id, good, better, best, stripe_links, created_at, price_hold_until, needs_inspection')
    .eq('share_token', token)
    .maybeSingle()

  if (quoteErr) {
    log.err('quote lookup failed', quoteErr.message)
    return Response.json({ ok: false, error: 'Lookup failed' }, { status: 500 })
  }
  if (!quote) {
    return Response.json({ ok: false, error: 'Quote not found' }, { status: 404 })
  }
  // Already booked + paid → terminal, don't let them re-pick.
  if (quote.paid_at && quote.scheduled_at) {
    return Response.json(
      { ok: false, error: 'This quote is already booked' },
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

  // Book-first / pay-last: normally we only RESERVE here (the booking is
  // confirmed when the deposit is paid, in the Stripe webhook). But the
  // legacy recovery path — a customer who paid WITHOUT a slot then comes
  // back to pick a time — has no second payment to trigger the webhook, so
  // we must finalise the booking right here (spec R2): booked + accepted,
  // prune the slot, and send the confirmation SMS.
  const alreadyPaid = !!quote.paid_at
  const patch: Record<string, unknown> = {
    scheduled_at: slot,
    scheduled_window: chosen.period, // 'am' | 'pm' | null (legacy exact-time)
    booking_state: alreadyPaid ? BOOKING_STATE.BOOKED : BOOKING_STATE.RESERVED,
    last_status_at: nowIso,
  }
  if (alreadyPaid) {
    patch.status = 'accepted'
    patch.accepted_at = nowIso
  }

  const { error: quoteUpdateErr } = await supabase
    .from('quotes')
    .update(patch)
    .eq('id', quote.id)

  if (quoteUpdateErr) {
    log.err('quote reserve failed', quoteUpdateErr.message, { quote_id: quote.id })
    return Response.json({ ok: false, error: 'Failed to reserve that time' }, { status: 500 })
  }

  // Legacy paid-then-pick: prune the chosen slot from the tenant's curated
  // list (if present) and fire the confirmation SMS, mirroring the webhook's
  // finalise path. Best-effort — the booking is already recorded above.
  if (alreadyPaid) {
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
  }

  // Resolve which tier's deposit to charge: the tier the customer chose
  // on the quote page (passed through), else the quote's selected_tier,
  // else 'better' (the canonical default).
  const reqTier = typeof body.tier === 'string' ? body.tier : null
  const tier =
    reqTier && PAY_TIERS.has(reqTier)
      ? reqTier
      : PAY_TIERS.has(String(quote.selected_tier))
        ? String(quote.selected_tier)
        : 'better'
  // Already-paid (legacy recovery) → booking is confirmed above, so send
  // them to the thank-you page rather than back through the deposit step.
  const next = alreadyPaid ? `/q/${token}/paid?tier=${tier}` : `/r/${token}/${tier}`

  // ─── v8 Phase A — apply the early-booking discount ──────────────────
  //
  // The booking choke-point is the moment the customer commits a time —
  // exactly when an "if you book today" offer should be realised. The
  // discount is decided SERVER-SIDE from the DB-stamped deadline, never
  // from anything the client sent.
  //
  // Best-effort + isolated: the slot is ALREADY reserved above. If any
  // step here fails the customer still proceeds to the (non-discounted)
  // deposit and the booking is unharmed — they just miss the discount.
  //
  // The early_bird_* columns land via migration 044; the select is its
  // own try so a pre-migration deploy simply finds no offer.
  let appliedDiscountPct = 0
  if (!alreadyPaid && PAY_TIERS.has(tier)) {
    try {
      const { data: eb, error: ebErr } = await supabase
        .from('quotes')
        .select('early_bird_discount_pct, early_bird_expires_at, applied_discount_pct')
        .eq('id', quote.id)
        .maybeSingle()

      if (ebErr) {
        log.step('early-bird columns absent — skipping discount (apply migration 044)', {
          quote_id: quote.id,
        })
      } else if (eb) {
        const alreadyApplied = Number(eb.applied_discount_pct ?? 0)
        const status = earlyBirdStatus(
          eb.early_bird_discount_pct as number | null,
          eb.early_bird_expires_at as string | null,
        )
        if (alreadyApplied > 0) {
          // Re-pick of a time on a quote that already earned the
          // discount — keep it; don't re-issue or double-stamp.
          appliedDiscountPct = alreadyApplied
        } else if (status.state === 'live') {
          appliedDiscountPct = status.discountPct

          // 1. Stamp the realised discount on the quote.
          const { error: stampErr } = await supabase
            .from('quotes')
            .update({
              applied_discount_pct: appliedDiscountPct,
              applied_discount_at: nowIso,
            })
            .eq('id', quote.id)
          if (stampErr) {
            log.err('early-bird stamp failed (non-fatal — booking proceeds)', stampErr.message, {
              quote_id: quote.id,
            })
            appliedDiscountPct = 0
          } else {
            // 2. Kill the stale full-price Session so a cached old link
            //    can't be paid at the undiscounted amount. NO replacement
            //    is minted here: /r/<token>/<tier> mints a FRESH Session
            //    on every pay click and reads applied_discount_pct
            //    (stamped above), so the discounted deposit is issued
            //    there. Minting here too left an orphaned duplicate
            //    Session per booking and added ~1-2s to this POST.
            try {
              const oldUrl = ((quote.stripe_links as Record<string, string> | null) ?? {})[
                tier
              ]
              if (oldUrl) await expireCheckoutSession(oldUrl)
              log.ok('early-bird discount applied — /r mints the discounted Session on click', {
                quote_id: quote.id,
                tier,
                discount_pct: appliedDiscountPct,
              })
            } catch (e: unknown) {
              log.err('stale full-price Session expire threw (non-fatal — /r replaces it on click)',
                e instanceof Error ? e.message : String(e), { quote_id: quote.id })
            }
          }
        }
      }
    } catch (e: unknown) {
      log.err('early-bird block threw (non-fatal — booking proceeds)',
        e instanceof Error ? e.message : String(e), { quote_id: quote.id })
    }
  }

  log.done('slot reserved — sending customer to deposit (last step)', {
    quote_id: quote.id,
    slot,
    tier,
    early_bird_discount_pct: appliedDiscountPct,
  })

  return Response.json({
    ok: true,
    scheduled_at: slot,
    next,
    early_bird_discount_pct: appliedDiscountPct,
  })
}
