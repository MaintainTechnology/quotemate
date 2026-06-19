// Idempotently create the QuoteMate subscription Products + Prices in Stripe.
//
//   node --env-file=.env.local scripts/setup-stripe-billing.mjs
//
// Creates 3 products (Starter / Pro / Crew) and 6 prices (monthly + annual
// each), addressed at runtime by lookup_key `qm_<plan>_<interval>`. Safe to
// re-run: a price whose lookup_key already exists is left untouched.
//
// Amounts are AUD, ex-GST, and MUST match app/_components/pricing-data.ts.
// Prices are created with tax_behavior:'exclusive' so enabling Stripe Tax
// later adds GST on top without changing the headline price.

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY not set')
  process.exit(1)
}
const stripe = new Stripe(key)

// id → product name/description + monthly/annual amounts in AUD cents.
const PLANS = [
  {
    id: 'starter',
    name: 'QuoteMate Starter',
    description: 'SMS receptionist + AI quoting for solo tradies.',
    monthly: 4900,
    yearly: 49000,
  },
  {
    id: 'pro',
    name: 'QuoteMate Pro',
    description: 'SMS + AI voice receptionist, multi-trade, branded quotes.',
    monthly: 12900,
    yearly: 129000,
  },
  {
    id: 'crew',
    name: 'QuoteMate Crew',
    description: 'Higher volume, multi-trade teams, all estimators.',
    monthly: 29900,
    yearly: 299000,
  },
]

const CURRENCY = 'aud'

// Find an existing QuoteMate product for this plan (by metadata.qm_plan),
// scanning active products. Returns the product or null.
async function findProduct(planId) {
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.qm_plan === planId) return product
  }
  return null
}

async function ensureProduct(plan) {
  const existing = await findProduct(plan.id)
  if (existing) {
    console.log(`  product exists: ${existing.id} (${plan.name})`)
    return existing
  }
  const created = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { qm_plan: plan.id },
  })
  console.log(`  product created: ${created.id} (${plan.name})`)
  return created
}

async function findPriceByLookupKey(lookupKey) {
  const res = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })
  return res.data[0] ?? null
}

async function ensurePrice(product, plan, interval) {
  const lookupKey = `qm_${plan.id}_${interval}`
  const existing = await findPriceByLookupKey(lookupKey)
  if (existing) {
    console.log(`  price exists: ${existing.id} (${lookupKey}, ${existing.unit_amount} ${existing.currency})`)
    return existing
  }
  const unitAmount = interval === 'month' ? plan.monthly : plan.yearly
  const created = await stripe.prices.create({
    product: product.id,
    currency: CURRENCY,
    unit_amount: unitAmount,
    recurring: { interval },
    lookup_key: lookupKey,
    tax_behavior: 'exclusive',
    metadata: { qm_plan: plan.id, qm_interval: interval },
  })
  console.log(`  price created: ${created.id} (${lookupKey}, ${unitAmount} ${CURRENCY})`)
  return created
}

console.log('Setting up QuoteMate subscription products + prices...\n')
const summary = []
for (const plan of PLANS) {
  console.log(`${plan.name}:`)
  const product = await ensureProduct(plan)
  for (const interval of ['month', 'year']) {
    const price = await ensurePrice(product, plan, interval)
    summary.push({ lookup_key: `qm_${plan.id}_${interval}`, price_id: price.id })
  }
  console.log('')
}

console.log('Done. Lookup key → price id:')
for (const row of summary) {
  console.log(`  ${row.lookup_key.padEnd(18)} ${row.price_id}`)
}
console.log(
  '\nRuntime resolves prices by lookup_key — no env changes needed. Make sure the Customer Portal is configured in the Stripe Dashboard (Settings → Billing → Customer portal) and that the webhook endpoint receives customer.subscription.* events.',
)
