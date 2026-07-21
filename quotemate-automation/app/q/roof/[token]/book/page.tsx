// Roofing site-visit BOOKING page — step 2 of 3.
//
//   /q/roof/<token>  ->  Stripe  ->  /q/roof/<token>/book  ->  /q/roof/<token>/thanks
//
// This page does exactly one thing: let the customer pick a date and then a
// time. It used to also host the thank-you video, the booked confirmation and
// the add-to-calendar links; those moved to /thanks on 2026-07-22 so each page
// has a single job (spec 2026-07-22-booking-three-page-split R3).
//
// Gated twice: an unpaid visitor is sent to pay first, and an already-booked
// visitor is sent to /thanks. A webhook-race guard (retrieve the Stripe
// session on ?session_id=) stamps paid_at + paid_amount_cents immediately so a
// customer who beats the webhook still reaches the calendar.

import { createClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { QuoteChrome } from '@/app/q/_chrome/QuoteChrome'
import { QuoteSheet, Letterhead, SheetSection } from '@/app/q/_chrome/parts'
import { tradeIcon } from '@/app/q/_chrome/icons'
import { loadTenantIdentity, contactDisplayName } from '@/lib/quote/tenant-identity'
import { loadTenantBookingOptions } from '@/lib/quote/trade-booking'
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
const GHOST_LINK = {
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
} as const

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

export default async function RoofBookingPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ paid?: string; session_id?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: row } = await supabase
    .from('roofing_measurements')
    .select('public_token, tenant_id, address, state, paid_at, scheduled_at, scheduled_window')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) notFound()

  // Webhook-race guard: if the customer beat the Stripe webhook here, verify
  // the session and stamp paid_at ourselves (conditional claim, idempotent).
  let paidAt = (row.paid_at as string | null) ?? null
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
  if (!paidAt) redirect(`/r/roof/${token}/inspection`)

  const scheduledAt = (row.scheduled_at as string | null) ?? null
  // Already booked → the thank-you page owns the confirmation. This page's
  // only job is picking a time.
  if (scheduledAt) redirect(`/q/roof/${token}/thanks`)

  const identity = await loadTenantIdentity(supabase, (row.tenant_id as string | null) ?? null)
  const tz = tzForState(identity?.state ?? (row.state as string | null) ?? null)
  const placeLabel = [row.address, row.state].filter(Boolean).join(', ') || null

  let calDays: CalendarDay[] = []
  if (row.tenant_id) {
    const options = await loadTenantBookingOptions(supabase, {
      tenantId: row.tenant_id as string,
      table: 'roofing_measurements',
    })
    calDays = toCalendarDays(options, tz)
  }

  return (
    <QuoteChrome trade={{ label: 'Roof', icon: tradeIcon('roof') }} sticky={null}>
      <QuoteSheet label={`Visit ${row.public_token.slice(0, 8).toUpperCase()}`}>
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

        {/* The ONLY job of this page: pick a date, then a time. The thank-you
            video, the booked confirmation and the add-to-calendar links live
            on /q/roof/<token>/thanks, which the booking POST redirects to. */}
        <SheetSection eyebrow="Book your site visit" eyebrowAccent>
          <p style={{ margin: '14px 0 0', maxWidth: 560, fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
            Payment received. Choose a date, then a time that suits — your visit
            is locked in as soon as you confirm.
          </p>
          <div style={{ marginTop: 14 }}>
            <BookingCalendar
              days={calDays}
              endpoint={`/api/q/book/roof/${token}`}
              tzLabel={shortTzLabel(tz)}
              labels={{ idle: 'Book this time →', submitting: 'Booking…', done: 'Booked ✓' }}
            />
          </div>
        </SheetSection>

        {/* Back to the quote */}
        <SheetSection>
          <a href={`/q/roof/${token}`} className="qm-ghost" style={GHOST_LINK}>
            ← Back to your quote
          </a>
        </SheetSection>
      </QuoteSheet>
    </QuoteChrome>
  )
}
