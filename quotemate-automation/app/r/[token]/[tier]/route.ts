// Short-link redirector — keeps the SMS body small.
// SMS contains: https://<domain>/r/<token>/<tier>  (~ 60 chars)
//
// WP6 reorder (book first, pay LAST). This is the single choke-point that
// every pay link flows through — the on-page tier buttons AND the pay
// links already sitting in 138 customers' SMS threads. So flipping the
// funnel here flips it everywhere ("force book-first for all"):
//
//   price hold expired      → /q/<token>          (blocked: refresh needed)
//   already paid           → /q/<token>/paid
//   not paid, NO slot yet   → /q/<token>/book?tier=<tier>   (pick a time)
//   not paid, slot chosen   → Stripe Checkout (deposit = the last step)
//   inspection ($99 fee)   → Stripe (pay-first preserved; see booking.ts)
//
// Two hardening rules live here (both surfaced 2026-07-01):
//
//   1. EXPIRY GATE. An expired price hold must not lead into booking or
//      checkout — the customer is bounced back to the quote page, which
//      shows the "price expired, reply for a refreshed quote" state.
//      Inspection ($99 fee) has no price hold; an already-paid quote is
//      past this concern — both skip the gate.
//
//   2. FRESH SESSION ON DEMAND. Stripe Checkout Sessions expire after 24h
//      (Stripe's max), far shorter than the 7-day price hold. The Session
//      pre-baked at draft time is therefore usually DEAD by the time a
//      customer clicks (Stripe shows "You're all done here / timed out").
//      So on the stripe path we MINT A FRESH Session per click instead of
//      redirecting to the stored, stale URL. The realised early-booking
//      discount (if any) is re-applied so the price is correct.

import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { payRedirectTarget } from '@/lib/quote/booking'
import { isPriceHoldExpired } from '@/lib/quote/hold'
import {
  createCheckoutSessionForTier,
  createInspectionCheckoutSession,
} from '@/lib/stripe/checkout'

// A single Stripe Session create runs on the stripe path — give it headroom
// over the fast-redirect default so a cold start can't time out mid-mint.
export const maxDuration = 30

// Lazy Supabase client — created on first use, NOT at import, so the pure
// helpers (resolvePayRedirect / VALID_TIERS) can be unit-tested without any
// env vars set. Mirrors app/r/solar/[token]/[tier]/route.ts. The tiny
// makeClient() wrapper preserves the inferred (any-row) client type —
// annotating with ReturnType<typeof createClient> resolves rows to `never`.
function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
let _supabase: ReturnType<typeof makeClient> | null = null
function db() {
  if (!_supabase) _supabase = makeClient()
  return _supabase
}

export const VALID_TIERS = new Set(['good', 'better', 'best', 'inspection'])

export type PayRedirectDecision =
  /** Price hold lapsed — bounce to the quote page (shows the expired state). */
  | { kind: 'expired'; url: string }
  /** Already paid — thank-you page. */
  | { kind: 'paid'; url: string }
  /** No slot chosen yet — pick a time first. */
  | { kind: 'book'; url: string }
  /** Deposit is the last step — caller mints a FRESH Session (no static URL). */
  | { kind: 'stripe' }

/**
 * Pure redirect decision for /r/<token>/<tier> — kept side-effect-free so
 * the funnel order (and the new expiry gate) can be unit-tested without a
 * DB or Stripe. The 'stripe' kind carries no URL: the impure GET handler
 * mints a live Session for it (the stored link is usually expired).
 */
export function resolvePayRedirect(input: {
  tier: string
  paid: boolean
  scheduledAt: string | null | undefined
  /** isPriceHoldExpired(price_hold_until, created_at) computed by the caller. */
  expired: boolean
  token: string
  appUrl: string
}): PayRedirectDecision {
  const { tier, paid, scheduledAt, expired, token, appUrl } = input

  // Expiry gate — priced tiers only. Inspection has no price hold, and an
  // already-paid quote has transacted, so neither is blocked.
  if (tier !== 'inspection' && !paid && expired) {
    return { kind: 'expired', url: `${appUrl}/q/${token}` }
  }

  const target = payRedirectTarget({ paid, scheduledAt, tier })
  if (target === 'paid') {
    return { kind: 'paid', url: `${appUrl}/q/${token}/paid?tier=${tier}&already=1` }
  }
  if (target === 'book') {
    return { kind: 'book', url: `${appUrl}/q/${token}/book?tier=${tier}` }
  }
  return { kind: 'stripe' }
}

/**
 * Mint a fresh deposit Checkout Session for this quote+tier and persist the
 * URL back onto quotes.stripe_links (so the /paid page and any re-click stay
 * consistent). Returns the live Session URL, or null if minting fails — the
 * caller then falls back to the stored link rather than hard-failing.
 */
async function mintFreshDepositUrl(
  quote: {
    id: string
    intake_id: string | null
    good: unknown
    better: unknown
    best: unknown
    stripe_links: Record<string, string> | null
  },
  tier: string,
  token: string,
): Promise<string | null> {
  const appUrl = process.env.APP_URL!
  try {
    const { data: intakeRow } = await db()
      .from('intakes')
      .select('job_type, scope, caller')
      .eq('id', quote.intake_id)
      .maybeSingle()
    const intake = {
      job_type: (intakeRow?.job_type as string) ?? 'other',
      scope: (intakeRow?.scope as { item_count?: number; description?: string } | null) ?? null,
      caller: (intakeRow?.caller as { name?: string; email?: string } | null) ?? null,
    }

    let url: string | null = null
    if (tier === 'inspection') {
      url = await createInspectionCheckoutSession({
        quoteId: quote.id,
        intake,
        shareToken: token,
        appUrl,
      })
    } else {
      // Re-apply the realised early-booking discount (if the customer earned
      // one) so the fresh Session charges the same discounted deposit the
      // page advertised. Best-effort — the column lands via migration 044.
      let discountPct = 0
      try {
        const { data: eb } = await db()
          .from('quotes')
          .select('applied_discount_pct')
          .eq('id', quote.id)
          .maybeSingle()
        discountPct = Number(eb?.applied_discount_pct ?? 0)
      } catch {
        discountPct = 0
      }

      type CheckoutOpts = Parameters<typeof createCheckoutSessionForTier>[0]
      url = await createCheckoutSessionForTier({
        quote: {
          id: quote.id,
          good: quote.good ?? null,
          better: quote.better ?? null,
          best: quote.best ?? null,
          // 30% matches the hardcoded deposit used at draft time
          // (createCheckoutSessionsForQuote in the estimate route).
          deposit_pct: 30,
        } as unknown as CheckoutOpts['quote'],
        tierKey: tier as 'good' | 'better' | 'best',
        intake: intake as unknown as CheckoutOpts['intake'],
        shareToken: token,
        appUrl,
        discountPct,
      })
    }

    if (url) {
      const links = { ...(quote.stripe_links ?? {}) }
      links[tier] = url
      await db().from('quotes').update({ stripe_links: links }).eq('id', quote.id)
    }
    return url
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string; tier: string }> }) {
  const { token, tier } = await ctx.params
  if (!VALID_TIERS.has(tier)) {
    return new Response('Invalid tier', { status: 400 })
  }

  const { data: quote } = await db()
    .from('quotes')
    .select(
      'id, stripe_links, paid_at, scheduled_at, created_at, price_hold_until, intake_id, good, better, best',
    )
    .eq('share_token', token)
    .single()

  if (!quote) return new Response('Not found', { status: 404 })

  const expired = isPriceHoldExpired(
    quote.price_hold_until as string | null,
    quote.created_at as string | null,
  )

  const decision = resolvePayRedirect({
    tier,
    paid: !!quote.paid_at,
    scheduledAt: (quote.scheduled_at as string | null) ?? null,
    expired,
    token,
    appUrl: process.env.APP_URL!,
  })

  if (decision.kind !== 'stripe') {
    return Response.redirect(decision.url, 302)
  }

  // Deposit is the last step — mint a live Session (the stored one is
  // almost always past Stripe's 24h expiry by now).
  const fresh = await mintFreshDepositUrl(
    {
      id: quote.id as string,
      intake_id: (quote.intake_id as string | null) ?? null,
      good: quote.good,
      better: quote.better,
      best: quote.best,
      stripe_links: (quote.stripe_links as Record<string, string> | null) ?? null,
    },
    tier,
    token,
  )
  if (fresh) return Response.redirect(fresh, 302)

  // Mint failed — fall back to the stored link so the flow isn't hard-broken
  // (no worse than the pre-fix behaviour).
  const stored = (quote.stripe_links as Record<string, string> | null)?.[tier]
  if (stored) return Response.redirect(stored, 302)
  return new Response('No payment link for this tier', { status: 404 })
}
