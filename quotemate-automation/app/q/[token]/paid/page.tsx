// Stripe success URL lands here. The webhook is what authoritatively marks
// the quote paid; this page confirms the job to the customer and offers the
// next actions. QuoteMax command-centre tokens (charcoal + the one yellow
// accent — the retired Maintain teal/Topo treatment was removed with the
// five-sections restructure).
//
// This page is ALSO the thank-you page of the pay-first $99 funnel (spec
// customer-quote-five-sections R8): quote → pay $99 → pick a time → land
// here, where the tradie's thank-you video (face-holder placeholder in v1)
// says we have received the request and will confirm the exact time.
//
// Plus the earlier Part B additions:
//   B1 — a "What's booked" confirmation card (always shown).
//   B2 — a "Download quote (PDF)" button whenever the quote is priced.
//   B3 — "Add to calendar" (.ics + Google) once a visit time is confirmed.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { BrandMark } from '@/app/_components/BrandMark'
import { humanizeJobType } from '@/lib/sms/followup-context'
import { buildGoogleCalendarUrl, resolveEventWindow } from '@/lib/quote/calendar'
import { paidPageTarget } from '@/lib/quote/booking'
import { tzForState } from '@/lib/quote/availability'
import { confirmPaidFromSession } from '@/lib/quote/paid-confirm'
import { INSPECTION_FEE_AUD } from '@/lib/quote/money'
import { loadTenantIdentity } from '@/lib/quote/tenant-identity'
import { MediaPlaceholder } from '@/app/q/_chrome/parts'
import { getStripe } from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// AM/PM window shows the half-day ("Fri 11 Jul (morning)"); a legacy exact
// time shows the time. Rendered in the tenant timezone the slots were
// generated in (tzForState) to match /q/[token]/book (spec B1).
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
      {/* Dark-on-yellow only — white on the accent is forbidden (~1.4:1). */}
      <div className="relative z-10 bg-accent px-6 py-4 text-center">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-deep">
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

  // Best-effort enrichment — a missing tenant/intake must never break the
  // page. loadTenantIdentity carries the mig-175 thank-you video column (v1
  // renders the face-holder placeholder regardless — no footage exists yet).
  const [tenant, { data: intake }] = await Promise.all([
    loadTenantIdentity(supabase, (quote.tenant_id as string | null) ?? null),
    quote.intake_id
      ? supabase
          .from('intakes')
          .select('job_type, address, suburb')
          .eq('id', quote.intake_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const tradieName = tenant?.business_name ?? null
  const tz = tzForState(tenant?.state ?? null)
  const jobType = (intake?.job_type as string | null) ?? null
  const suburb = (intake?.suburb as string | null) ?? null
  const address = (intake?.address as string | null) ?? null

  const scheduledAt = (quote.scheduled_at as string | null) ?? null
  const scheduledWindow = (quote.scheduled_window as string | null) ?? null

  // Webhook race guard: Stripe redirects here immediately after payment, but
  // paid_at is written by the async webhook. When we hold a session_id and
  // the row isn't paid yet, verify the Session with Stripe ourselves and run
  // the SAME claim+finalise the webhook uses (lib/quote/paid-confirm.ts —
  // idempotent, so whichever lands second is a no-op). Without this, a
  // customer landing before the webhook saw no confirmation and no way into
  // booking, and simply left.
  let paidAt = (quote.paid_at as string | null) ?? null
  let paidTier = (quote.paid_tier as string | null) ?? null
  if (!paidAt && sp.session_id) {
    // Extracted + unit-tested (lib/quote/paid-confirm.test.ts). Never throws;
    // Stripe unreachable → render from DB state, webhook stays authoritative.
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

  // Paid but date-less — the pay-first $99 inspection (spec five-sections
  // R7: pay → pick a time → back here), or a deposit off an old no-slot SMS
  // link → take the customer straight to the slot picker rather than parking
  // them here behind a passive link. Carry the tier so the picker charges/
  // labels the right product.
  if (paidPageTarget({ paid: !!paidAt, scheduledAt }) === 'book') {
    const tierParam = paidTier ?? sp.tier ?? null
    redirect(`/q/${token}/book${tierParam ? `?tier=${encodeURIComponent(tierParam)}` : ''}`)
  }

  const tierPaid = paidTier ?? sp.tier ?? null
  const isInspection = tierPaid === 'inspection' || !!quote.needs_inspection
  const isPriced = quote.needs_inspection === false
  const isBooked = !!(paidAt && scheduledAt)

  const jobLabel = humanizeJobType(jobType) ?? (isInspection ? 'Site inspection' : 'Your job')
  const who = tradieName ?? 'Your tradie'

  // Status line for the confirmation card. Paid-but-unscheduled never renders
  // here — it redirected to /book above.
  let statusLine: string
  if (isBooked) {
    statusLine = `Booked for ${formatScheduled(scheduledAt!, scheduledWindow, tz)}${
      tradieName ? ` with ${tradieName}` : ''
    }. ${who} will text you the day before.`
  } else if (isInspection) {
    statusLine = `Inspection booked — ${who} will contact you shortly to confirm a time.`
  } else {
    statusLine = `${who} will be in touch shortly to confirm a time.`
  }

  // What the customer actually PAID. An inspection payment is the flat $99 —
  // promoted roofing quotes carry the tier total in total_inc_gst, which is
  // NOT what was charged (surfaced by the five-sections live verification:
  // the card read "Paid $22,000.00" on a $99 site-visit payment).
  const amount = isInspection
    ? `$${INSPECTION_FEE_AUD.toFixed(2)}`
    : quote.total_inc_gst != null
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
        <span className="inline-flex items-center border border-accent/45 px-3 py-1 font-mono text-[0.7rem] font-bold uppercase tracking-[0.16em] text-accent">
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

        {/* R8 — the tradie's thank-you message (face-holder placeholder until
            QuoteMax films them; mig 175 thankyou_video_url stays unused in v1).
            Jon's copy: we have received your request and will be in touch to
            confirm the exact time of the inspection. */}
        <div className="mt-8 max-w-md">
          <MediaPlaceholder
            title={tradieName ?? 'Your tradie'}
            eyebrow="Video coming soon"
            caption="A thank-you message from your tradie"
          />
          <p className="mt-3 text-sm leading-relaxed text-text-sec">
            Thanks, we have received your request and we will be in touch to
            confirm the exact time of the {isInspection ? 'inspection' : 'visit'}.
          </p>
        </div>

        {/* B1 — confirmation card */}
        <div className="mt-8 border border-ink-line bg-ink-card p-5 sm:p-6">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
            What&apos;s booked
          </span>
          <div className="mt-3">
            {tradieName ? <Row label="Tradie" value={tradieName} /> : null}
            <Row label="Job" value={jobLabel} />
            {scheduledAt ? (
              <Row label="Visit" value={formatScheduled(scheduledAt, scheduledWindow, tz)} />
            ) : null}
            {suburb ? <Row label="Suburb" value={suburb} /> : null}
            <Row label="Quote ref" value={String(quote.id).slice(0, 8)} />
            {tierPaid ? <Row label="Tier paid" value={String(tierPaid).toUpperCase()} /> : null}
            {amount ? <Row label="Paid (inc GST)" value={amount} /> : null}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-7 flex flex-wrap gap-3">
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

        {scheduledAt ? null : isInspection ? (
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
