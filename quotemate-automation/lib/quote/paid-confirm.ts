// The ONE claim+finalise path for "this quote was paid" — extracted from the
// Stripe webhook (app/api/stripe/webhook/route.ts) so the /q/[token]/paid
// page can perform the same authoritative confirmation when the customer
// lands before the webhook does (Stripe redirects immediately; the webhook
// can lag on cold starts/retries). Whichever caller wins the conditional
// claim (`… WHERE paid_at IS NULL`) runs the FULL finalise — booking state,
// slot prune, confirmation SMS, lifecycle advance — and the loser is a
// guaranteed no-op, so side effects fire exactly once.

import { after } from 'next/server'
import { pipelineLog } from '@/lib/log/pipeline'
import { bookingStateOnPaid, shouldFinaliseBookingOnPaid } from '@/lib/quote/booking'
import { notifyBookingConfirmed } from '@/lib/quote/booking-notify'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'

/** The quote fields the finalise sequence needs (caller already read the row). */
export type PaidQuoteRow = {
  id: string
  scheduled_at: string | null
  intake_id: string | null
  tenant_id: string | null
  share_token: string | null
}

// Deliberately loose client type: the webhook and the /paid page both hold a
// service-role supabase-js client; typing it structurally keeps this module
// unit-testable with the chainable mock the route tests already use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Verify a retrieved Checkout Session actually pays THIS quote. Guards the
 * /paid page's `?session_id=` fallback: a session id pasted from another
 * quote (or an unpaid session) must never mark this quote paid.
 */
export function sessionConfirmsQuote(
  session: {
    payment_status?: string | null
    metadata?: Record<string, string> | null
  },
  quoteId: string,
): { tier: string } | null {
  if (session.payment_status !== 'paid') return null
  const meta = session.metadata
  if (!meta || meta.quote_id !== quoteId) return null
  return { tier: typeof meta.tier === 'string' && meta.tier ? meta.tier : 'better' }
}

/**
 * Conditionally claim the quote as paid, then finalise the booking exactly
 * as the webhook always has. Returns:
 *   { claimed: true }                — this caller won; all side effects ran.
 *   { claimed: false }               — already claimed elsewhere; no-op.
 *   { claimed: false, error }        — the claim UPDATE itself failed
 *                                      (webhook maps this to a 500 so Stripe
 *                                      retries; the /paid page just renders).
 */
export async function finalisePaidQuote(
  supabase: Db,
  args: {
    quote: PaidQuoteRow
    tier: string
    sessionId: string
    amountTotalCents?: number | null
    applicationFeeCents?: number | null
    connectDestination?: string | null
  },
): Promise<{ claimed: boolean; error?: string }> {
  const log = pipelineLog('webhook')
  const { quote, tier, sessionId } = args
  const quoteId = quote.id

  // Conditional CLAIM, not a blind write: `.is('paid_at', null)` makes the
  // read-then-write race safe across the webhook, a concurrent webhook
  // retry, AND the /paid page — only ONE caller can claim the row.
  const { data: claimed, error } = await supabase
    .from('quotes')
    .update({
      paid_at: new Date().toISOString(),
      paid_tier: tier,
      paid_stripe_session_id: sessionId,
    })
    .eq('id', quoteId)
    .is('paid_at', null)
    .select('id')

  if (error) {
    log.err('paid claim failed', error.message, { quote_id: quoteId })
    return { claimed: false, error: error.message }
  }
  if (!claimed || claimed.length === 0) {
    log.ok('payment already claimed elsewhere, skipping', { quote_id: quoteId, session: sessionId })
    return { claimed: false }
  }

  // Connect fund-flow stamp (mig 160). Written SEPARATELY from the claim so
  // a not-yet-migrated DB degrades this stamp, never the payment record.
  {
    const { error: stampErr } = await supabase
      .from('quotes')
      .update({
        paid_amount_cents: args.amountTotalCents ?? null,
        platform_fee_cents: args.applicationFeeCents ?? null,
        stripe_connect_destination: args.connectDestination ?? null,
      })
      .eq('id', quoteId)
    if (stampErr) {
      log.err('fund-flow stamp skipped (non-fatal — apply migration 160)', stampErr.message, {
        quote_id: quoteId,
      })
    }
  }

  // Paying CONFIRMS the booking (book-first / pay-last). Slot held →
  // booked + accepted + prune + confirmation SMS; no slot → reserved + a
  // "pick a time" nudge SMS. Best-effort + isolated: paid_at is already
  // committed, so a failure here must not undo the payment.
  try {
    const scheduledAt = quote.scheduled_at ?? null
    const bookingState = bookingStateOnPaid(scheduledAt)
    const finalise = shouldFinaliseBookingOnPaid(scheduledAt)
    const nowIso = new Date().toISOString()

    const patch: Record<string, unknown> = { booking_state: bookingState }
    if (finalise) {
      patch.status = 'accepted'
      patch.accepted_at = nowIso
      patch.last_status_at = nowIso
    }
    const { error: bsErr } = await supabase.from('quotes').update(patch).eq('id', quoteId)
    if (bsErr) {
      log.err('booking finalise skipped (non-fatal — paid_at IS committed)', bsErr.message, {
        quote_id: quoteId,
        hint: 'apply migration 026 to enable quotes.booking_state',
      })
    } else {
      log.ok('booking finalised on payment', {
        quote_id: quoteId,
        booking_state: bookingState,
        confirmed: finalise,
      })
    }

    if (finalise && scheduledAt) {
      // Slot-hold model = "confirm slot on payment": prune the now-paid slot
      // from the tenant's curated list (idempotent — only if still present).
      const tenantId = quote.tenant_id
      if (tenantId) {
        try {
          const { data: tr } = await supabase
            .from('tenants')
            .select('id, available_slots')
            .eq('id', tenantId)
            .maybeSingle()
          if (tr) {
            const slots = Array.isArray(tr.available_slots) ? (tr.available_slots as string[]) : []
            if (slots.includes(scheduledAt)) {
              await supabase
                .from('tenants')
                .update({ available_slots: slots.filter((s) => s !== scheduledAt) })
                .eq('id', tr.id)
            }
          }
        } catch (e: unknown) {
          log.err(
            'slot prune failed (non-fatal — booking IS confirmed)',
            e instanceof Error ? e.message : String(e),
            { quote_id: quoteId },
          )
        }
      }

      // Confirmation SMS to customer + tradie. Deferred via after() so the
      // caller responds fast; notifyBookingConfirmed never throws.
      after(() =>
        notifyBookingConfirmed(supabase, {
          quoteId,
          intakeId: quote.intake_id,
          tenantId: quote.tenant_id,
          shareToken: quote.share_token as string,
          slotIso: scheduledAt,
        }),
      )
    } else {
      // Paid with NO slot yet: nudge the customer over SMS to pick a time.
      // Fires exactly once — the claim above already de-duplicated.
      after(() =>
        notifyBookingConfirmed(supabase, {
          quoteId,
          intakeId: quote.intake_id,
          tenantId: quote.tenant_id,
          shareToken: quote.share_token as string,
          slotIso: null,
        }),
      )
    }
  } catch (e: unknown) {
    log.err(
      'booking finalise threw (non-fatal — paid_at committed)',
      e instanceof Error ? e.message : String(e),
      { quote_id: quoteId },
    )
  }

  // WP7 — advance the lifecycle ladder so the follow-up queue stops chasing
  // a paid customer. Monotonic + non-throwing.
  await advanceQuoteStatus(supabase, quoteId, 'paid')

  return { claimed: true }
}
