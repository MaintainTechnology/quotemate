// Stripe webhook — authoritative source for "quote was paid".
// Subscribes to `checkout.session.completed`. Idempotency is quote-row
// based (there is NO event.id ledger): re-delivery of the same session is
// skipped via paid_stripe_session_id, and the paid_at write is a
// conditional claim (`... WHERE paid_at IS NULL`) so two completed events
// for DIFFERENT sessions — possible now that /r mints a fresh Session per
// pay click — can never both finalise the quote.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe/client'
import { subscriptionToTenantPatch, isUpdatableStatus } from '@/lib/stripe/billing'
import { syncSubscriptionToClerk } from '@/lib/clerk/metadata'
import { pipelineLog } from '@/lib/log/pipeline'
import { bookingStateOnPaid, shouldFinaliseBookingOnPaid } from '@/lib/quote/booking'
import { notifyBookingConfirmed } from '@/lib/quote/booking-notify'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import { applyPlanFeatures } from '@/lib/features/access'
import type Stripe from 'stripe'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Record a residential painting deposit on painting_measurements (mig 156).
 * Painting sessions carry metadata.painting_token (not quote_id), so they're
 * handled here, separate from the quotes path. Idempotent on
 * paid_stripe_session_id. Never throws — best-effort, like the quote path.
 */
async function recordPaintingDeposit(
  token: string,
  session: Stripe.Checkout.Session,
  log: ReturnType<typeof pipelineLog>,
): Promise<void> {
  const tier = session.metadata?.tier ?? null
  const { data: existing } = await supabase
    .from('painting_measurements')
    .select('public_token, paid_at, paid_stripe_session_id')
    .eq('public_token', token)
    .maybeSingle()
  if (!existing) {
    log.err('painting job not found for deposit', null, { painting_token: token })
    return
  }
  if (existing.paid_stripe_session_id === session.id) {
    log.ok('duplicate painting deposit event, skipping', { painting_token: token, session: session.id })
    return
  }
  if (existing.paid_at) {
    log.ok('painting job already paid (different session), skipping', { painting_token: token })
    return
  }
  const { error } = await supabase
    .from('painting_measurements')
    .update({
      paid_at: new Date().toISOString(),
      paid_tier: tier,
      paid_stripe_session_id: session.id,
    })
    .eq('public_token', token)
  if (error) {
    log.err('painting deposit update failed', error.message, { painting_token: token })
    return
  }
  log.ok('painting deposit recorded', { painting_token: token, tier, session: session.id })
}

/**
 * Record a roofing $99 site-visit deposit on roofing_measurements (mig 165).
 * Roofing site-visit sessions carry metadata.roofing_token (not quote_id) —
 * the dedicated /q/roof surface has no quotes row — so they're handled here,
 * mirroring recordPaintingDeposit. Idempotent on paid_stripe_session_id;
 * never throws.
 */
async function recordRoofingSiteVisit(
  token: string,
  session: Stripe.Checkout.Session,
  log: ReturnType<typeof pipelineLog>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('roofing_measurements')
    .select('public_token, paid_at, paid_stripe_session_id')
    .eq('public_token', token)
    .maybeSingle()
  if (!existing) {
    log.err('roofing job not found for site-visit deposit', null, { roofing_token: token })
    return
  }
  if (existing.paid_stripe_session_id === session.id) {
    log.ok('duplicate roofing site-visit event, skipping', { roofing_token: token, session: session.id })
    return
  }
  if (existing.paid_at) {
    log.ok('roofing job already paid (different session), skipping', { roofing_token: token })
    return
  }
  const { error } = await supabase
    .from('roofing_measurements')
    .update({
      paid_at: new Date().toISOString(),
      paid_tier: 'inspection',
      paid_stripe_session_id: session.id,
    })
    .eq('public_token', token)
  if (error) {
    log.err('roofing site-visit update failed', error.message, { roofing_token: token })
    return
  }
  log.ok('roofing site-visit recorded', { roofing_token: token, session: session.id })
}

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

  // ── Subscription / billing lifecycle (the tradie pays QuoteMax) ─────
  // Kept in this same endpoint (one webhook secret) but handled entirely
  // separately from the quote-deposit path below. The subscription.*
  // events keep tenants.* in sync after the initial Checkout.
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await syncSubscriptionToTenant(event.data.object as Stripe.Subscription, event.type, log)
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

  // Painting deposit (SMS / self-serve form) → painting_measurements, NOT the
  // quotes table. Keyed by metadata.painting_token (mig 156); recorded
  // idempotently and returned BEFORE the quotes path so a painting session
  // (which carries no quote_id) never logs a spurious "missing quote_id" error.
  const paintingToken = session.metadata?.painting_token
  if (paintingToken) {
    await recordPaintingDeposit(paintingToken, session, log)
    return Response.json({ received: true })
  }

  // Roofing $99 site-visit (dedicated /q/roof surface) → roofing_measurements,
  // NOT the quotes table. Keyed by metadata.roofing_token (mig 165); handled
  // BEFORE the quotes path so a roofing session (no quote_id) never logs a
  // spurious "missing quote_id" error.
  const roofingToken = session.metadata?.roofing_token
  if (roofingToken) {
    await recordRoofingSiteVisit(roofingToken, session, log)
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

  // Conditional CLAIM, not a blind write: `.is('paid_at', null)` makes the
  // read-then-write race safe. With /r minting a fresh Session per click,
  // two live Sessions can complete near-simultaneously; both events pass
  // the select-guard above, but only ONE can claim the row here — the
  // loser matches zero rows and takes the duplicate branch below.
  const { data: claimed, error } = await supabase
    .from('quotes')
    .update({
      paid_at: new Date().toISOString(),
      paid_tier: tier,
      paid_stripe_session_id: session.id,
    })
    .eq('id', quoteId)
    .is('paid_at', null)
    .select('id')

  if (error) {
    log.err('quote update failed', error.message, { quote_id: quoteId })
    return new Response('DB update failed', { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    log.ok('payment already claimed by a concurrent event, skipping', {
      quote_id: quoteId,
      this_session: session.id,
    })
    return Response.json({ received: true })
  }

  // Connect fund-flow stamp (mig 160) — the amount collected, QuoteMax's 2%
  // fee, and the connected account the funds settled to (null for legacy
  // platform-direct charges). The completion route reads these to compute
  // and release the tradie's payout. Written SEPARATELY from the claim above
  // so a not-yet-migrated DB degrades this stamp, never the payment record.
  {
    const feeCentsRaw = session.metadata?.application_fee_cents
    const feeCents = feeCentsRaw ? Number.parseInt(feeCentsRaw, 10) : null
    const { error: stampErr } = await supabase
      .from('quotes')
      .update({
        paid_amount_cents: session.amount_total ?? null,
        platform_fee_cents: Number.isFinite(feeCents as number) ? feeCents : null,
        stripe_connect_destination: session.metadata?.connect_destination ?? null,
      })
      .eq('id', quoteId)
    if (stampErr) {
      log.err('fund-flow stamp skipped (non-fatal — apply migration 160)', stampErr.message, {
        quote_id: quoteId,
      })
    }
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
    } else {
      // Paid with NO slot yet (a $99 inspection deposit, or no slots were
      // published): nudge the customer over SMS to pick a time — the /paid
      // page shows the same "Pick a time" CTA. Idempotent: the paid_at claim
      // above means a Stripe retry hits the "already paid" early return, so
      // this fires exactly once.
      after(() =>
        notifyBookingConfirmed(supabase, {
          quoteId,
          intakeId: (existing.intake_id as string | null) ?? null,
          tenantId: (existing.tenant_id as string | null) ?? null,
          shareToken: existing.share_token as string,
          slotIso: null,
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

  const { data: updatedRows, error } = await q.select('id, clerk_user_id')
  if (error) {
    log.err('subscription sync update failed', error.message, {
      tenant_id: opts.tenantId,
      customer: opts.customerId,
    })
    return
  }
  log.ok('subscription synced to tenant', {
    tenant_id: opts.tenantId,
    status: patch.subscription_status,
    plan: patch.subscription_plan,
  })

  // Mirror the REAL subscription onto Clerk publicMetadata — the authoritative,
  // app-facing copy of the plan (Clerk is primary login; this keeps its
  // metadata in lockstep with Stripe). Best-effort: never fails the webhook.
  const clerkUserId = (updatedRows?.[0]?.clerk_user_id as string | undefined) ?? null
  if (clerkUserId) {
    const synced = await syncSubscriptionToClerk(clerkUserId, {
      plan: (patch.subscription_plan as string | null) ?? null,
      status: (patch.subscription_status as string | null) ?? null,
      interval: (patch.subscription_interval as string | null) ?? null,
    })
    if (synced) log.ok('subscription mirrored to Clerk metadata', { clerk_user_id: clerkUserId })
  }

  // Apply the plan→features map to trades[] when the plan changes (feature
  // toggles, migration 138). Best-effort + idempotent: adds the plan's granted
  // tool slugs and strips only plan-sourced ones on a downgrade — never an
  // admin-granted or onboarding slug. A failure here must not fail the webhook.
  const tenantId = opts.tenantId ?? (updatedRows?.[0]?.id as string | undefined) ?? null
  const plan = patch.subscription_plan as string | undefined
  if (tenantId && plan) {
    try {
      const r = await applyPlanFeatures(supabase, tenantId, plan)
      if (r.ok && (r.added.length > 0 || r.removed.length > 0)) {
        log.ok('plan features applied to trades[]', {
          tenant_id: tenantId,
          plan,
          added: r.added,
          removed: r.removed,
        })
      }
    } catch (e: any) {
      log.err('plan features apply threw (non-fatal)', e?.message ?? String(e), {
        tenant_id: tenantId,
      })
    }
  }
}

/** Load the tenant's currently-tracked subscription for the sibling guard.
 *  Matches the same way applyTenantSubscription does (tenant_id else customer). */
async function loadTenantSubscription(opts: {
  tenantId: string | null
  customerId: string | null
}): Promise<
  { id: string; stripe_subscription_id: string | null; subscription_status: string | null } | null
> {
  const base = supabase.from('tenants').select('id, stripe_subscription_id, subscription_status')
  const q = opts.tenantId
    ? base.eq('id', opts.tenantId)
    : opts.customerId
      ? base.eq('stripe_customer_id', opts.customerId)
      : null
  if (!q) return null
  const { data } = await q.maybeSingle()
  return (data as {
    id: string
    stripe_subscription_id: string | null
    subscription_status: string | null
  } | null) ?? null
}

async function syncSubscriptionToTenant(
  subPayload: Stripe.Subscription,
  eventType: string,
  log: Log,
) {
  const isDeleted = eventType === 'customer.subscription.deleted'

  // Out-of-order / retried webhooks can carry a STALE payload — e.g. a
  // re-delivered `updated` with status:'active' arriving AFTER the sub was
  // cancelled. Re-fetch the authoritative state for created/updated so a stale
  // event can't resurrect a dead subscription. `deleted` is terminal — trust it.
  let sub = subPayload
  if (!isDeleted) {
    try {
      sub = await getStripe().subscriptions.retrieve(subPayload.id)
    } catch (e) {
      log.err('subscription re-fetch failed; using event payload', e instanceof Error ? e.message : String(e), {
        sub: subPayload.id,
      })
    }
  }

  const tenantId = (sub.metadata?.tenant_id as string | undefined) ?? null
  const customerId =
    typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null)

  // Sibling guard: a tenant tracks exactly ONE subscription. If it already
  // tracks a DIFFERENT, still-live sub, don't let a sibling sub's event clobber
  // the active plan (last-write-wins would otherwise flap plan/features).
  const current = await loadTenantSubscription({ tenantId, customerId })
  if (
    current?.stripe_subscription_id &&
    current.stripe_subscription_id !== sub.id &&
    isUpdatableStatus(current.subscription_status)
  ) {
    log.ok('ignoring sibling subscription event — tenant tracks a different live sub', {
      tenant_id: current.id,
      event_sub: sub.id,
      tracked_sub: current.stripe_subscription_id,
    })
    return
  }

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
