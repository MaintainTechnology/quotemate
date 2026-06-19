// Stripe webhook — authoritative source for "quote was paid".
// Subscribes to `checkout.session.completed`. Idempotent via Stripe's
// event.id (already-processed events are no-ops) and via paid_stripe_session_id
// on the quote row (re-delivery of same session is a no-op).

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe/client'
import { subscriptionToTenantPatch } from '@/lib/stripe/billing'
import { pipelineLog } from '@/lib/log/pipeline'
import { bookingStateOnPaid, shouldFinaliseBookingOnPaid } from '@/lib/quote/booking'
import { notifyBookingConfirmed } from '@/lib/quote/booking-notify'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import type Stripe from 'stripe'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const log = pipelineLog('dispatch')
  log.step('stripe webhook received')

  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) {
    log.err('missing signature or webhook secret', null, { has_sig: !!sig, has_secret: !!secret })
    return new Response('Missing signature', { status: 400 })
  }

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, sig, secret)
  } catch (err: any) {
    log.err('signature verification failed', err)
    return new Response('Invalid signature', { status: 400 })
  }

  log.ok('event verified', { type: event.type, id: event.id })

  // ── Subscription / billing lifecycle (the tradie pays QuoteMate) ─────
  // Kept in this same endpoint (one webhook secret) but handled entirely
  // separately from the quote-deposit path below. The subscription.*
  // events keep tenants.* in sync after the initial Checkout.
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await syncSubscriptionToTenant(event.data.object as Stripe.Subscription, log)
    return Response.json({ received: true })
  }

  if (event.type !== 'checkout.session.completed') {
    log.ok('event type not handled, acknowledging', { type: event.type })
    return Response.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session

  // Subscription Checkout completed → tenant billing, NOT a quote deposit.
  // The quote-deposit path below is mode==='payment' only.
  if (session.mode === 'subscription') {
    await onSubscriptionCheckoutCompleted(session, log)
    return Response.json({ received: true })
  }

  const quoteId = session.metadata?.quote_id
  const tier = session.metadata?.tier
  if (!quoteId || !tier) {
    log.err('session missing quote_id/tier metadata', null, { session: session.id })
    return Response.json({ received: true })  // ack so Stripe doesn't retry forever
  }

  const { data: existing } = await supabase
    .from('quotes')
    .select('id, paid_at, paid_stripe_session_id, scheduled_at, intake_id, tenant_id, share_token')
    .eq('id', quoteId)
    .single()

  if (!existing) {
    log.err('quote not found', null, { quote_id: quoteId })
    return Response.json({ received: true })
  }

  if (existing.paid_stripe_session_id === session.id) {
    log.ok('duplicate event for already-recorded session, skipping', { quote_id: quoteId, session: session.id })
    return Response.json({ received: true, idempotent: true })
  }

  if (existing.paid_at) {
    log.ok('quote already paid (different session), skipping', { quote_id: quoteId, prior_session: existing.paid_stripe_session_id, this_session: session.id })
    return Response.json({ received: true })
  }

  const { error } = await supabase
    .from('quotes')
    .update({
      paid_at: new Date().toISOString(),
      paid_tier: tier,
      paid_stripe_session_id: session.id,
    })
    .eq('id', quoteId)

  if (error) {
    log.err('quote update failed', error.message, { quote_id: quoteId })
    return new Response('DB update failed', { status: 500 })
  }

  // WP6 reorder — the deposit is the LAST step, so paying CONFIRMS the
  // booking. If the customer picked a time before paying (the new
  // default for every quote), finalise it now: status='accepted',
  // booking_state='booked', free the held slot, and send the
  // confirmation SMS (moved here from the book route so it only fires
  // once the job is genuinely locked in). If they paid with no slot
  // (an old SMS link, or no slots were published), fall back to
  // 'reserved' and the /paid page prompts them to pick a time.
  //
  // Best-effort + isolated: paid_at is already committed above, so a
  // failure here MUST NOT fail the webhook or undo the payment.
  try {
    const scheduledAt = (existing.scheduled_at as string | null) ?? null
    const bookingState = bookingStateOnPaid(scheduledAt)
    const finalise = shouldFinaliseBookingOnPaid(scheduledAt)
    const nowIso = new Date().toISOString()

    const patch: Record<string, unknown> = { booking_state: bookingState }
    if (finalise) {
      patch.status = 'accepted'
      patch.accepted_at = nowIso
      patch.last_status_at = nowIso
    }
    const { error: bsErr } = await supabase
      .from('quotes')
      .update(patch)
      .eq('id', quoteId)
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
      // Slot-hold model = "confirm slot on payment": the slot was NOT
      // removed when the customer picked it, so prune it now that it's
      // paid + booked (idempotent — only filters if still present).
      // Mig 062 moved available_slots off the legacy `tradies` table and
      // onto `tenants`, so the prune now targets the tenant that owns
      // this quote.
      const tenantId = (existing.tenant_id as string | null) ?? null
      if (tenantId) {
        try {
          const { data: tr } = await supabase
            .from('tenants')
            .select('id, available_slots')
            .eq('id', tenantId)
            .maybeSingle()
          if (tr) {
            const slots = Array.isArray(tr.available_slots)
              ? (tr.available_slots as string[])
              : []
            if (slots.includes(scheduledAt)) {
              await supabase
                .from('tenants')
                .update({ available_slots: slots.filter((s) => s !== scheduledAt) })
                .eq('id', tr.id)
            }
          }
        } catch (e: any) {
          log.err('slot prune failed (non-fatal — booking IS confirmed)', e?.message ?? String(e), {
            quote_id: quoteId,
          })
        }
      }

      // Confirmation SMS to customer + tradie. Deferred via after() so
      // Stripe gets a fast 2xx; notifyBookingConfirmed never throws.
      after(() =>
        notifyBookingConfirmed(supabase, {
          quoteId,
          intakeId: (existing.intake_id as string | null) ?? null,
          tenantId: (existing.tenant_id as string | null) ?? null,
          shareToken: existing.share_token as string,
          slotIso: scheduledAt,
        }),
      )
    }
  } catch (e: any) {
    log.err('booking finalise threw (non-fatal — paid_at committed)', e?.message ?? String(e), { quote_id: quoteId })
  }

  // WP7 — advance the lifecycle ladder to 'paid' so the follow-up queue
  // stops chasing a customer who has paid (paid_at alone never moved the
  // status column before). Monotonic + non-throwing: it won't regress an
  // already-'accepted' quote and a failure here can't undo the committed
  // payment. Mirrors the booking_state best-effort block above.
  await advanceQuoteStatus(supabase, quoteId, 'paid')

  log.done('quote marked paid', {
    quote_id: quoteId,
    tier,
    amount_total: session.amount_total,
    currency: session.currency,
  })
  return Response.json({ received: true })
}

// ─── Subscription billing sync ──────────────────────────────────────
// Mirror a Stripe subscription onto the tenant row. Matches the tenant by
// metadata.tenant_id when present, else by stripe_customer_id (the reverse
// lookup the partial unique index in migration 132 supports). Last-write-
// wins — naturally idempotent on event re-delivery.

type Log = ReturnType<typeof pipelineLog>

async function applyTenantSubscription(
  opts: { tenantId: string | null; customerId: string | null; patch: Record<string, unknown> },
  log: Log,
) {
  const patch = { ...opts.patch }
  if (opts.customerId) patch.stripe_customer_id = opts.customerId

  const base = supabase.from('tenants').update(patch)
  const q = opts.tenantId
    ? base.eq('id', opts.tenantId)
    : opts.customerId
      ? base.eq('stripe_customer_id', opts.customerId)
      : null

  if (!q) {
    log.err('subscription sync: no tenant_id or customer to match on', null)
    return
  }

  const { error } = await q
  if (error) {
    log.err('subscription sync update failed', error.message, {
      tenant_id: opts.tenantId,
      customer: opts.customerId,
    })
  } else {
    log.ok('subscription synced to tenant', {
      tenant_id: opts.tenantId,
      status: patch.subscription_status,
      plan: patch.subscription_plan,
    })
  }
}

async function syncSubscriptionToTenant(sub: Stripe.Subscription, log: Log) {
  const tenantId = (sub.metadata?.tenant_id as string | undefined) ?? null
  const customerId =
    typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null)
  await applyTenantSubscription(
    { tenantId, customerId, patch: subscriptionToTenantPatch(sub) },
    log,
  )
}

async function onSubscriptionCheckoutCompleted(
  session: Stripe.Checkout.Session,
  log: Log,
) {
  const tenantId =
    (session.metadata?.tenant_id as string | undefined) ??
    session.client_reference_id ??
    null
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : (session.customer?.id ?? null)
  const subId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription?.id ?? null)

  if (!subId) {
    log.err('subscription checkout completed but no subscription id', null, {
      session: session.id,
    })
    return
  }

  const sub = await getStripe().subscriptions.retrieve(subId)
  await applyTenantSubscription(
    { tenantId, customerId, patch: subscriptionToTenantPatch(sub) },
    log,
  )
}
