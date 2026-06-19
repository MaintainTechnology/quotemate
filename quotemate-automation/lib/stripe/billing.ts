// Stripe Billing — subscription plumbing for the tradie tiers.
//
// Plans: Starter / Pro / Crew, each with a monthly + annual Price. The
// Prices live in Stripe (created by scripts/setup-stripe-billing.mjs) and
// are addressed here by a deterministic lookup_key — `qm_<plan>_<interval>`
// — so this code never hard-codes Stripe price IDs. Amounts displayed to
// customers live in app/_components/pricing-data.ts; the dollar figures in
// the setup script must match it.
//
// 14-day free trial on STARTER MONTHLY ONLY (see hasFreeTrial); every other
// plan/interval bills immediately. Card collected up front either way
// (standard subscription Checkout). Self-service management goes through the
// Stripe Customer Portal. Subscription state is mirrored onto tenants.* by
// the webhook (see app/api/stripe/webhook/route.ts).

import { getStripe } from './client'
import type Stripe from 'stripe'
import { hasFreeTrial, TRIAL_DAYS } from '@/app/_components/pricing-data'

export type PlanId = 'starter' | 'pro' | 'crew'
export type BillingInterval = 'month' | 'year'

export const PLAN_IDS: readonly PlanId[] = ['starter', 'pro', 'crew']

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v)
}
export function isInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year'
}

/** Deterministic Stripe Price lookup_key. Mirrored by the setup script. */
export function lookupKey(plan: PlanId, interval: BillingInterval): string {
  return `qm_${plan}_${interval}`
}

/** Parse a lookup_key back into { plan, interval }. null if it isn't ours. */
export function parseLookupKey(
  key: string | null | undefined,
): { plan: PlanId; interval: BillingInterval } | null {
  if (!key) return null
  const m = /^qm_(starter|pro|crew)_(month|year)$/.exec(key)
  if (!m) return null
  return { plan: m[1] as PlanId, interval: m[2] as BillingInterval }
}

/** App base URL for Checkout / Portal return links, trailing slash stripped. */
export const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

// Resolve a Price ID from its lookup_key. Cached per-process — the mapping
// is immutable once the setup script has run.
const priceCache = new Map<string, string>()

export async function resolvePriceId(
  plan: PlanId,
  interval: BillingInterval,
): Promise<string> {
  const key = lookupKey(plan, interval)
  const cached = priceCache.get(key)
  if (cached) return cached
  const stripe = getStripe()
  const res = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
  const price = res.data[0]
  if (!price) {
    throw new Error(
      `Stripe price not found for lookup_key "${key}". Run: node --env-file=.env.local scripts/setup-stripe-billing.mjs`,
    )
  }
  priceCache.set(key, price.id)
  return price.id
}

/**
 * Return the tenant's Stripe customer, creating one the first time. The
 * caller supplies `persist` so we can write the new id back to the tenant
 * row (we don't import supabase here — keeps this lib side-effect-light and
 * unit-testable).
 */
export async function getOrCreateCustomer(opts: {
  tenantId: string
  email: string | null
  name: string | null
  existingCustomerId: string | null
  persist: (customerId: string) => Promise<void>
}): Promise<string> {
  if (opts.existingCustomerId) return opts.existingCustomerId
  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: opts.email ?? undefined,
    name: opts.name ?? undefined,
    metadata: { tenant_id: opts.tenantId },
  })
  await opts.persist(customer.id)
  return customer.id
}

/**
 * Create a subscription Checkout Session. A 14-day trial is applied ONLY to
 * Starter Monthly (hasFreeTrial); every other plan/interval bills
 * immediately. Returns the hosted URL to redirect the tradie to. No
 * `payment_method_types` — Stripe picks eligible methods dynamically.
 */
export async function createSubscriptionCheckout(opts: {
  tenantId: string
  customerId: string
  plan: PlanId
  interval: BillingInterval
}): Promise<string> {
  const stripe = getStripe()
  const price = await resolvePriceId(opts.plan, opts.interval)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: opts.customerId,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: opts.tenantId,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    subscription_data: {
      // Trial on Starter Monthly only; every other plan/interval bills now.
      ...(hasFreeTrial(opts.plan, opts.interval)
        ? { trial_period_days: TRIAL_DAYS }
        : {}),
      metadata: { tenant_id: opts.tenantId, plan: opts.plan, interval: opts.interval },
    },
    metadata: { tenant_id: opts.tenantId, plan: opts.plan, interval: opts.interval },
    success_url: `${APP_URL}/dashboard?tab=billing&subscribed=1`,
    cancel_url: `${APP_URL}/pricing`,
  })
  if (!session.url) throw new Error('Stripe did not return a Checkout URL')
  return session.url
}

/** Create a Customer Portal session for self-service management. */
export async function createPortalSession(customerId: string): Promise<string> {
  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/dashboard?tab=billing`,
  })
  return session.url
}

/**
 * Map a Stripe Subscription onto the columns we mirror on tenants.*.
 * Defensive about where the period end lives — recent Stripe API versions
 * moved `current_period_end` onto the subscription ITEM, older ones keep it
 * on the subscription — so we read whichever is present.
 */
export function subscriptionToTenantPatch(
  sub: Stripe.Subscription,
): Record<string, unknown> {
  const item = sub.items?.data?.[0]
  const price = item?.price
  const parsed = parseLookupKey(price?.lookup_key ?? null)
  const intervalFromPrice = price?.recurring?.interval
  const interval =
    parsed?.interval ??
    (intervalFromPrice === 'year' ? 'year' : intervalFromPrice === 'month' ? 'month' : null)

  const periodEndUnix =
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null

  return {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    subscription_plan: parsed?.plan ?? null,
    subscription_interval: interval,
    subscription_current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString()
      : null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    subscription_cancel_at_period_end: !!sub.cancel_at_period_end,
  }
}
