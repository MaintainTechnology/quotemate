// Stripe webhook — authoritative source for "quote was paid".
// Subscribes to `checkout.session.completed`. Idempotent via Stripe's
// event.id (already-processed events are no-ops) and via paid_stripe_session_id
// on the quote row (re-delivery of same session is a no-op).

import { createClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe/client'
import { pipelineLog } from '@/lib/log/pipeline'
import type Stripe from 'stripe'

export const maxDuration = 30

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

  if (event.type !== 'checkout.session.completed') {
    log.ok('event type not handled, acknowledging', { type: event.type })
    return Response.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const quoteId = session.metadata?.quote_id
  const tier = session.metadata?.tier
  if (!quoteId || !tier) {
    log.err('session missing quote_id/tier metadata', null, { session: session.id })
    return Response.json({ received: true })  // ack so Stripe doesn't retry forever
  }

  const { data: existing } = await supabase
    .from('quotes')
    .select('id, paid_at, paid_stripe_session_id')
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

  log.done('quote marked paid', {
    quote_id: quoteId,
    tier,
    amount_total: session.amount_total,
    currency: session.currency,
  })
  return Response.json({ received: true })
}
