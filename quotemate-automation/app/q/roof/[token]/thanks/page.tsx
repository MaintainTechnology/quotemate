// Thank-you page for the roofing funnel.
//
// Spec: docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md
// (R1 route map, R4 contents, R6c amount paid). The roofing /book page used to
// be both calendar AND confirmation; the three-page split moves everything
// after the booking POST here:
//   /q/roof/[token]        the quote + $99 site-visit CTA
//   /q/roof/[token]/book   the calendar, nothing else
//   /q/roof/[token]/thanks THIS page — confirm what happened
//
// Paid-gated AND slot-gated (lib/quote/thanks.ts), and it keeps the same
// webhook-race guard the booking page carries: a customer who beats the async
// Stripe webhook must still land on a confirmation, not a redirect loop.

import { createClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { QuoteChrome } from '@/app/q/_chrome/QuoteChrome'
import { QuoteSheet, Letterhead, SheetSection, TrustVideo, AddToCalendar } from '@/app/q/_chrome/parts'
import { BookedSummary } from '@/app/q/_chrome/BookedSummary'
import { HouseShowcase } from '@/app/q/_chrome/HouseShowcase'
import { resolveShowcasePayload, SHOWCASE_MATERIAL_LABELS } from '@/lib/roofing/showcase'
import { signedShowcaseAssets } from '@/lib/roofing/showcase-assets'
import { tradeIcon } from '@/app/q/_chrome/icons'
import { loadTenantIdentity, contactDisplayName, trustVideoTrack } from '@/lib/quote/tenant-identity'
import { formatVisitSlot } from '@/lib/quote/trade-booking'
import { visitCalendarLinks } from '@/lib/quote/calendar-links'
import { thanksPageTarget, bookingRef } from '@/lib/quote/thanks'
import { resolvePaidAmount, formatPaidAmount } from '@/lib/quote/paid-amount'
import { tzForState } from '@/lib/quote/availability'
import { getStripe } from '@/lib/stripe/client'
import type { CSSProperties } from 'react'

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

export default async function RoofThanksPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: row } = await supabase
    .from('roofing_measurements')
    .select(
      'public_token, tenant_id, address, state, paid_at, paid_tier, paid_amount_cents, scheduled_at, scheduled_window, quote, model3d_status, model3d_glb_path',
    )
    .eq('public_token', token)
    .maybeSingle()
  if (!row) notFound()

  // Webhook-race guard: if the customer beat the Stripe webhook here, verify
  // the session and stamp paid_at ourselves (conditional claim, idempotent).
  let paidAt = (row.paid_at as string | null) ?? null
  let paidTier = (row.paid_tier as string | null) ?? null
  let paidAmountCents = (row.paid_amount_cents as number | null) ?? null
  if (!paidAt && sp.session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sp.session_id)
      if (session.payment_status === 'paid' && session.metadata?.roofing_token === token) {
        await supabase
          .from('roofing_measurements')
          .update({
            paid_at: new Date().toISOString(),
            paid_tier: 'inspection',
            paid_stripe_session_id: session.id,
            // mig 181 — same stamp the webhook writes, so whichever wins the
            // race records the real charge for this page.
            paid_amount_cents: session.amount_total ?? null,
          })
          .eq('public_token', token)
          .is('paid_at', null)
        paidAt = new Date().toISOString()
        paidTier = paidTier ?? 'inspection'
        paidAmountCents = paidAmountCents ?? session.amount_total ?? null
      }
    } catch {
      // Stripe unreachable — the webhook remains authoritative.
    }
  }

  const scheduledAt = (row.scheduled_at as string | null) ?? null
  const scheduledWindow = (row.scheduled_window as string | null) ?? null

  const target = thanksPageTarget({ paid: !!paidAt, scheduledAt })
  if (target === 'pay') redirect(`/r/roof/${token}/inspection`)
  if (target === 'book') redirect(`/q/roof/${token}/book`)

  const identity = await loadTenantIdentity(supabase, (row.tenant_id as string | null) ?? null)
  const tradieName = identity?.business_name ?? 'Your roofer'
  const tz = tzForState(identity?.state ?? (row.state as string | null) ?? null)
  // Video + the script it speaks, resolved together so the captions always
  // belong to the film that is actually playing.
  // The trade argument is required for the dashboard-generated clip to resolve
  // at all — see the note at app/q/roof/[token]/page.tsx.
  const thankyouVideo = trustVideoTrack(identity, 'thankyou', 'roofing')
  const placeLabel = [row.address, row.state].filter(Boolean).join(', ') || null

  // 3D showcase — resolved server-side (no HTTP round-trip on first paint).
  // The same resolver the public /api/q/roof/[token]/showcase route uses, so
  // the page and the API can never disagree about entitlement. Signing is
  // best-effort and read-only: it never generates, so opening this page cannot
  // cost anything.
  const showcase = resolveShowcasePayload(row)
  const showcaseAssets =
    showcase.status === 'ready'
      ? await signedShowcaseAssets({
          glbPath: showcase.glbPath,
          address: (row.address as string | null) ?? null,
        })
      : null
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

  // Never hardcode $99 — resolvePaidAmount prefers the recorded Stripe
  // amount_total (mig 181) and only falls back to the flat fee for legacy
  // rows stamped 'inspection' before the column existed.
  const paidLabel = formatPaidAmount(
    resolvePaidAmount({ paidAmountCents, paidTier, totalIncGst: null }),
  )

  return (
    <QuoteChrome trade={{ label: 'Roof', icon: tradeIcon('roof') }} sticky={null}>
      <QuoteSheet label={`Visit ${bookingRef(row.public_token as string)}`}>
        {identity?.business_name ? (
          <Letterhead
            name={identity.business_name}
            credential={placeLabel ? `Site visit · ${placeLabel}` : 'Site visit'}
            logoUrl={identity.logo_url}
            contactName={contactDisplayName(identity)}
            phone={(identity.owner_mobile ?? '').trim() || null}
            email={(identity.owner_email ?? '').trim() || null}
          />
        ) : null}

        {/* a. THE CONFIRMATION.
            This page used to open on a 9.5px "Thank you" eyebrow and put
            the one fact the customer came for — when is someone coming? —
            inside a paragraph, and again inside a table row. The customer
            has just paid; a confirmation should confirm.

            So: a tick, the plain-English outcome, then the date at hero
            scale. Nothing was removed — the same sentence still carries
            the follow-up promise, and every row of the booked table is
            still below. The eyebrow moves onto the block as a label.

            qm-stagger + --i: tick, then headline, then date, then the
            sentence, 60ms apart, so it resolves in reading order instead
            of landing as one slab. */}
        <SheetSection>
          <div
            className="qm-stagger"
            style={{ display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center', padding: '12px 0 4px' }}
          >
            <span
              aria-hidden="true"
              className="qm-tick-in"
              style={{
                '--i': 0,
                display: 'inline-grid',
                placeItems: 'center',
                width: 54,
                height: 54,
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--success-bright) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--success-bright) 42%, transparent)',
                color: 'var(--success-bright)',
                fontSize: 24,
                fontWeight: 800,
                lineHeight: 1,
              } as CSSProperties}
            >
              ✓
            </span>
            <h1
              style={{
                '--i': 1,
                margin: 0,
                fontFamily: 'var(--font-sans)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '-0.02em',
                fontSize: 'clamp(1.5rem, 4.4vw, 2rem)',
                lineHeight: 1.05,
                color: 'var(--text-pri)',
              } as CSSProperties}
            >
              Your site visit is booked
            </h1>
            <div
              style={{
                '--i': 2,
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                fontSize: 'clamp(1.05rem, 3vw, 1.5rem)',
                letterSpacing: '-0.01em',
                color: 'var(--text-pri)',
                fontVariantNumeric: 'tabular-nums',
              } as CSSProperties}
            >
              {slotLabel}
            </div>
            <p
              style={{
                '--i': 3,
                margin: 0,
                maxWidth: '52ch',
                fontSize: 14,
                lineHeight: 1.55,
                color: 'var(--text-sec)',
              } as CSSProperties}
            >
              {tradieName} will text you the day before to confirm the exact time.
            </p>
          </div>
        </SheetSection>

        {/* b + c. The tradie's message and the receipt sit SIDE BY SIDE from
            900px up (qm-thanks-split). Stacked, they made a ~1400px column
            on a laptop that was mostly one video and one table with a lot
            of paper either side. Phones keep the stack — the grid only
            splits at the same 900px breakpoint the scope rail uses. */}
        <SheetSection>
          <div className="qm-thanks-split" style={{ display: 'grid', gap: 22, alignItems: 'start' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>
                Thank you
              </div>
              <div className="qm-print-hide" style={{ marginTop: 12 }}>
                <TrustVideo
                  src={thankyouVideo.url}
                  script={thankyouVideo.script}
                  title={tradieName}
                  caption="A thank-you message from your tradie"
                />
              </div>
            </div>
            <div>
              <BookedSummary
                tradieName={identity?.business_name ?? null}
                jobLabel="Roof site visit"
                visitLabel={slotLabel}
                place={placeLabel}
                quoteRef={bookingRef(token)}
                paidLabel={paidLabel}
              />
            </div>
          </div>
        </SheetSection>

        {/* c2. Your house in 3D — the model reconstructed from the aerial
            survey, recolourable, with the two studio renders it was built
            from. Absent entirely when no model was generated for this
            property: an empty 3D section is worse than none. */}
        {showcaseAssets?.modelUrl ? (
          <SheetSection eyebrow="Your house in 3D" eyebrowAccent>
            <div style={{ marginTop: 14 }}>
              <HouseShowcase
                token={token}
                appUrl={(process.env.APP_URL ?? '').replace(/\/+$/, '')}
                modelUrl={showcaseAssets.modelUrl}
                images={showcaseAssets.images}
                materialImages={showcaseAssets.materialImages}
                material={showcase.material}
                materialLabels={SHOWCASE_MATERIAL_LABELS}
              />
            </div>
          </SheetSection>
        ) : null}

        {/* d. add to calendar — null only if scheduled_at is unparseable. */}
        {calLinks ? (
          <SheetSection>
            <div style={{ marginTop: 4 }}>
              <AddToCalendar
                google={calLinks.google}
                outlook={calLinks.outlook}
                outlookOffice={calLinks.outlookOffice}
                icsHref={`/q/roof/${token}/visit.ics`}
              />
            </div>
          </SheetSection>
        ) : null}

        {/* e. the quote PDF + back link. A roofing measurement only reaches a
            paid site visit from its own priced quote surface, so the PDF
            always has tiers to render. */}
        <SheetSection>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={`/api/q/roof/${token}/pdf`} className="qm-ghost" style={GHOST_LINK}>
              Download quote (PDF)
            </a>
            <a href={`/q/roof/${token}`} className="qm-ghost" style={GHOST_LINK}>
              ← Back to your quote
            </a>
          </div>
        </SheetSection>
      </QuoteSheet>
    </QuoteChrome>
  )
}
