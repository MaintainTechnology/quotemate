// OpenSolar proposal → Stripe deposit Checkout.
//
// The deposit amount is the tradie's own figure from their OpenSolar
// design's featured payment option (proposal.deposit_aud) — never
// recomputed. Created once on confirm (test-mode Stripe, same posture as
// the rest of the repo); the customer page links the stored session URL.
// Returns null when the design carries no usable deposit — the page
// simply renders without a payment CTA (degradation matrix §4.8).

import { getStripe } from '@/lib/stripe/client'
import { formatAud, type OpenSolarProposalDesign } from './proposal'

export async function createOpenSolarDepositCheckoutSession(opts: {
  token: string
  design: OpenSolarProposalDesign
  customerEmail?: string | null
  appUrl: string
}): Promise<string | null> {
  const deposit = opts.design.proposal?.deposit_aud
  if (deposit == null || !Number.isFinite(deposit) || deposit <= 0) return null
  const depositCents = Math.round(deposit * 100)

  const title =
    opts.design.system_name ??
    (opts.design.kw_stc != null ? `${opts.design.kw_stc.toFixed(2)} kW solar system` : 'Solar system')
  const total =
    opts.design.price_including_tax_aud != null
      ? formatAud(opts.design.price_including_tax_aud)
      : null

  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'aud',
          product_data: {
            name: `${title} — deposit`,
            description: total
              ? `Deposit · total system price ${total} · balance per your proposal`
              : 'Deposit · balance per your proposal',
          },
          unit_amount: depositCents,
        },
        quantity: 1,
      },
    ],
    customer_email: opts.customerEmail || undefined,
    success_url: `${opts.appUrl}/q/opensolar/${opts.token}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/opensolar/${opts.token}`,
    metadata: {
      opensolar_token: opts.token,
      deposit_cents: String(depositCents),
    },
  })
  return session.url ?? null
}

/**
 * Verify a Checkout session (the ?session_id=… success redirect) really
 * belongs to this proposal and was paid. Never throws.
 */
export async function verifyOpenSolarDepositSession(
  sessionId: string,
  token: string,
): Promise<boolean> {
  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    return session.payment_status === 'paid' && session.metadata?.opensolar_token === token
  } catch {
    return false
  }
}
