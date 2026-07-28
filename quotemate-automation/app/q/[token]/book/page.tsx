// Customer-facing BOOKING page — step 2 of 3.
//
//   /q/<token>  ->  Stripe  ->  /q/<token>/book  ->  /q/<token>/thanks
//
// This page does exactly one thing: let the customer pick a date and then a
// time. Everything else it used to carry — the "time held, now pay" state, the
// step strip, the booked confirmation — belonged to the book-first order and
// is gone (spec 2026-07-22-booking-three-page-split R3/R5). The confirmation
// lives on /thanks, which the booking POST redirects to.
//
// Serves electrical, plumbing AND solar: a solar estimate writes a twin
// `quotes` row with share_token = the estimate's public_token, so solar
// customers book here too.
//
// States:
//   1. token not found          -> 404
//   2. price hold lapsed        -> "price expired" (never book a stale price)
//   3. not paid                 -> the pay short-link (pay-first)
//   4. already booked           -> /thanks
//   5. paid, no slot            -> the calendar
//   6. paid, no slot, no windows -> the calendar's own empty state

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { resolveNextTier } from '@/lib/quote/booking'
import { isPriceHoldExpired } from '@/lib/quote/hold'
import { resolveBookingOptions, buildBookedKeys } from '@/lib/quote/slots'
import { tzForState } from '@/lib/quote/availability'
import { BrandMark } from '@/app/_components/BrandMark'
import { BookingCalendar, type CalendarDay } from '@/app/q/_chrome/BookingCalendar'
import { toCalendarDays } from '@/app/q/_chrome/calendar-days'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Short timezone note ("AEST") so the customer knows whose clock the times
 *  are on — they are generated in the TENANT's zone, not the visitor's. */
function shortTzLabel(tz: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date())
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null
  } catch {
    return null
  }
}

export default async function BookingPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, paid_at, paid_tier, selected_tier, scheduled_at, share_token, tenant_id, created_at, price_hold_until, needs_inspection',
    )
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) notFound()

  const isPaid = !!quote.paid_at
  const isScheduled = !!quote.scheduled_at

  // Tier the pay step charges, when we have to bounce them to it.
  const tier = resolveNextTier(sp.tier ?? null, quote.selected_tier as string | null)

  // Lapsed price — block booking entirely; pricing may have changed since the
  // quote was sent. An already-paid quote has transacted and is exempt, as are
  // inspection-required quotes whose prices are indicative by design.
  const priceExpired =
    !isPaid &&
    !(quote as { needs_inspection?: boolean | null }).needs_inspection &&
    isPriceHoldExpired(
      (quote as { price_hold_until?: string | null }).price_hold_until ?? null,
      (quote as { created_at?: string | null }).created_at ?? null,
    )

  if (priceExpired) {
    return (
      <Shell token={token}>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-warning">
          Price expired
        </span>
        <h1 className="mt-6 text-[clamp(1.6rem,4vw,2.5rem)] font-extrabold uppercase leading-[1.05] tracking-[-0.03em]">
          This quote&apos;s price has <span className="text-accent">lapsed</span>
        </h1>
        <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-text-sec">
          The held price on this quote has expired, so it can&apos;t be booked as-is
          — pricing may have changed. Reply to your tradie&apos;s SMS for a refreshed
          quote and you can lock in a time then.
        </p>
        <Link
          href={`/q/${token}`}
          className="mt-8 inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
        >
          ← Back to quote
        </Link>
      </Shell>
    )
  }

  // Pay-first: booking follows the order the customer placed.
  if (!isPaid) redirect(`/r/${token}/${tier}`)

  // Already booked → the thank-you page owns the confirmation.
  if (isScheduled) redirect(`/q/${token}/thanks`)

  const { data: tenantRow } = quote.tenant_id
    ? await supabase
        .from('tenants')
        .select('id, business_name, available_slots, default_availability, state')
        .eq('id', quote.tenant_id)
        .maybeSingle()
    : { data: null }

  const tz = tzForState(tenantRow?.state as string | null)

  // Windows already taken on this tenant, so a half-day can't be double-booked.
  let bookedKeys = new Set<string>()
  if (quote.tenant_id) {
    const { data: bookedRows } = await supabase
      .from('quotes')
      .select('scheduled_at, scheduled_window')
      .eq('tenant_id', quote.tenant_id)
      .in('booking_state', ['reserved', 'booked'])
      .not('scheduled_at', 'is', null)
      .neq('id', quote.id)
    bookedKeys = buildBookedKeys(bookedRows ?? [], tz)
  }

  // The booking API derives this SAME list, so a picked option always
  // validates and can never 409 a legitimate choice.
  const options = resolveBookingOptions({
    availability: tenantRow?.default_availability ?? null,
    availableSlots: tenantRow?.available_slots,
    timezone: tz,
    bookedKeys,
  })
  const calDays: CalendarDay[] = toCalendarDays(options, tz)
  const tradieName = tenantRow?.business_name ?? null

  return (
    <Shell token={token}>
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
        Paid · choose your time
      </span>
      <h1 className="mt-3 text-[clamp(1.5rem,3.5vw,2.25rem)] font-extrabold uppercase leading-none tracking-[-0.035em]">
        Pick a time that <span className="text-accent">works</span>.
      </h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-text-sec">
        {tradieName ? `${tradieName}'s` : "Your tradie's"} next available times —
        payment received, so choosing one locks your visit in.
      </p>
      <div className="mt-6">
        <BookingCalendar
          days={calDays}
          endpoint={`/api/q/${token}/book`}
          tzLabel={shortTzLabel(tz)}
          labels={{ idle: 'Confirm this time →', submitting: 'Confirming…', done: 'Booked ✓' }}
        />
      </div>
    </Shell>
  )
}

function Shell({ token, children }: { token: string; children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <div className="noise-overlay" aria-hidden="true" />
      <header className="relative z-10 border-b border-ink-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-auto" />
            <span className="font-extrabold uppercase tracking-tight">QuoteMax</span>
          </Link>
          <Link
            href={`/q/${token}`}
            className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim transition-colors hover:text-accent"
          >
            ← Back to quote
          </Link>
        </div>
      </header>

      <div className="qm-quote relative z-10 mx-auto max-w-3xl px-5 py-7 sm:px-6 sm:py-9">
        {children}
      </div>

      {/* Dark-on-yellow only — white on the accent is ~1.4:1 and forbidden. */}
      <div className="relative z-10 bg-accent px-6 py-4 text-center">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-deep">
          QuoteMax · Paid · Choose your time
        </span>
      </div>
    </main>
  )
}
