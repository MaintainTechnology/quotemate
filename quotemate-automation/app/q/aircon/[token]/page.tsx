// Public, read-only air-conditioning recommendation (spec R11/R22).
// Token = aircon_recommendations.public_token (migration 144 — APPLY BEFORE
// THIS WORKS, and wire /api/aircon/recommend to persist a row + token).
// Service-role read; public sharing surface.
//
// Renders the sized load + the two system options (ducted vs split) with an
// indicative inc-GST price BAND each — an aircon-appropriate format, not the
// electrical G/B/B card. Aircon is always "book an assessment" (indicative
// posture), so there is no deposit CTA — the action is to book the site visit.
//
// Reskinned onto the shared QuoteMax quote chrome (app/q/_chrome/*). Data
// fetching, sizing values, price bands and the book-assessment posture are
// unchanged — this is presentation only.

import { createClient } from '@supabase/supabase-js'
import type { AcRecommendation, AcOption } from '@/lib/aircon/types'
import { loadTenantIdentity, contactDisplayName } from '@/lib/quote/tenant-identity'
import { QuoteChrome } from '../../_chrome/QuoteChrome'
import { tradeIcon } from '../../_chrome/icons'
import {
  QuoteSheet, Letterhead, QuoteHero, StatGrid, TierCards, GoodToKnow, CredentialFooter,
  type QuoteTier, type Stat,
} from '../../_chrome/parts'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const aud = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const SYSTEM_LABEL: Record<AcOption['system_type'], string> = {
  ducted: 'Ducted',
  split: 'Split system',
}

export default async function AirconQuotePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: row, error } = await supabase
    .from('aircon_recommendations')
    .select('address, postcode, state, recommendation, created_at, tenant_id, tenants:tenant_id(business_name)')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !row || !row.recommendation) return <NotFound />

  // Tradie identity for the letterhead (logo + Contact / Phone / Email),
  // matching the reference quote surface. Best-effort: degrades to the joined
  // business_name when identity columns are absent or tenant_id is null.
  const identity = await loadTenantIdentity(
    supabase,
    (row as { tenant_id?: string | null }).tenant_id ?? null,
  )

  const rec = row.recommendation as AcRecommendation
  const sizing = rec.sizing
  const options = Array.isArray(rec.options) ? rec.options : []
  const business =
    identity?.business_name ??
    (row.tenants as { business_name?: string } | null)?.business_name ??
    'Your installer'
  const date = new Date(row.created_at as string).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const address = String(row.address ?? 'Your property')
  const locationLine = [row.postcode, row.state].filter(Boolean).join(' · ')

  // Sticky bar shows the book-assessment action + an indicative anchor
  // (best-fit band if present, else the ducted central-unit size). No
  // booking link exists in the data model, so the CTA is label-only.
  const bestFit = options.find((o) => o.best_fit)
  const stickyPrice =
    bestFit ? `${aud(bestFit.price.low)}–${aud(bestFit.price.high)}`
      : sizing ? `${round1(sizing.ducted_kw)} kW`
        : 'On request'

  const stats: Stat[] = sizing
    ? [
        { k: 'Floor area', v: `${Math.round(sizing.total_floor_area_m2)} m²`, sub: 'conditioned' },
        { k: 'Zones', v: String(sizing.conditioned_zones ?? '—'), sub: 'rooms cooled' },
        { k: 'Ducted size', v: `${round1(sizing.ducted_kw)} kW`, sub: 'central unit' },
        { k: 'Storeys', v: String(sizing.storeys ?? '—'), sub: 'levels' },
      ]
    : []

  const tiers: QuoteTier[] = options.map((opt) => {
    const items = [
      ...(opt.pros ?? []).map((p) => `+ ${p}`),
      ...(opt.cons ?? []).map((c) => `– ${c}`),
    ]
    return {
      name: SYSTEM_LABEL[opt.system_type],
      badge: opt.best_fit ? 'Best fit' : null,
      recommended: opt.best_fit,
      blurb: `${round1(opt.capacity_kw)} kW ${SYSTEM_LABEL[opt.system_type].toLowerCase()}`,
      priceText: `${aud(opt.price.low)}–${aud(opt.price.high)}`,
      priceNote: 'inc GST · indicative',
      items,
      ctaLabel: 'Book assessment',
      ctaHref: null,
    }
  })

  const routingReason =
    rec.routing?.reason ??
    'These figures are indicative. We confirm the exact system and a fixed price after a quick on-site assessment.'

  return (
    <QuoteChrome
      trade={{ label: 'Air-con', icon: tradeIcon('aircon') }}
      sticky={{
        tierLabel: 'Book a site assessment',
        priceText: stickyPrice,
        ctaLabel: 'Book assessment',
        ctaHref: null,
      }}
    >
      <QuoteSheet label="Air-con recommendation">
        <Letterhead
          name={identity?.business_name ?? business}
          credential="Air-conditioning · indicative recommendation"
          logoUrl={identity?.logo_url ?? null}
          contactName={contactDisplayName(identity)}
          phone={(identity?.owner_mobile ?? '').trim() || null}
          email={(identity?.owner_email ?? '').trim() || null}
        />
        <QuoteHero
          quoteId={`Air-con · ${business}`}
          line1={sizing ? `${round1(sizing.ducted_kw)} kW` : 'AIR-CON'}
          line2={address}
          greeting={
            <>Here&apos;s what suits your home, sized from the details we have. The prices below are indicative bands — we lock the exact system and a fixed price after a quick on-site assessment.</>
          }
          issued={`Prepared ${date}`}
          valid={locationLine || null}
        />

        {stats.length ? <StatGrid items={stats} /> : null}

        {tiers.length ? (
          <TierCards
            eyebrow="Your systems"
            heading={options.length === 1 ? 'Your option' : 'Ducted vs split'}
            intro="Both prices are indicative inc-GST bands. Nothing is fixed until the on-site assessment — no deposit, no obligation."
            tiers={tiers}
          />
        ) : null}

        <GoodToKnow
          eyebrow="Next step · book an assessment"
          items={[routingReason]}
          note="These figures are indicative until we confirm access, switchboard capacity and the exact system on site. Book the assessment and we'll turn it into a fixed quote."
        />

        <CredentialFooter
          rows={[
            { k: 'Installer', v: business },
            { k: 'Prepared', v: date },
            ...(locationLine ? [{ k: 'Property', v: `${address} · ${locationLine}` }] : [{ k: 'Property', v: address }]),
            { k: 'Pricing', v: 'Indicative inc-GST bands · confirmed on site' },
          ]}
          tagline="Book the assessment · We confirm the system · You get a fixed price"
        />
      </QuoteSheet>
    </QuoteChrome>
  )
}

function round1(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (Math.round(n * 10) / 10).toString()
}

function NotFound() {
  return (
    <QuoteChrome trade={{ label: 'Air-con', icon: tradeIcon('aircon') }}>
      <QuoteSheet label="Air-con recommendation">
        <section style={{ padding: '40px 24px', borderBottom: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--warning-bright)' }}>
            Invalid link
          </div>
          <h1 style={{ margin: '14px 0 0', fontFamily: 'var(--font-sans)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.02em', fontSize: 28, lineHeight: 1.02, color: 'var(--text-pri)' }}>
            Recommendation not found
          </h1>
          <p style={{ margin: '16px 0 0', fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
            This link is invalid or has expired. Get in touch if you need it re-sent.
          </p>
        </section>
      </QuoteSheet>
    </QuoteChrome>
  )
}
