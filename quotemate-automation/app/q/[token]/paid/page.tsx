// Stripe success-URL landing — a ROUTER, not a page.
//
// Every Checkout Session for a quote returns here (lib/stripe/checkout.ts
// success_url). Its only jobs are:
//
//   1. Resolve the webhook race. Stripe redirects the customer here the
//      instant they pay, but paid_at is written asynchronously by the webhook.
//      When we hold a ?session_id= and the row still reads unpaid, we verify
//      the Session with Stripe ourselves and run the SAME claim+finalise the
//      webhook uses (lib/quote/paid-confirm.ts — idempotent, so whichever
//      lands second is a no-op). Without this a customer who beat the webhook
//      saw no confirmation and no way into booking, and simply left.
//
//   2. Hand off to whichever of the three real pages they belong on:
//        paid, no slot -> /q/<token>/book    (pick a time)
//        paid, slot    -> /q/<token>/thanks  (confirmed)
//        not paid yet  -> /q/<token>         (payment still settling)
//
// It rendered a full confirmation surface until 2026-07-22 — the video, the
// "what's booked" card, the calendar links. All of that moved to /thanks so
// the confirmation lives in one place for every funnel (spec
// 2026-07-22-booking-three-page-split R5). Only the not-found branch still
// renders, because there is nowhere to send a token we cannot resolve.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { BrandMark } from '@/app/_components/BrandMark'
import { paidPageTarget, resolveNextTier } from '@/lib/quote/booking'
import { confirmPaidFromSession } from '@/lib/quote/paid-confirm'
import { getStripe } from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function PaidPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string; session_id?: string; already?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, paid_at, paid_tier, selected_tier, scheduled_at, intake_id, tenant_id, share_token')
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) {
    // Nowhere to route them — say so plainly and reassure them about the money.
    return (
      <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
        <div className="noise-overlay" aria-hidden="true" />
        <header className="relative z-10 border-b border-ink-line">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark className="h-10 w-auto" />
              <span className="font-extrabold uppercase tracking-tight">QuoteMax</span>
            </Link>
          </div>
        </header>
        <div className="relative z-10 mx-auto max-w-2xl px-5 py-9 sm:px-6 sm:py-12">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
            Payment
          </span>
          <h1 className="mt-6 text-[clamp(1.8rem,5vw,3rem)] font-extrabold uppercase leading-[1.05] tracking-[-0.03em]">
            We couldn&apos;t <span className="text-accent">find</span> this quote
          </h1>
          <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-text-sec">
            If you were charged, your payment is safe — Stripe will email your receipt. Reply to your
            tradie&apos;s SMS if you need a hand.
          </p>
        </div>
      </main>
    )
  }

  const scheduledAt = (quote.scheduled_at as string | null) ?? null
  let paidAt = (quote.paid_at as string | null) ?? null
  let paidTier = (quote.paid_tier as string | null) ?? null

  if (!paidAt && sp.session_id) {
    // Extracted + unit-tested (lib/quote/paid-confirm.test.ts). Never throws;
    // Stripe unreachable → route from DB state, webhook stays authoritative.
    const guard = await confirmPaidFromSession(
      supabase,
      (id) => getStripe().checkout.sessions.retrieve(id),
      {
        quote: {
          id: quote.id as string,
          scheduled_at: scheduledAt,
          intake_id: (quote.intake_id as string | null) ?? null,
          tenant_id: (quote.tenant_id as string | null) ?? null,
          share_token: (quote.share_token as string | null) ?? null,
        },
        sessionId: sp.session_id,
      },
    )
    if (guard.paid) {
      paidAt = new Date().toISOString()
      paidTier = paidTier ?? guard.tier
    }
  }

  const tier = resolveNextTier(
    paidTier ?? sp.tier ?? null,
    quote.selected_tier as string | null,
  )
  const q = `?tier=${encodeURIComponent(tier)}`

  switch (paidPageTarget({ paid: !!paidAt, scheduledAt })) {
    case 'thanks':
      redirect(`/q/${token}/thanks${q}`)
    case 'book':
      redirect(`/q/${token}/book${q}`)
    default:
      redirect(`/q/${token}`)
  }
}
