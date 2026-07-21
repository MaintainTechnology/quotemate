// Roofing site-visit booking landing page.
//
// The $99 site-visit payment (createRoofingSiteVisitSession) now redirects
// here after Stripe success. This page shows the tradie's thank-you video AND
// a calendar to pick the visit time — so the customer lands on one clear
// "thanks, now choose your time" page instead of scrolling a long slot list
// back on the quote surface.
//
// Paid-gated: an unpaid visitor is sent to pay first. A webhook-race guard
// (retrieve the Stripe session on ?session_id=) stamps paid_at immediately so
// a customer who beats the webhook still sees the booking calendar.

import { createClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import { QuoteChrome } from '@/app/q/_chrome/QuoteChrome'
import { QuoteSheet, Letterhead, SheetSection, TrustVideo, AddToCalendar } from '@/app/q/_chrome/parts'
import { tradeIcon } from '@/app/q/_chrome/icons'
import { loadTenantIdentity, contactDisplayName, trustVideoUrls } from '@/lib/quote/tenant-identity'
import { loadTenantBookingOptions, formatVisitSlot } from '@/lib/quote/trade-booking'
import { visitCalendarLinks } from '@/lib/quote/calendar-links'
import { tzForState } from '@/lib/quote/availability'
import { getStripe } from '@/lib/stripe/client'
import type { BookingOption } from '@/lib/quote/slots'
import { BookingCalendar, type CalendarDay } from '../BookingCalendar'

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

/** Group booking options into calendar days, dated in the tenant's timezone
 *  so the grid lines up with the times the customer will actually get. */
function toCalendarDays(options: BookingOption[], tz: string): CalendarDay[] {
  const keyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const byKey = new Map<string, CalendarDay>()
  for (const o of options) {
    const key = keyFmt.format(new Date(o.iso))
    let day = byKey.get(key)
    if (!day) {
      const [y, m, d] = key.split('-').map(Number)
      const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
      day = { key, year: y, monthIndex: m - 1, date: d, weekday, label: o.dayLabel, times: [] }
      byKey.set(key, day)
    }
    day.times.push({ iso: o.iso, chip: o.chipLabel })
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

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

  const identity = await loadTenantIdentity(supabase, (row.tenant_id as string | null) ?? null)
  const tradieName = identity?.business_name ?? 'Your roofer'
  const tz = tzForState(identity?.state ?? (row.state as string | null) ?? null)
  const videos = trustVideoUrls(identity)
  const scheduledAt = (row.scheduled_at as string | null) ?? null
  const scheduledWindow = (row.scheduled_window as string | null) ?? null
  const placeLabel = [row.address, row.state].filter(Boolean).join(', ') || null
  const slotLabel = scheduledAt ? formatVisitSlot(scheduledAt, scheduledWindow, tz) : ''
  const calLinks = scheduledAt
    ? visitCalendarLinks({
        scheduledAt,
        scheduledWindow,
        tradieName,
        slotLabel,
        // Raw address already ends with the state, so prefer it over placeLabel
        // (which re-appends state and can double it).
        location: (row.address as string | null)?.trim() || placeLabel,
        timeZone: tz,
      })
    : null

  let calDays: CalendarDay[] = []
  if (!scheduledAt && row.tenant_id) {
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

        {/* Thank-you video — enlarged + centred (hero of this page). */}
        <SheetSection eyebrow="Thank you" eyebrowAccent>
          <div style={{ marginTop: 14, display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center' }}>
            <div className="qm-print-hide" style={{ width: '100%', maxWidth: 720 }}>
              <TrustVideo
                src={videos.thankyou}
                title={tradieName}
                caption="A thank-you message from your tradie"
              />
            </div>
            <p style={{ margin: 0, maxWidth: 560, fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              Thanks, we have received your $99 site-visit payment.{' '}
              {scheduledAt
                ? `${tradieName} will be in touch to confirm the exact time.`
                : 'Pick a time below and your visit is locked in.'}
            </p>
          </div>
        </SheetSection>

        {/* Booking */}
        <SheetSection eyebrow={scheduledAt ? 'Your site visit' : 'Book your site visit'} eyebrowAccent>
          {scheduledAt ? (
            <div style={{ marginTop: 14, display: 'grid', gap: 16, maxWidth: 520 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                Your site visit is booked for{' '}
                <strong style={{ color: 'var(--text-pri)' }}>{slotLabel}</strong>
                . {tradieName} will be in touch to confirm the exact time.
              </p>
              {calLinks ? (
                <AddToCalendar
                  google={calLinks.google}
                  outlook={calLinks.outlook}
                  outlookOffice={calLinks.outlookOffice}
                  icsHref={`/q/roof/${token}/visit.ics`}
                />
              ) : null}
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <BookingCalendar
                days={calDays}
                endpoint={`/api/q/book/roof/${token}`}
                tzLabel={shortTzLabel(tz)}
                labels={{ idle: 'Book this time →', submitting: 'Booking…', done: 'Booked ✓' }}
              />
            </div>
          )}
        </SheetSection>

        {/* Back to the quote — visible in both booked and unbooked states. */}
        <SheetSection>
          <a href={`/q/roof/${token}`} className="qm-ghost" style={GHOST_LINK}>
            ← Back to your quote
          </a>
        </SheetSection>
      </QuoteSheet>
    </QuoteChrome>
  )
}
