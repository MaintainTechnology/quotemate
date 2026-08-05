// Painting visit BOOKING page — step 2 of 3.
//
//   /q/paint/<token>  ->  Stripe  ->  /q/paint/<token>/book  ->  /q/paint/<token>/thanks
//
// This page does exactly one thing: let the customer pick a date and then a
// time. No thank-you video, no booked confirmation, no add-to-calendar links —
// those live on /thanks, which the booking POST redirects to (spec
// 2026-07-22-booking-three-page-split R3). Mirrors /q/roof/[token]/book.
//
// Gated twice: an unpaid visitor is sent to pay first, and an already-booked
// visitor is sent to /thanks.
//
// Painting now pays exactly what roofing pays (spec painting-site-visit-first
// R3): the flat $99 refundable site visit, minted at
// /r/paint/<token>/inspection — an unpaid visitor is sent there regardless of
// any legacy ?tier= param (tier deposits are retired). That mint's
// success_url lands here with a session_id, same as roofing's.
//
// Next 16: params AND searchParams are Promises (await them).

import type { CSSProperties } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { QuoteChrome } from '@/app/q/_chrome/QuoteChrome'
import { QuoteSheet, Letterhead, SheetSection } from '@/app/q/_chrome/parts'
import { tradeIcon } from '@/app/q/_chrome/icons'
import { loadTenantIdentity, contactDisplayName } from '@/lib/quote/tenant-identity'
import { loadTenantBookingOptions } from '@/lib/quote/trade-booking'
import { bookingRef } from '@/lib/quote/thanks'
import {
  PAINT_INSPECTION_TIER,
  paintPayRedirectTier,
  VALID_PAINT_TIERS,
} from '@/lib/painting/pay-redirect'
import { tzForState } from '@/lib/quote/availability'
import { getStripe } from '@/lib/stripe/client'
import { BookingCalendar, type CalendarDay } from '@/app/q/_chrome/BookingCalendar'
import { toCalendarDays } from '@/app/q/_chrome/calendar-days'

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

/** Short timezone note ("AEST") so the customer knows whose clock the times are
 *  on — they are generated in the TENANT's zone, not the visitor's. */
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

export default async function PaintBookingPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string; session_id?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: row } = await supabase
    .from('painting_measurements')
    .select('public_token, tenant_id, address, state, paid_at, scheduled_at')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) notFound()

  // Webhook-race guard. Painting's Stripe success_url returns to the QUOTE page
  // (lib/stripe/painting-checkout.ts), so this page is normally reached by a
  // link on an already-paid row — but the Session metadata carries
  // painting_token, which ties a session_id to THIS row, so the guard is safe to
  // run when one is present. Conditional claim (.is('paid_at', null)) keeps it
  // idempotent against the webhook.
  let paidAt = (row.paid_at as string | null) ?? null
  if (!paidAt && sp.session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sp.session_id)
      if (session.payment_status === 'paid' && session.metadata?.painting_token === token) {
        const tier = session.metadata?.tier ?? null
        await supabase
          .from('painting_measurements')
          .update({
            paid_at: new Date().toISOString(),
            // Tier off the Session, validated — never hardcoded. 'inspection'
            // is the $99 site visit (the same value the webhook records).
            paid_tier:
              tier && (VALID_PAINT_TIERS.has(tier) || tier === PAINT_INSPECTION_TIER)
                ? tier
                : null,
            paid_stripe_session_id: session.id,
            // mig 181 — same stamp the webhook writes, so whichever wins the
            // race records the real charge for the thank-you page.
            paid_amount_cents: session.amount_total ?? null,
          })
          .eq('public_token', token)
          .is('paid_at', null)
        paidAt = new Date().toISOString()
      }
    } catch {
      // Stripe unreachable — the webhook remains authoritative.
    }
  }

  // Not paid → send them to pay first (this page is the post-payment surface).
  // Always the flat $99 site visit — painting's only customer payment; the
  // legacy ?tier= param no longer affects payment routing (pure, unit-tested).
  // A held row bounces off the mint's release gate back to the quote page.
  if (!paidAt) {
    redirect(`/r/paint/${token}/${paintPayRedirectTier()}`)
  }

  const scheduledAt = (row.scheduled_at as string | null) ?? null
  // Already booked → the thank-you page owns the confirmation. This page's
  // only job is picking a time.
  if (scheduledAt) redirect(`/q/paint/${token}/thanks`)

  const identity = await loadTenantIdentity(supabase, (row.tenant_id as string | null) ?? null)
  const tz = tzForState(identity?.state ?? (row.state as string | null) ?? null)
  const placeLabel = [row.address, row.state].filter(Boolean).join(', ') || null

  let calDays: CalendarDay[] = []
  if (row.tenant_id) {
    const options = await loadTenantBookingOptions(supabase, {
      tenantId: row.tenant_id as string,
      table: 'painting_measurements',
    })
    calDays = toCalendarDays(options, tz)
  }

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

        {/* The ONLY job of this page: pick a date, then a time. The thank-you
            video, the booked confirmation and the add-to-calendar links live
            on /q/paint/<token>/thanks, which the booking POST redirects to. */}
        <SheetSection eyebrow="Book your visit" eyebrowAccent>
          <p style={{ margin: '14px 0 0', maxWidth: 560, fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
            Payment received. Choose a date, then a time that suits — your visit
            is locked in as soon as you confirm.
          </p>
          <div style={{ marginTop: 14 }}>
            <BookingCalendar
              days={calDays}
              endpoint={`/api/q/book/paint/${token}`}
              tzLabel={shortTzLabel(tz)}
              labels={{ idle: 'Book this time →', submitting: 'Booking…', done: 'Booked ✓' }}
            />
          </div>
        </SheetSection>

        {/* Back to the quote */}
        <SheetSection>
          <a href={`/q/paint/${token}`} className="qm-ghost" style={GHOST_LINK}>
            ← Back to your quote
          </a>
        </SheetSection>
      </QuoteSheet>
    </QuoteChrome>
  )
}
