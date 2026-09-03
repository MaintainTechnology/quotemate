// Thank-you page for the electrical / plumbing / solar funnel.
//
// Spec: docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md
// (R1 route map, R4 contents). The three-page split gives each page one job:
//   /q/[token]        the quote + pay CTA
//   /q/[token]/book   the calendar, nothing else
//   /q/[token]/thanks THIS page — confirm what happened
//
// Paid-gated AND slot-gated (lib/quote/thanks.ts): a half-state — "what's
// booked" with nothing booked, or a thank-you for money not taken — is worse
// than a redirect, so an unpaid visitor goes to the pay short-link and a paid
// visitor without a slot goes to /book.
//
// The Stripe webhook-race guard is carried over verbatim from /q/[token]/paid:
// a customer who beats the async webhook here must still see a confirmation.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { BrandMark } from '@/app/_components/BrandMark'
import { humanizeJobType } from '@/lib/sms/followup-context'
import { buildGoogleCalendarUrl, resolveEventWindow } from '@/lib/quote/calendar'
import { buildCalendarLinks } from '@/lib/quote/calendar-links'
import { resolveNextTier } from '@/lib/quote/booking'
import { thanksPageTarget, bookingRef } from '@/lib/quote/thanks'
import { resolvePaidAmount, formatPaidAmount } from '@/lib/quote/paid-amount'
import { tzForState } from '@/lib/quote/availability'
import { confirmPaidFromSession } from '@/lib/quote/paid-confirm'
import { loadTenantIdentity, trustVideoTrack } from '@/lib/quote/tenant-identity'
import { TrustVideo, AddToCalendar } from '@/app/q/_chrome/parts'
import { BookedSummary } from '@/app/q/_chrome/BookedSummary'
import { getStripe } from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// AM/PM window shows the half-day ("Fri 11 Jul (morning)"); a legacy exact
// time shows the time. Rendered in the TENANT timezone the slots were
// generated in (tzForState) — a WA slot formatted on a Sydney server shows
// the wrong day.
function formatScheduled(iso: string, window?: string | null, tz = 'Australia/Sydney'): string {
  try {
    const dayLabel = new Date(iso).toLocaleString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tz,
    })
    if (window === 'am' || window === 'pm') {
      return `${dayLabel} (${window === 'am' ? 'morning' : 'afternoon'})`
    }
    const time = new Date(iso).toLocaleString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
    return `${dayLabel}, ${time}`
  } catch {
    return iso
  }
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
      <div className="relative z-10 mx-auto max-w-2xl px-5 py-9 sm:px-6 sm:py-12">{children}</div>
      {/* Dark-on-yellow only — white on the accent is forbidden (~1.4:1). */}
      <div className="relative z-10 bg-accent px-6 py-4 text-center">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-deep">
          QuoteMax · Paid · Confirmed
        </span>
      </div>
    </main>
  )
}

export default async function ThanksPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string; session_id?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, paid_at, paid_tier, paid_amount_cents, selected_tier, total_inc_gst, scheduled_at, scheduled_window, needs_inspection, intake_id, tenant_id, share_token, quote_kind',
    )
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) notFound()

  const scheduledAt = (quote.scheduled_at as string | null) ?? null
  const scheduledWindow = (quote.scheduled_window as string | null) ?? null

  // Webhook race guard (same call as /q/[token]/paid): Stripe redirects the
  // customer here immediately, but paid_at is written by the async webhook.
  // Holding a session_id, verify the Session and run the SAME claim+finalise —
  // idempotent, so whichever lands second is a no-op. Never throws; Stripe
  // unreachable → render from DB state, webhook stays authoritative.
  let paidAt = (quote.paid_at as string | null) ?? null
  let paidTier = (quote.paid_tier as string | null) ?? null
  if (!paidAt && sp.session_id) {
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
          quote_kind: (quote.quote_kind as string | null) ?? null,
        },
        sessionId: sp.session_id,
      },
    )
    if (guard.paid) {
      paidAt = new Date().toISOString()
      paidTier = paidTier ?? guard.tier
    }
  }

  const quoteKind = (quote.quote_kind as string | null) ?? null
  // A 'final'/'balance' child never has a slot, so the confirmed-booking
  // surface below can't render for one and the 'book' branch would send it to
  // a calendar for a visit that already happened. Its quote page owns the
  // "Deposit received" / "Paid in full" state instead (spec R11).
  if (quoteKind === 'final' || quoteKind === 'balance') redirect(`/q/${token}`)

  const target = thanksPageTarget({ paid: !!paidAt, scheduledAt, quoteKind })
  if (target === 'pay') {
    const tier = resolveNextTier(sp.tier ?? null, quote.selected_tier as string | null)
    redirect(`/r/${token}/${tier}`)
  }
  if (target === 'book') redirect(`/q/${token}/book`)

  // Best-effort enrichment — a missing tenant/intake must never break the
  // confirmation. Loaded AFTER the gate so the redirect paths cost one query.
  const [tenant, { data: intake }] = await Promise.all([
    loadTenantIdentity(supabase, (quote.tenant_id as string | null) ?? null),
    quote.intake_id
      ? supabase
          .from('intakes')
          // `trade` is here for the trust video: the dashboard stores a
          // generated clip per trade, so resolving one needs the trade slug.
          .select('job_type, address, suburb, trade')
          .eq('id', quote.intake_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const tradieName = tenant?.business_name ?? null
  // Video + the script it speaks, resolved together so the captions always
  // belong to the film that is actually playing. The trade argument is required
  // for the dashboard-generated clip to resolve at all — see the note at
  // app/q/roof/[token]/page.tsx. Legacy intakes with no trade column fall back
  // to 'electrical', matching /q/[token] and the estimator.
  const thankyouVideo = trustVideoTrack(
    tenant,
    'thankyou',
    ((intake as { trade?: string | null } | null)?.trade ?? 'electrical'),
  )
  const who = tradieName ?? 'Your tradie'
  const tz = tzForState(tenant?.state ?? null)
  const jobType = (intake?.job_type as string | null) ?? null
  const suburb = (intake?.suburb as string | null) ?? null
  const address = (intake?.address as string | null) ?? null

  const tierPaid = paidTier ?? sp.tier ?? null
  const isInspection = tierPaid === 'inspection' || !!quote.needs_inspection
  const isPriced = quote.needs_inspection === false
  // Since spec elec-plumb-site-visit-first (2026-08-06) a NORMALLY-PRICED
  // electrical/plumbing quote also pays the $99 'inspection' tier, so
  // `isInspection` no longer implies "this job could not be priced". Calling
  // that booking a "site inspection" misdescribes it — it is a site visit that
  // confirms a price the customer has already seen. Genuinely inspection-routed
  // rows (needs_inspection true ⇒ isPriced false) keep the old wording.
  const visitNoun = isPriced ? 'Site visit' : 'Site inspection'
  const jobLabel = humanizeJobType(jobType) ?? (isInspection && !isPriced ? 'Site inspection' : 'Your job')
  // scheduledAt is non-null here — thanksPageTarget only returns 'render' with
  // both a payment and a slot.
  const visitLabel = formatScheduled(scheduledAt!, scheduledWindow, tz)

  // Never hardcode a dollar figure: an inspection payment is not the tier
  // total, and a deposit is not the quote total. resolvePaidAmount prefers the
  // Stripe amount_total recorded on the row and returns null rather than guess.
  const paidLabel = formatPaidAmount(
    resolvePaidAmount({
      paidAmountCents: quote.paid_amount_cents as number | null,
      paidTier: tierPaid,
      totalIncGst: quote.total_inc_gst as number | null,
    }),
  )

  // One event, two builders: buildGoogleCalendarUrl carries the quote-derived
  // deterministic UID the .ics route uses, buildCalendarLinks supplies the two
  // Outlook deep-links AddToCalendar renders as secondary options.
  const { start, end } = resolveEventWindow(scheduledAt!, scheduledWindow)
  const summary = `${isInspection ? visitNoun : jobLabel} — ${tradieName ?? 'QuoteMax'}`
  const appUrl = process.env.APP_URL?.replace(/\/$/, '') ?? null
  const link = appUrl ? `${appUrl}/q/${quote.share_token}` : null
  const description = [
    isInspection
      ? `${visitNoun}${tradieName ? ` with ${tradieName}` : ''}.`
      : `Your ${jobLabel} visit${tradieName ? ` with ${tradieName}` : ''}.`,
    link ? `Quote: ${link}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  const location = address ?? suburb ?? null
  const googleUrl = buildGoogleCalendarUrl({
    quoteId: quote.id as string,
    start,
    end,
    summary,
    description,
    location,
  })
  const webLinks = buildCalendarLinks({
    title: summary,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    details: description,
    location: location ?? undefined,
    timeZone: tz,
  })

  return (
    <Shell token={token}>
      <section className="motion-safe:animate-[fade-in_240ms_ease-out_both]">
        <span className="inline-flex items-center border border-accent/45 px-3 py-1 font-mono text-[0.7rem] font-bold uppercase tracking-[0.16em] text-accent">
          Booked · Confirmed
        </span>
        <h1 className="mt-6 text-[clamp(1.9rem,5vw,3.25rem)] font-extrabold uppercase leading-[1.03] tracking-[-0.03em]">
          You&apos;re <span className="text-accent">locked in</span>.
        </h1>

        {/* a. the tradie's own thank-you film, else the QuoteMax default. */}
        <div className="mt-8 max-w-md">
          <TrustVideo
            src={thankyouVideo.url}
            script={thankyouVideo.script}
            title={tradieName ?? 'Your tradie'}
            caption="A thank-you message from your tradie"
          />
        </div>

        {/* b. next steps */}
        <p className="mt-6 max-w-[60ch] text-base leading-relaxed text-text-sec">
          Thanks — your booking is locked in for{' '}
          <strong className="font-semibold text-text-pri">{visitLabel}</strong>. {who} will text you
          the day before to confirm the exact time.
        </p>

        {/* c. what's booked */}
        <div className="mt-8">
          <BookedSummary
            tradieName={tradieName}
            jobLabel={jobLabel}
            visitLabel={visitLabel}
            place={address ?? suburb}
            quoteRef={bookingRef(token)}
            paidLabel={paidLabel}
          />
        </div>

        {/* d. add to calendar */}
        <div className="mt-8">
          <AddToCalendar
            google={googleUrl}
            outlook={webLinks.outlook}
            outlookOffice={webLinks.outlookOffice}
            icsHref={`/api/q/${token}/ics`}
          />
        </div>

        {/* e. the PDF exists only for a priced quote — an inspection deposit
            has no tiers to render. */}
        {isPriced ? (
          <div className="mt-8">
            <a
              href={`/api/q/${token}/pdf`}
              className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
            >
              Download quote (PDF)
            </a>
          </div>
        ) : null}

        <p className="mt-8 text-sm leading-relaxed text-text-sec">
          Keep the SMS for your records. Your receipt will be emailed to you by Stripe shortly.
        </p>
      </section>
    </Shell>
  )
}
