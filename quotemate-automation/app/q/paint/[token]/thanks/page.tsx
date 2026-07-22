// Thank-you page for the residential painting funnel.
//
// Spec: docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md
// (R1 route map, R4 contents, R6c amount paid). Mirrors /q/roof/[token]/thanks;
// the three-page split gives each page one job:
//   /q/paint/[token]        the quote + per-tier deposit CTAs
//   /q/paint/[token]/book   the calendar, nothing else
//   /q/paint/[token]/thanks THIS page — confirm what happened
//
// Paid-gated AND slot-gated (lib/quote/thanks.ts), and it keeps the same
// webhook-race guard the booking page carries: a customer who beats the async
// Stripe webhook must still land on a confirmation, not a redirect loop.
//
// Painting differs from roofing in what "pay" means: roofing charges a flat $99
// site visit, painting charges a per-tier DEPOSIT, so the pay short-link needs
// a tier (/r/paint/<token>/<tier>) and the amount shown comes from the recorded
// Stripe charge, never a constant.
//
// Next 16: params AND searchParams are Promises (await them).

import type { CSSProperties } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { QuoteChrome } from '@/app/q/_chrome/QuoteChrome'
import { QuoteSheet, Letterhead, SheetSection, TrustVideo, AddToCalendar } from '@/app/q/_chrome/parts'
import { BookedSummary } from '@/app/q/_chrome/BookedSummary'
import { tradeIcon } from '@/app/q/_chrome/icons'
import { loadTenantIdentity, contactDisplayName, trustVideoTrack } from '@/lib/quote/tenant-identity'
import { formatVisitSlot } from '@/lib/quote/trade-booking'
import { visitCalendarLinks } from '@/lib/quote/calendar-links'
import { thanksPageTarget, bookingRef } from '@/lib/quote/thanks'
import { resolvePaidAmount, formatPaidAmount } from '@/lib/quote/paid-amount'
import { VALID_PAINT_TIERS } from '@/lib/painting/pay-redirect'
import { tzForState } from '@/lib/quote/availability'
import { getStripe } from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Secondary "ghost" nav link — recedes behind the yellow primary CTA.
const GHOST_LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid var(--ink-line)',
  background: 'transparent',
  color: 'var(--text-sec)',
  padding: '11px 16px',
  borderRadius: 'var(--qm-r-ctl)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  textDecoration: 'none',
}

/** Which tier the pay short-link charges when a visitor lands here unpaid.
 *  There is no flat fee to fall back on, and paid_tier is null by definition
 *  while unpaid — so honour an explicit ?tier= the short-link accepts, else the
 *  Better baseline the quote page features (app/q/paint/[token]/page.tsx). */
function payTier(requested: string | null | undefined): string {
  return requested && VALID_PAINT_TIERS.has(requested) ? requested : 'better'
}

export default async function PaintThanksPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string; session_id?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: row } = await supabase
    .from('painting_measurements')
    .select(
      'public_token, tenant_id, address, state, routing, paid_at, paid_tier, paid_amount_cents, scheduled_at, scheduled_window',
    )
    .eq('public_token', token)
    .maybeSingle()
  if (!row) notFound()

  // Webhook-race guard. Painting's Stripe success_url returns to the QUOTE page
  // (lib/stripe/painting-checkout.ts), so this page is normally reached after
  // the booking POST on an already-paid row — but the Session metadata carries
  // painting_token, which ties a session_id to THIS row, so the guard is safe to
  // run when one is present. Conditional claim (.is('paid_at', null)) keeps it
  // idempotent against the webhook.
  let paidAt = (row.paid_at as string | null) ?? null
  let paidTier = (row.paid_tier as string | null) ?? null
  let paidAmountCents = (row.paid_amount_cents as number | null) ?? null
  if (!paidAt && sp.session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sp.session_id)
      if (session.payment_status === 'paid' && session.metadata?.painting_token === token) {
        const tier = session.metadata?.tier ?? null
        // Deposit tier off the Session, validated — never a hardcoded tier.
        const claimedTier = tier && VALID_PAINT_TIERS.has(tier) ? tier : null
        await supabase
          .from('painting_measurements')
          .update({
            paid_at: new Date().toISOString(),
            paid_tier: claimedTier,
            paid_stripe_session_id: session.id,
            // mig 181 — same stamp the webhook writes, so whichever wins the
            // race records the real charge for this page.
            paid_amount_cents: session.amount_total ?? null,
          })
          .eq('public_token', token)
          .is('paid_at', null)
        paidAt = new Date().toISOString()
        paidTier = paidTier ?? claimedTier
        paidAmountCents = paidAmountCents ?? session.amount_total ?? null
      }
    } catch {
      // Stripe unreachable — the webhook remains authoritative.
    }
  }

  const scheduledAt = (row.scheduled_at as string | null) ?? null
  const scheduledWindow = (row.scheduled_window as string | null) ?? null

  const target = thanksPageTarget({ paid: !!paidAt, scheduledAt })
  if (target === 'pay') redirect(`/r/paint/${token}/${payTier(sp.tier)}`)
  if (target === 'book') redirect(`/q/paint/${token}/book`)

  const identity = await loadTenantIdentity(supabase, (row.tenant_id as string | null) ?? null)
  const tradieName = identity?.business_name ?? 'Your painter'
  const tz = tzForState(identity?.state ?? (row.state as string | null) ?? null)
  // Video + the script it speaks, resolved together so the captions always
  // belong to the film that is actually playing.
  const thankyouVideo = trustVideoTrack(identity, 'thankyou')
  const placeLabel = [row.address, row.state].filter(Boolean).join(', ') || null
  // scheduledAt is non-null here — thanksPageTarget only returns 'render' with
  // both a payment and a slot.
  const slotLabel = formatVisitSlot(scheduledAt!, scheduledWindow, tz)
  const calLinks = visitCalendarLinks({
    scheduledAt: scheduledAt!,
    scheduledWindow,
    tradieName,
    slotLabel,
    // Raw address already ends with the state, so prefer it over placeLabel
    // (which re-appends state and can double it).
    location: (row.address as string | null)?.trim() || placeLabel,
    timeZone: tz,
  })

  // Never hardcode a dollar figure — the painting deposit is a percentage of a
  // tier price, so it is knowable ONLY from the recorded Stripe amount (mig
  // 181). There is no total on painting_measurements to fall back to, and the
  // tier price is NOT what was charged, so totalIncGst stays null: the row is
  // omitted rather than showing the wrong money.
  const paidLabel = formatPaidAmount(
    resolvePaidAmount({ paidAmountCents, paidTier, totalIncGst: null }),
  )

  return (
    <QuoteChrome trade={{ label: 'Paint', icon: tradeIcon('paint') }} sticky={null}>
      <QuoteSheet label={`Visit ${bookingRef(row.public_token as string)}`}>
        {identity?.business_name ? (
          <Letterhead
            name={identity.business_name}
            credential={placeLabel ? `Visit · ${placeLabel}` : 'Visit'}
            logoUrl={identity.logo_url}
            contactName={contactDisplayName(identity)}
            phone={(identity.owner_mobile ?? '').trim() || null}
            email={(identity.owner_email ?? '').trim() || null}
          />
        ) : null}

        {/* a. thank-you video — enlarged + centred (hero of this page). */}
        <SheetSection eyebrow="Thank you" eyebrowAccent>
          <div style={{ marginTop: 14, display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center' }}>
            <div className="qm-print-hide" style={{ width: '100%', maxWidth: 720 }}>
              <TrustVideo
                src={thankyouVideo.url}
                script={thankyouVideo.script}
                title={tradieName}
                caption="A thank-you message from your tradie"
              />
            </div>
            {/* b. next steps */}
            <p style={{ margin: 0, maxWidth: 560, fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              Thanks — your visit is locked in for{' '}
              <strong style={{ color: 'var(--text-pri)' }}>{slotLabel}</strong>. {tradieName} will
              text you the day before to confirm the exact time.
            </p>
          </div>
        </SheetSection>

        {/* c. what's booked */}
        <SheetSection>
          <div style={{ marginTop: 4 }}>
            <BookedSummary
              tradieName={identity?.business_name ?? null}
              jobLabel="Painting visit"
              visitLabel={slotLabel}
              place={placeLabel}
              quoteRef={bookingRef(token)}
              paidLabel={paidLabel}
            />
          </div>
        </SheetSection>

        {/* d. add to calendar — null only if scheduled_at is unparseable. */}
        {calLinks ? (
          <SheetSection>
            <div style={{ marginTop: 4 }}>
              <AddToCalendar
                google={calLinks.google}
                outlook={calLinks.outlook}
                outlookOffice={calLinks.outlookOffice}
                icsHref={`/q/paint/${token}/visit.ics`}
              />
            </div>
          </SheetSection>
        ) : null}

        {/* e. the quote PDF + back link. /api/q/paint/<token>/pdf 404s an
            inspection-routed job (no committable price belongs in a
            final-looking document), so the link is gated the same way. */}
        <SheetSection>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {row.routing !== 'inspection_required' ? (
              <a href={`/api/q/paint/${token}/pdf`} className="qm-ghost" style={GHOST_LINK}>
                Download quote (PDF)
              </a>
            ) : null}
            <a href={`/q/paint/${token}`} className="qm-ghost" style={GHOST_LINK}>
              ← Back to your quote
            </a>
          </div>
        </SheetSection>
      </QuoteSheet>
    </QuoteChrome>
  )
}
