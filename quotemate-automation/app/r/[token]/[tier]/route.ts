// Short-link redirector — keeps the SMS body small.
// SMS contains: https://<domain>/r/<token>/<tier>  (~ 60 chars)
//
// Funnel order (lib/quote/booking.ts payRedirectTarget). This is the
// choke-point every generic pay link flows through — the on-page tier
// buttons AND the pay links already sitting in customers' SMS threads —
// so the order enforced here holds everywhere:
//
//   price hold expired            → /q/<token>       (blocked: refresh needed)
//   already paid                  → /q/<token>/paid  (never re-charge)
//   tenant has NO bookable windows → /q/<token>?slots=0 (never charge into an
//                                   empty calendar — see rule 3)
//   otherwise, not paid           → Stripe Checkout  (PAY-FIRST on every
//                                   funnel since 2026-07-22: pay → pick a time
//                                   → thank-you)
//
// Three hardening rules live here (1 and 2 surfaced 2026-07-01):
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
//
//   3. NO-SLOTS GUARD (2026-07-22). Pay-first means the customer commits
//      BEFORE seeing any times. If the tenant has published no bookable
//      windows, charging them sells a visit nobody can schedule — so we
//      refuse and send them back to the quote with ?slots=0, which renders
//      "we'll text you to arrange a time" and takes no money. This also
//      closes the old redirect loop: under book-first this case returned
//      kind:'book' → /q/<token>/book, whose no-slots CTA pointed straight
//      back at /r, so the customer could never reach checkout at all.

import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { canTakePayment, payRedirectTarget } from '@/lib/quote/booking'
import { isPriceHoldExpired } from '@/lib/quote/hold'
import { resolveBookingOptions, buildBookedKeys } from '@/lib/quote/slots'
import { tzForState } from '@/lib/quote/availability'
import { pipelineLog } from '@/lib/log/pipeline'
import {
  createCheckoutSessionForTier,
  createInspectionCheckoutSession,
  expireCheckoutSession,
} from '@/lib/stripe/checkout'
import { connectDestinationForTenantId } from '@/lib/stripe/connect'

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
  /** Tenant has no bookable windows — back to the quote, uncharged. */
  | { kind: 'no-slots'; url: string }
  /** Payment is the next step — caller mints a FRESH Session (no static URL). */
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
  /** How many bookable windows the tenant currently has, resolved by the
   *  caller with resolveBookingOptions — the SAME resolver the booking page
   *  renders from, so this answer and the calendar can never disagree. */
  bookableCount: number
}): PayRedirectDecision {
  const { tier, paid, scheduledAt, expired, token, appUrl, bookableCount } = input

  // Expiry gate — priced tiers only. Inspection has no price hold, and an
  // already-paid quote has transacted, so neither is blocked.
  if (tier !== 'inspection' && !paid && expired) {
    return { kind: 'expired', url: `${appUrl}/q/${token}` }
  }

  const target = payRedirectTarget({ paid, scheduledAt, tier })
  if (target === 'paid') {
    return { kind: 'paid', url: `${appUrl}/q/${token}/paid?tier=${tier}&already=1` }
  }

  // About to charge — refuse if there is nothing to book afterwards. Checked
  // AFTER 'paid' so an already-paid customer is never bounced: they are not
  // being charged again, and their booking page handles the empty case itself.
  if (!canTakePayment({ bookableCount })) {
    return { kind: 'no-slots', url: `${appUrl}/q/${token}?slots=0` }
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
    tenant_id: string | null
    good: unknown
    better: unknown
    best: unknown
    stripe_links: Record<string, string> | null
    /** Per-quote deposit % (quotes.deposit_pct, DB default 30). */
    deposit_pct: number | null
  },
  tier: string,
  token: string,
): Promise<string | null> {
  const appUrl = process.env.APP_URL!
  try {
    // Connect routing (2% platform fee, destination = the tenant's live
    // connected account) — same decision the draft-time Session used.
    const connect = await connectDestinationForTenantId(db(), quote.tenant_id)

    const { data: intakeRow } = await db()
      .from('intakes')
      .select('job_type, scope, caller, trade')
      .eq('id', quote.intake_id)
      .maybeSingle()
    const intake = {
      job_type: (intakeRow?.job_type as string) ?? 'other',
      scope: (intakeRow?.scope as { item_count?: number; description?: string } | null) ?? null,
      caller: (intakeRow?.caller as { name?: string; email?: string } | null) ?? null,
    }

    // P1 — the freshly-minted Session must honour gst_registered like every
    // display surface and the stored total. Best-effort: no book row (legacy
    // tenant-less quote) defaults to registered, today's behaviour.
    let gstRegistered = true
    if (quote.tenant_id) {
      const { data: pb } = await db()
        .from('pricing_book')
        .select('gst_registered')
        .eq('tenant_id', quote.tenant_id)
        .eq('trade', (intakeRow?.trade as string | null) ?? 'electrical')
        .maybeSingle()
      gstRegistered = (pb as { gst_registered?: boolean | null } | null)?.gst_registered ?? true
    }

    let url: string | null = null
    if (tier === 'inspection') {
      url = await createInspectionCheckoutSession({
        quoteId: quote.id,
        intake,
        shareToken: token,
        appUrl,
        connect,
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
          // Honour the per-quote deposit % (quotes.deposit_pct, stamped
          // from the tenant rate card at draft time; DB default 30). The
          // column was previously ignored here — a hardcoded 30 — so a
          // tenant deposit change never reached the charge.
          deposit_pct:
            typeof quote.deposit_pct === 'number' &&
            Number.isFinite(quote.deposit_pct) &&
            quote.deposit_pct >= 1 &&
            quote.deposit_pct <= 90
              ? Math.round(quote.deposit_pct)
              : 30,
          gst_registered: gstRegistered,
        } as unknown as CheckoutOpts['quote'],
        tierKey: tier as 'good' | 'better' | 'best',
        intake: intake as unknown as CheckoutOpts['intake'],
        shareToken: token,
        appUrl,
        discountPct,
        connect,
      })
    }

    if (url) {
      const links = { ...(quote.stripe_links ?? {}) }
      const replaced = links[tier]
      links[tier] = url
      await db().from('quotes').update({ stripe_links: links }).eq('id', quote.id)
      // Expire the Session this one replaces (best-effort, tolerant of
      // already-expired/paid) so at most ONE payable Session exists per
      // quote+tier. Without this a customer with two tabs / a double-click
      // could complete an ORPHANED older Session — the webhook's paid_at
      // guard silently drops the duplicate record, but Stripe still charges.
      if (replaced && replaced !== url) await expireCheckoutSession(replaced)
    }
    return url
  } catch (e: unknown) {
    pipelineLog('dispatch').err(
      'fresh deposit Session mint failed — caller falls back to stored link',
      e instanceof Error ? e.message : String(e),
      { quote_id: quote.id, tier },
    )
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
      'id, stripe_links, paid_at, scheduled_at, created_at, price_hold_until, needs_inspection, intake_id, tenant_id, good, better, best, deposit_pct',
    )
    .eq('share_token', token)
    .single()

  if (!quote) return new Response('Not found', { status: 404 })

  // Inspection-required quotes are EXEMPT from the price-hold gate — their
  // tier prices are indicative (final price confirmed on-site) and the /q
  // page already exempts them (priceExpired requires !isInspection), so
  // gating here would silently bounce their CTAs back to a banner-less page.
  const expired =
    !quote.needs_inspection &&
    isPriceHoldExpired(
      quote.price_hold_until as string | null,
      quote.created_at as string | null,
    )

  // How many windows the customer will actually be able to choose from after
  // paying. Derived with resolveBookingOptions — the SAME resolver the booking
  // page renders from — so the guard and the calendar can never disagree.
  // Best-effort: a lookup failure must not block a legitimate payment, so an
  // unknown count is treated as "slots exist" and the customer proceeds.
  let bookableCount = 1
  if (quote.tenant_id) {
    try {
      const { data: tenantRow } = await db()
        .from('tenants')
        .select('available_slots, default_availability, state')
        .eq('id', quote.tenant_id)
        .maybeSingle()
      if (tenantRow) {
        const tz = tzForState((tenantRow as { state?: string | null }).state ?? null)
        const { data: bookedRows } = await db()
          .from('quotes')
          .select('scheduled_at, scheduled_window')
          .eq('tenant_id', quote.tenant_id)
          .in('booking_state', ['reserved', 'booked'])
          .not('scheduled_at', 'is', null)
          .neq('id', quote.id)
        bookableCount = resolveBookingOptions({
          availability:
            (tenantRow as { default_availability?: unknown }).default_availability ?? null,
          availableSlots: (tenantRow as { available_slots?: unknown }).available_slots,
          timezone: tz,
          bookedKeys: buildBookedKeys(bookedRows ?? [], tz),
        }).length
      }
    } catch (e: unknown) {
      pipelineLog('dispatch').err(
        'slot count lookup failed — allowing payment through',
        e instanceof Error ? e.message : String(e),
        { quote_id: quote.id },
      )
    }
  }

  const decision = resolvePayRedirect({
    tier,
    paid: !!quote.paid_at,
    scheduledAt: (quote.scheduled_at as string | null) ?? null,
    expired,
    token,
    appUrl: process.env.APP_URL!,
    bookableCount,
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
      tenant_id: (quote.tenant_id as string | null) ?? null,
      deposit_pct: (quote.deposit_pct as number | null) ?? null,
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
  // (no worse than the pre-fix behaviour). Logged: this link is usually past
  // Stripe's 24h expiry, so the customer likely sees the timed-out page.
  const stored = (quote.stripe_links as Record<string, string> | null)?.[tier]
  pipelineLog('dispatch').err(
    'mint failed — falling back to stored (likely dead) Session link',
    null,
    { quote_id: quote.id, tier, has_stored: !!stored },
  )
  if (stored) return Response.redirect(stored, 302)
  return new Response('No payment link for this tier', { status: 404 })
}
