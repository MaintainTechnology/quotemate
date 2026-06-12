// Pylon proposal → Stripe deposit Checkout.
//
// The deposit amount is the tradie's own figure from their Pylon design
// (proposal_quote.deposit_amount_formatted) — parsed, never recomputed.
// Created once on confirm (test-mode Stripe, same posture as the rest of
// the repo); the customer page links the stored session URL. Returns
// null when the design carries no usable deposit — the page simply
// renders without a payment CTA.

import { getStripe } from '@/lib/stripe/client'
import { parseFormattedAudToCents, type PylonProposalDesign } from './proposal'

export async function createPylonDepositCheckoutSession(opts: {
  token: string
  design: PylonProposalDesign
  customerEmail?: string | null
  appUrl: string
}): Promise<string | null> {
  const depositCents = parseFormattedAudToCents(
    opts.design.proposal_quote?.deposit_amount_formatted,
  )
  if (depositCents === null || depositCents <= 0) return null

  const title = opts.design.label ?? opts.design.title ?? 'Solar system'
  const total = opts.design.proposal_quote?.total_price_formatted

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
    success_url: `${opts.appUrl}/q/pylon/${opts.token}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/pylon/${opts.token}`,
    metadata: {
      pylon_token: opts.token,
      deposit_cents: String(depositCents),
    },
  })
  return session.url ?? null
}

/**
 * Verify a Checkout session (the ?session_id=… success redirect) really
 * belongs to this proposal and was paid. Never throws.
 */
export async function verifyPylonDepositSession(
  sessionId: string,
  token: string,
): Promise<boolean> {
  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    return session.payment_status === 'paid' && session.metadata?.pylon_token === token
  } catch {
    return false
  }
}
