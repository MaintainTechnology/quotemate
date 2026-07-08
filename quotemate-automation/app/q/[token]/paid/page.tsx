// Stripe success URL lands here. The webhook is what authoritatively marks
// the quote paid; this page confirms the job to the customer and offers the
// next actions. Maintain Technology design system (matches /q/[token]/book).
//
// Three additions over the old thank-you stub (spec 2026-07-05 Part B):
//   B1 — a "What's booked" confirmation card (always shown).
//   B2 — a "Download quote (PDF)" button whenever the quote is priced
//        (needs_inspection === false). Inspection deposits have no priced
//        PDF, so the button is simply omitted for them.
//   B3 — "Add to calendar" (.ics + Google) shown only once a visit time is
//        confirmed (scheduled_at set). Inspection deposits are date-less at
//        this point, so they show a "we'll send an invite" note instead.

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { BrandMark } from '@/app/_components/BrandMark'
import { humanizeJobType } from '@/lib/sms/followup-context'
import { buildGoogleCalendarUrl, resolveEventWindow } from '@/lib/quote/calendar'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// AM/PM window shows the half-day ("Fri 11 Jul (morning)"); a legacy exact
// time shows the time. Australia/Sydney to match /q/[token]/book (spec B1).
function formatScheduled(iso: string, window?: string | null): string {
  try {
    const dayLabel = new Date(iso).toLocaleString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Australia/Sydney',
    })
    if (window === 'am' || window === 'pm') {
      return `${dayLabel} (${window === 'am' ? 'morning' : 'afternoon'})`
    }
    const time = new Date(iso).toLocaleString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Australia/Sydney',
    })
    return `${dayLabel}, ${time}`
  } catch {
    return iso
  }
}

function Topo() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {[0, 70, 140, 210, 280, 350, 420].map((dy) => (
        <path
          key={dy}
          d={`M0,${760 - dy} Q240,${600 - dy} 480,${690 - dy} T960,${640 - dy} T1440,${
            700 - dy
          } T1920,${610 - dy}`}
          stroke="var(--color-teal-glow, #14B8A6)"
          strokeWidth="1"
          fill="none"
        />
      ))}
    </svg>
  )
}

function Shell({ token, children }: { token: string; children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <Topo />
      <header className="relative z-10 border-b border-ink-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10" />
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
      <div className="relative z-10 bg-accent px-6 py-4 text-center">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-white">
          QuoteMax · Paid · Confirmed
        </span>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-line py-3 last:border-b-0">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
        {label}
      </span>
      <span className="text-right text-sm font-semibold text-text-pri">{value}</span>
    </div>
  )
}

export default async function PaidPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string; session_id?: string; already?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, paid_at, paid_tier, total_inc_gst, scheduled_at, scheduled_window, needs_inspection, intake_id, tenant_id, share_token',
    )
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) {
    return (
      <Shell token={token}>
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
      </Shell>
    )
  }

  // Best-effort enrichment — a missing tenant/intake must never break the page.
  const [{ data: tenant }, { data: intake }] = await Promise.all([
    quote.tenant_id
      ? supabase.from('tenants').select('business_name').eq('id', quote.tenant_id).maybeSingle()
      : Promise.resolve({ data: null }),
    quote.intake_id
      ? supabase
          .from('intakes')
          .select('job_type, address, suburb')
          .eq('id', quote.intake_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const tradieName = (tenant?.business_name as string | null) ?? null
  const jobType = (intake?.job_type as string | null) ?? null
  const suburb = (intake?.suburb as string | null) ?? null
  const address = (intake?.address as string | null) ?? null

  const scheduledAt = (quote.scheduled_at as string | null) ?? null
  const scheduledWindow = (quote.scheduled_window as string | null) ?? null
  const tierPaid = ((quote.paid_tier as string | null) ?? sp.tier ?? null)
  const isInspection = tierPaid === 'inspection' || !!quote.needs_inspection
  const isPriced = quote.needs_inspection === false
  const isBooked = !!(quote.paid_at && scheduledAt)
  // Any paid-but-unscheduled quote — INCLUDING a $99 inspection deposit — can
  // pick a time here (the whole point of the deposit is to book the visit).
  // The /book page handles the "no slots published" case gracefully, so we
  // don't need to load slots on this page to decide whether to show the CTA.
  const showBookCta = !!quote.paid_at && !scheduledAt

  const jobLabel = humanizeJobType(jobType) ?? (isInspection ? 'Site inspection' : 'Your job')
  const who = tradieName ?? 'Your tradie'

  // Status line for the confirmation card.
  let statusLine: string
  if (isBooked) {
    statusLine = `Booked for ${formatScheduled(scheduledAt!, scheduledWindow)}${
      tradieName ? ` with ${tradieName}` : ''
    }. ${who} will text you the day before.`
  } else if (showBookCta) {
    statusLine = isInspection
      ? 'Deposit received. Pick your inspection time below.'
      : 'Pick a time below to lock in your visit.'
  } else if (isInspection) {
    statusLine = `Inspection booked — ${who} will contact you shortly to confirm a time.`
  } else {
    statusLine = `${who} will be in touch shortly to confirm a time.`
  }

  const amount =
    quote.total_inc_gst != null
      ? `$${Number(quote.total_inc_gst).toLocaleString('en-AU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null

  // B3 — one-click Google Calendar link, computed server-side from the same
  // fields as the .ics route so both agree.
  let googleCalUrl: string | null = null
  if (scheduledAt) {
    const { start, end } = resolveEventWindow(scheduledAt, scheduledWindow)
    const summary = isInspection ? `Inspection — ${tradieName ?? 'QuoteMax'}` : `${jobLabel} — ${tradieName ?? 'QuoteMax'}`
    const appUrl = process.env.APP_URL?.replace(/\/$/, '') ?? null
    const link = appUrl ? `${appUrl}/q/${quote.share_token}` : null
    const description = [
      isInspection
        ? `Site inspection${tradieName ? ` with ${tradieName}` : ''}.`
        : `Your ${jobLabel} visit${tradieName ? ` with ${tradieName}` : ''}.`,
      link ? `Quote: ${link}` : null,
    ]
      .filter(Boolean)
      .join(' ')
    googleCalUrl = buildGoogleCalendarUrl({
      quoteId: quote.id as string,
      start,
      end,
      summary,
      description,
      location: address ?? suburb ?? null,
    })
  }

  return (
    <Shell token={token}>
      <section className="motion-safe:animate-[fade-in_240ms_ease-out_both]">
        <span className="inline-flex items-center bg-teal-glow/15 px-3 py-1 font-mono text-[0.7rem] font-bold uppercase tracking-[0.16em] text-teal-glow">
          {isBooked ? 'Booked · Confirmed' : 'Payment received'}
        </span>
        <h1 className="mt-6 text-[clamp(1.9rem,5vw,3.25rem)] font-extrabold uppercase leading-[1.03] tracking-[-0.03em]">
          {isBooked ? (
            <>
              You&apos;re <span className="text-accent">locked in</span>.
            </>
          ) : (
            <>
              Deposit <span className="text-accent">received</span>.
            </>
          )}
        </h1>
        <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-text-sec">{statusLine}</p>

        {/* B1 — confirmation card */}
        <div className="mt-8 border border-ink-line bg-ink-card p-5 sm:p-6">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
            What&apos;s booked
          </span>
          <div className="mt-3">
            {tradieName ? <Row label="Tradie" value={tradieName} /> : null}
            <Row label="Job" value={jobLabel} />
            {suburb ? <Row label="Suburb" value={suburb} /> : null}
            <Row label="Quote ref" value={String(quote.id).slice(0, 8)} />
            {tierPaid ? <Row label="Tier paid" value={String(tierPaid).toUpperCase()} /> : null}
            {amount ? <Row label="Paid (inc GST)" value={amount} /> : null}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-7 flex flex-wrap gap-3">
          {showBookCta ? (
            <a
              href={`/q/${token}/book`}
              className="inline-flex items-center gap-2 bg-accent px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press"
            >
              Pick a time →
            </a>
          ) : null}

          {/* B2 — priced quotes have a downloadable PDF; inspection deposits don't. */}
          {isPriced ? (
            <a
              href={`/api/q/${token}/pdf`}
              className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
            >
              Download quote (PDF)
            </a>
          ) : null}

          {/* B3 — add-to-calendar, only once a time is confirmed. */}
          {scheduledAt ? (
            <>
              <a
                href={`/api/q/${token}/ics`}
                className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
              >
                Add to calendar (.ics)
              </a>
              {googleCalUrl ? (
                <a
                  href={googleCalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
                >
                  Add to Google Calendar ↗
                </a>
              ) : null}
            </>
          ) : null}
        </div>

        {scheduledAt || showBookCta ? null : isInspection ? (
          <p className="mt-6 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
            We&apos;ll send a calendar invite once your time is confirmed.
          </p>
        ) : null}

        <p className="mt-8 text-sm leading-relaxed text-text-sec">
          Keep the SMS for your records. Your receipt will be emailed to you by Stripe shortly.
        </p>
      </section>
    </Shell>
  )
}
