// Public, read-only residential painting quote (spec R11/R21).
// Token = painting_measurements.public_token — unguessable, same trust model
// as /q/[token]. Service-role read because this is a public sharing surface.
//
// Renders the deterministic PaintingEstimate (lib/painting/types.ts) on the
// shared QuoteMax quote chrome (app/q/_chrome/*) — scopes, derived paintable
// area, and the three price tiers as inc-GST RANGES (the estimate is a band,
// not a point).
//
// Deposit (R12): per-tier Stripe deposit links (migration 156) drive the tier
// CTAs via the /r/paint short-link; tiers without a stored Checkout session
// show a "Contact us to book" state. A paid quote shows a confirmed state.

import { createClient } from '@supabase/supabase-js'
import type { PaintingEstimate, PaintScope, PaintingPriceTier } from '@/lib/painting/types'
import { composePaintLocation } from '@/lib/painting/paint-after'
import { customerTakeoff } from '@/lib/painting/takeoff'
import { customerMeasurementNotes } from '@/lib/painting/customer-notes'
import {
  buildStreetViewMetadataUrl,
  parseStreetViewMetadata,
} from '@/lib/painting/streetview'
import { asQuoteTierMode, resolveVisibleTiers, type QuoteTierMode } from '@/lib/quote/tier-visibility'
import { canShowPaintingPrices } from '@/lib/painting/publish-gate'
import { loadTenantIdentity, contactDisplayName } from '@/lib/quote/tenant-identity'
import { QuoteChrome, type StickyBar } from '../../_chrome/QuoteChrome'
import { RepaintPreviewFigure } from '../../_chrome/RepaintPreviewFigure'
import { TradieJobBanner } from '../../_chrome/TradieJobBanner'
import { AcceptBlock } from '../../_chrome/AcceptBlock'
import { resolveAcceptView } from '@/lib/quote/accept'
import { formatVisitSlot } from '@/lib/quote/trade-booking'
import { tzForState } from '@/lib/quote/availability'
import { tradeIcon } from '../../_chrome/icons'
import {
  QuoteSheet, Letterhead, QuoteHero, StatGrid, Scope,
  SheetSection, TierCards, CredentialFooter,
  type QuoteTier, type Stat, type FooterRow,
} from '../../_chrome/parts'

export const dynamic = 'force-dynamic'

/** Primary yellow CTA into the booking / thank-you pages. Dark ink on the
 *  accent — white on yellow is ~1.4:1 and forbidden. */
const PAINT_CTA_LINK = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  padding: '13px 20px',
  fontFamily: 'var(--font-sans)',
  fontWeight: 700,
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  textDecoration: 'none',
} as const

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const aud = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const SCOPE_LABEL: Record<PaintScope, string> = {
  walls: 'Walls',
  ceilings: 'Ceilings',
  trim: 'Trim & doors',
  exterior: 'Exterior',
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default async function PaintingQuotePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: row } = await supabase
    .from('painting_measurements')
    .select(
      'address, postcode, state, scopes, confidence, routing, estimate, public_token, customer_name, created_at, tenant_id, preview_status, tenants:tenant_id(business_name)',
    )
    .eq('public_token', token)
    .maybeSingle()

  if (!row || !row.estimate) {
    return (
      <QuoteChrome trade={{ label: 'Paint', icon: tradeIcon('paint') }} sticky={null}>
        <QuoteSheet>
          <SheetSection eyebrow="Invalid link" eyebrowAccent first>
            <h1
              style={{
                margin: '14px 0 0',
                fontFamily: 'var(--font-sans)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '-0.02em',
                fontSize: 28,
                lineHeight: 1,
                color: 'var(--text-pri)',
              }}
            >
              Quote not found
            </h1>
            <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              This quote link is invalid or has expired. Text us if you need it re-sent.
            </p>
          </SheetSection>
        </QuoteSheet>
      </QuoteChrome>
    )
  }

  const business =
    (row.tenants as { business_name?: string } | null)?.business_name ?? 'Your painter'

  // Tradie identity for the letterhead (logo + Contact / Phone / Email),
  // matching the reference quote surface. Best-effort: degrades to the joined
  // business_name when identity columns are absent or tenant_id is null.
  const identity = await loadTenantIdentity(
    supabase,
    (row as { tenant_id?: string | null }).tenant_id ?? null,
  )

  const estimate = row.estimate as PaintingEstimate
  const tiers: PaintingPriceTier[] = estimate.price?.tiers ?? []
  const measurement = estimate.measurement
  const scopes = (row.scopes as PaintScope[] | null) ?? estimate.measurement?.surfaces?.map((s) => s.scope) ?? []
  const inspection = estimate.price?.routing?.decision === 'inspection_required'

  // Mig 142 — per-feature tier presentation mode. Residential painting has no
  // quotes.selected_tier, so 'single' resolves to the Better (2-coat) baseline.
  let paintTierMode: QuoteTierMode = 'single'
  if (row.tenant_id) {
    const { data: pb } = await supabase
      .from('pricing_book')
      .select('quote_tier_mode')
      .eq('tenant_id', row.tenant_id as string)
      .eq('trade', 'painting')
      .maybeSingle()
    paintTierMode = asQuoteTierMode(
      (pb as { quote_tier_mode?: string | null } | null)?.quote_tier_mode,
    )
  }
  const visibleTierKeys = resolveVisibleTiers({
    mode: paintTierMode,
    present: {
      good: tiers.some((t) => t.tier === 'good'),
      better: tiers.some((t) => t.tier === 'better'),
      best: tiers.some((t) => t.tier === 'best'),
    },
    selectedTier: 'better',
  })
  const visibleTiers = tiers.filter((t) => visibleTierKeys.includes(t.tier))

  // Per-tier Stripe deposit links (migration 156). Read in a SEPARATE,
  // best-effort query so this LIVE page never breaks if the code deploys
  // before the migration applies (the columns simply aren't selected then →
  // payErr set → the placeholder shows). Each tier with a stored Checkout
  // session gets a "Pay deposit" button via the /r/paint short-link; a paid
  // quote shows a confirmed state instead of re-charging.
  let stripeLinks: Record<string, string> = {}
  let paid = false
  let paidTier: string | null = null
  let paintScheduledAt: string | null = null
  let paintScheduledWindow: string | null = null
  // `released` defaults TRUE so a pre-migration deploy and every dashboard-saved
  // quote (released at save) keep showing prices; only a HELD SMS/self-serve
  // draft (released_at null) gates them until the tradie clicks Send.
  let released = true
  const { data: payRow, error: payErr } = await supabase
    .from('painting_measurements')
    .select('stripe_links, paid_at, paid_tier, released_at, scheduled_at, scheduled_window')
    .eq('public_token', token)
    .maybeSingle()
  if (!payErr && payRow) {
    stripeLinks = (payRow.stripe_links as Record<string, string> | null) ?? {}
    paid = !!(payRow.paid_at as string | null)
    paidTier = (payRow.paid_tier as string | null) ?? null
    paintScheduledAt = (payRow.scheduled_at as string | null) ?? null
    paintScheduledWindow = (payRow.scheduled_window as string | null) ?? null
    released = (payRow.released_at as string | null) != null
  }

  // Self-serve visit booking (mig 167) now happens on /q/paint/<token>/book,
  // which loads the painter's open windows itself — this page only links to it,
  // so no booking query runs here at all.
  const priceGate = canShowPaintingPrices({ releasedAt: released ? 'released' : null })

  const date = new Date(row.created_at as string).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const showTiers = !inspection && priceGate.showPrices
  const source = estimate.facts?.source ?? 'property data'

  // ─── Stat grid — up to 4 truthful cells from data that exists ─────────
  const statItems: Stat[] = []
  if (measurement) {
    statItems.push({ k: 'Floor area', v: `${Math.round(measurement.floor_area_m2)} m²` })
    statItems.push({ k: 'Paintable area', v: `${Math.round(estimate.price?.total_area_m2 ?? 0)} m²` })
    if (measurement.storeys != null) {
      statItems.push({ k: 'Storeys', v: String(measurement.storeys) })
    }
    statItems.push({
      k: 'Confidence',
      v: titleCase(String(row.confidence ?? measurement.confidence ?? '—')),
    })
  }

  // ─── Scope of works — surfaces measured + About-your-home facts ───────
  const scopeItems: import('../../_chrome/parts').ScopeItem[] = []
  const surfaces = Array.isArray(measurement?.surfaces) ? measurement.surfaces : []
  if (scopes.length > 0 || surfaces.length > 0) {
    scopeItems.push({
      title: 'Surfaces to paint',
      body:
        scopes.length > 0
          ? scopes.map((s) => SCOPE_LABEL[s] ?? s).join(' · ')
          : undefined,
      list:
        surfaces.length > 0
          ? surfaces.map((s) => (
              <span key={s.scope}>
                {SCOPE_LABEL[s.scope] ?? s.scope} —{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {Math.round(s.quantity)} {s.unit === 'lm' ? 'lm' : 'm²'}
                </span>
              </span>
            ))
          : undefined,
    })
  }
  const facts = estimate.facts
  const homeList: string[] = []
  if (facts?.property_type) homeList.push(`Type — ${facts.property_type}`)
  if (facts?.bedrooms != null) homeList.push(`Bedrooms — ${facts.bedrooms}`)
  if (facts?.bathrooms != null) homeList.push(`Bathrooms — ${facts.bathrooms}`)
  if (facts?.car_spaces != null) homeList.push(`Car spaces — ${facts.car_spaces}`)
  if (facts?.land_size_m2 != null) homeList.push(`Land size — ${Math.round(facts.land_size_m2)} m²`)
  if (homeList.length > 0) {
    scopeItems.push({ title: 'About your home', list: homeList })
  }

  // ─── Tier cards — mirror the original per-tier CTA gating exactly ─────
  const quoteTiers: QuoteTier[] = visibleTiers.map((tier) => {
    const paidThis = paid && paidTier === tier.tier
    let ctaLabel: string
    let ctaHref: string | null
    if (paid) {
      ctaLabel = paidThis ? 'Deposit paid ✓' : 'Deposit paid'
      ctaHref = null
    } else if (stripeLinks[tier.tier]) {
      ctaLabel = 'Pay deposit'
      ctaHref = `/r/paint/${token}/${tier.tier}`
    } else {
      ctaLabel = 'Contact us to book'
      ctaHref = null
    }
    return {
      name: tier.label,
      blurb: tier.scope,
      priceText: aud(tier.inc_gst),
      priceNote: `inc GST · ${aud(tier.inc_gst_low)}–${aud(tier.inc_gst_high)}`,
      ctaLabel,
      ctaHref,
    }
  })

  // ─── Sticky bar — the featured (Better if visible, else first) tier ───
  const featured =
    visibleTiers.find((t) => t.tier === 'better') ?? visibleTiers[0] ?? null
  let stickyBar: StickyBar | null = null
  if (paid) {
    stickyBar = {
      paid: true,
      paidSub: paidTier
        ? `${titleCase(paidTier)} option — your painter will be in touch`
        : 'Your painter will be in touch',
    }
  } else if (showTiers && featured) {
    stickyBar = {
      tierLabel: `${featured.label} option`,
      priceText: aud(featured.inc_gst),
      ctaLabel: stripeLinks[featured.tier] ? 'Pay deposit' : 'Contact us to book',
      ctaHref: stripeLinks[featured.tier] ? `/r/paint/${token}/${featured.tier}` : null,
    }
  }

  // ─── Credential footer — only rows whose data genuinely exists ────────
  const footerRows: FooterRow[] = []
  footerRows.push({ k: 'Painter', v: business })
  if (row.address) {
    footerRows.push({
      k: 'Property',
      v: [String(row.address), [row.postcode, row.state].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', '),
    })
  }
  footerRows.push({ k: 'Prepared', v: date })
  footerRows.push({
    k: 'Terms',
    v: `Prices are inc-GST estimates derived from ${source} and your declared scope. The final price is confirmed after a quick on-site check.`,
  })

  // Clean street / suburb headline: drop a trailing "<STATE> <POSTCODE>" so the
  // accent line isn't a redundant "4151 QLD" echo of the address in line 1.
  const rawAddr = String(row.address ?? 'Your property')
  const cleanAddr =
    rawAddr.replace(/,?\s*(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b\s*\d{4}\s*$/i, '').trim() || rawAddr
  const addrSegs = cleanAddr.split(',').map((s) => s.trim()).filter(Boolean)
  const heroLine1 = addrSegs.length >= 2 ? `${addrSegs.slice(0, -1).join(', ')},` : cleanAddr
  const heroLine2 = addrSegs.length >= 2 ? addrSegs[addrSegs.length - 1] : undefined

  // Explicit "Accept & confirm" block (Gap #1/#3). Residential painting already
  // has a working per-tier deposit via /r/paint/<token>/<tier> (mints fresh),
  // so the accept block confirms the featured tier and routes there. Rendered
  // only in the priced/released (deposit) state or once paid — a held/on-site
  // paint quote keeps its existing note (no $99 checkout exists for painting).
  const paintAcceptView = resolveAcceptView({
    token,
    tier: (featured?.tier ?? 'better') as 'good' | 'better' | 'best',
    isPaid: paid,
    pricesVisible: showTiers,
    priceExpired: false,
    priceLabel: featured ? `${aud(featured.inc_gst)} inc GST` : null,
    depositHref: featured ? `/r/paint/${token}/${featured.tier}` : undefined,
  })
  const showPaintAccept = (showTiers && !!featured) || paid

  const heroStatus: { label: string; tone: 'await' | 'booked' } = paid
    ? { label: 'Deposit paid', tone: 'booked' }
    : inspection
      ? { label: 'On-site measure', tone: 'await' }
      : { label: 'Awaiting you', tone: 'await' }
  // Property imagery (spec quote-visual-parity R3) — FREE Street View metadata
  // check at render so the section only appears when Google actually has a
  // pano here (no broken frames; mirrors /p/[token]). The AI repaint
  // AUTO-generates on first load (product decision 2026-07-11); the
  // after-image route's released_at gate still means a held draft can never
  // bill a Gemini render.
  let hasPano = false
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY
  if (mapsKey && row.address) {
    try {
      const metaRes = await fetch(
        buildStreetViewMetadataUrl(
          {
            location: composePaintLocation({
              address: String(row.address),
              postcode: (row.postcode as string | null) ?? null,
              state: (row.state as string | null) ?? null,
            }),
          },
          { apiKey: mapsKey },
        ),
      )
      hasPano = parseStreetViewMetadata(await metaRes.json().catch(() => null)).ok
    } catch {
      /* best-effort — page renders without the imagery section */
    }
  }
  const afterImageReady = (row.preview_status as string | null) === 'ready'
  // Customer-safe take-off (quantities + time on site, no internal costs),
  // limited to the tiers this quote actually shows.
  const customerTiers = customerTakeoff(estimate.takeoff).filter((c) =>
    visibleTierKeys.includes(c.tier),
  )
  // Customer-safe price derivation (mirrors the PDF's "How your price was
  // built" table). The rates shown are the CHARGE side of the quote —
  // internal costs and margin never render on customer surfaces. Suppressed
  // after a manual tier edit: the derivation would no longer reconcile with
  // the hand-set headline prices.
  const bd0 = estimate.price?.breakdown
  const breakdown =
    !estimate.price?.manual_override && bd0 && (bd0.surfaces?.length ?? 0) > 0 ? bd0 : null
  const measuredNotes = customerMeasurementNotes(measurement?.notes)

  const heroGreeting = inspection
    ? (estimate.price?.routing?.reason ??
        "This job needs a quick on-site measure before we can lock a price. We'll be in touch to book a time.")
    : !priceGate.showPrices
      ? priceGate.reason
      : visibleTiers.length === 1
        ? 'One painting option below — all prices include 10% GST as an estimated range.'
        : 'Your painting options below — all prices include 10% GST as an estimated range.'

  return (
    <QuoteChrome trade={{ label: 'Paint', icon: tradeIcon('paint') }} sticky={stickyBar}>
      {/* Owner-only "Review & edit" pill → /p/[estimate_token] (spec R3). */}
      <TradieJobBanner trade="painting" publicToken={row.public_token} />
      <QuoteSheet label={`Painting quote · ${business}`}>
        <Letterhead
          name={identity?.business_name ?? business}
          credential={`Painting quote · ${date}`}
          logoUrl={identity?.logo_url ?? null}
          contactName={contactDisplayName(identity)}
          phone={(identity?.owner_mobile ?? '').trim() || null}
          email={(identity?.owner_email ?? '').trim() || null}
        />

        <QuoteHero
          quoteId={`Painting quote · ${business}`}
          status={heroStatus}
          line1={heroLine1}
          line2={heroLine2}
          greeting={heroGreeting}
          issued={`Issued ${date}`}
        />

        {statItems.length > 0 ? <StatGrid items={statItems} /> : null}

        {/* ── Property imagery via the token-gated /api/painting/q/[token]
            proxies (spec quote-visual-parity R3; mirrors /p/[token]).
            Top row: the real photos (Street View frontage + aerial).
            Below: the before/after repaint block with the colour picker. ── */}
        {hasPano ? (
          <SheetSection eyebrow="Your property" eyebrowAccent>
            <div
              style={{
                display: 'grid',
                gap: 14,
                marginTop: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              }}
            >
              <figure style={{ margin: 0, border: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
                {/* The source photo is 4:3 — an aspect-ratio box shows the
                    whole property instead of a fixed-height crop. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/painting/q/${row.public_token}/street-view`}
                  alt={`Street View of the front of ${row.address ?? 'the property'}`}
                  style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                />
                <figcaption
                  style={{
                    borderTop: '1px solid var(--ink-line)',
                    padding: '10px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: 'var(--text-dim)',
                  }}
                >
                  Front of the property · Google Street View
                </figcaption>
              </figure>
              <figure style={{ margin: 0, border: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/painting/q/${row.public_token}/static-map`}
                  alt={`Aerial view of ${row.address ?? 'the property'}`}
                  style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                />
                <figcaption
                  style={{
                    borderTop: '1px solid var(--ink-line)',
                    padding: '10px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: 'var(--text-dim)',
                  }}
                >
                  Aerial view · Google Maps
                </figcaption>
              </figure>
            </div>
            <div style={{ marginTop: 14 }}>
              <RepaintPreviewFigure
                publicToken={row.public_token}
                address={row.address}
                initialReady={afterImageReady}
              />
            </div>
          </SheetSection>
        ) : null}

        {scopeItems.length > 0 ? (
          <Scope
            items={scopeItems}
            eyebrow={measurement ? `Scope of works · measured from ${source}` : 'Scope of works'}
          />
        ) : null}

        {/* ── Inspection note · held-for-review note · OR tiers ── */}
        {inspection ? (
          <SheetSection eyebrow="On-site measure needed" eyebrowAccent>
            <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              {estimate.price?.routing?.reason ??
                "This job needs a quick on-site measure before we can lock a price. We'll be in touch to book a time."}
            </p>
          </SheetSection>
        ) : !priceGate.showPrices ? (
          <SheetSection eyebrow="Quote being finalised" eyebrowAccent>
            <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              {priceGate.reason}
            </p>
          </SheetSection>
        ) : quoteTiers.length > 0 ? (
          <TierCards
            heading={visibleTiers.length === 1 ? 'Your painting option' : 'Your painting options'}
            intro={`Prices are inc-GST estimates derived from ${source} and your declared scope. The final price is confirmed after a quick on-site check.`}
            tiers={quoteTiers}
          />
        ) : null}

        {/* ── How your price was built — customer-safe derivation. Each row
            is the already-computed ex-GST cost of a measured surface (rates,
            coats, prep and colour allowance are baked into that cost), so the
            surface costs sum EXACTLY to the subtotal — no separate multiplier
            step (that would double-count). Tier-relation rows are shown only
            when the call-out floor did not override them. Same content as the
            PDF table (lib/painting/report-html.ts). ── */}
        {showTiers && breakdown ? (() => {
          const tierLabel = (k: 'good' | 'better' | 'best') =>
            tiers.find((t) => t.tier === k)?.label
          const betterLabel = tierLabel('better') ?? 'Better'
          // Small-job floor overrides the surface-derived tier prices, so the
          // "= Better × N%" rows would no longer reconcile — suppress them.
          const floorApplied = !!estimate.price?.call_out_minimum_applied
          const rows: Array<{ k: string; v: string; strong?: boolean }> = []
          for (const s of breakdown.surfaces) {
            const unit = s.unit === 'lm' ? 'lm' : 'm²'
            rows.push({
              k: `${SCOPE_LABEL[s.scope] ?? titleCase(String(s.scope))} · ${Math.round(s.quantity)} ${unit}`,
              v: aud(s.line_ex_gst),
            })
          }
          if (Number.isFinite(breakdown.better_ex_gst)) {
            rows.push({ k: 'Subtotal (ex GST)', v: aud(breakdown.better_ex_gst), strong: true })
          }
          if (!floorApplied && visibleTierKeys.includes('good') && tierLabel('good') && Number.isFinite(breakdown.good_refresh_fraction)) {
            rows.push({
              k: `${tierLabel('good')} = ${betterLabel} ×`,
              v: `${Math.round(breakdown.good_refresh_fraction * 100)}%`,
            })
          }
          if (!floorApplied && visibleTierKeys.includes('best') && tierLabel('best') && Number.isFinite(breakdown.premium_uplift_pct)) {
            rows.push({
              k: `${tierLabel('best')} = ${betterLabel} ×`,
              v: `${Math.round((1 + breakdown.premium_uplift_pct) * 100)}%`,
            })
          }
          if (Number.isFinite(breakdown.gst_factor) && breakdown.gst_factor > 1) {
            rows.push({ k: 'GST', v: `+ ${Math.round((breakdown.gst_factor - 1) * 100)}%` })
          }
          if (floorApplied && Number.isFinite(breakdown.call_out_minimum_ex_gst) && breakdown.call_out_minimum_ex_gst > 0) {
            rows.push({ k: 'Call-out minimum applied', v: aud(breakdown.call_out_minimum_ex_gst) })
          }
          const loadings = estimate.price?.loadings_applied ?? []
          return (
            <SheetSection eyebrow="How your price was built" eyebrowAccent>
              <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                Your {betterLabel} price is the sum of each measured surface below. Each cost
                already includes the coats, surface preparation and prep consumables (filler,
                caulk, tape and drop sheets); headline prices above include GST.
              </p>
              <div style={{ marginTop: 14, border: '1px solid var(--ink-line)', background: 'var(--ink-card)', padding: '6px 16px' }}>
                {rows.map((r, i) => (
                  <div
                    key={`${r.k}-${i}`}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '9px 0',
                      borderTop: i === 0 ? 'none' : '1px solid var(--ink-line)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12.5,
                      color: r.strong ? 'var(--text-pri)' : 'var(--text-sec)',
                      fontWeight: r.strong ? 600 : 400,
                    }}
                  >
                    <span>{r.k}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: r.strong ? 'var(--accent)' : 'var(--text-pri)' }}>
                      {r.v}
                    </span>
                  </div>
                ))}
              </div>
              {loadings.length > 0 ? (
                <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-sec)' }}>
                  {loadings.map((l) => (
                    <div key={l.code}>+ {l.detail}</div>
                  ))}
                </div>
              ) : null}
            </SheetSection>
          )
        })() : null}

        {/* ── How we measured — measurement provenance, standalone so it shows
            whenever notes exist (independent of the price-build section and a
            manual tier edit), matching the PDF exactly. ── */}
        {measuredNotes.length > 0 ? (
          <SheetSection eyebrow="How we measured" eyebrowAccent>
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text-sec)' }}>
              {measuredNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>A painter confirms all measurements on site before works commence.</li>
            </ul>
          </SheetSection>
        ) : null}

        {/* ── Materials & time on site — the CUSTOMER-safe take-off view:
            paint quantities and duration per option. Internal costs, rates
            and margin never render on customer surfaces. ── */}
        {!inspection && priceGate.showPrices && customerTiers.length > 0 ? (
          <SheetSection eyebrow="Materials & time on site" eyebrowAccent>
            <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              What each option uses on your property — litres round up to whole retail packs, and
              time on site is an estimate at standard working days, confirmed before works commence.
            </p>
            <div
              style={{
                display: 'grid',
                gap: 12,
                marginTop: 14,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              {customerTiers.map((c) => {
                const tierLabel = visibleTiers.find((t) => t.tier === c.tier)?.label ?? c.tier
                return (
                  <div
                    key={c.tier}
                    style={{ border: '1px solid var(--ink-line)', background: 'var(--ink-card)', padding: '14px 16px' }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.14em',
                        color: 'var(--accent)',
                      }}
                    >
                      {tierLabel}
                    </div>
                    <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                      {c.materials.map((m) => (
                        <li
                          key={m}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            lineHeight: 1.6,
                            color: 'var(--text-sec)',
                          }}
                        >
                          {m}
                        </li>
                      ))}
                    </ul>
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: '1px solid var(--ink-line)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        color: 'var(--text-pri)',
                      }}
                    >
                      {c.time_on_site}
                    </div>
                  </div>
                )
              })}
            </div>
          </SheetSection>
        ) : null}

        {/* ── Explicit "Accept & confirm" — deposit on a released/priced quote,
            confirmation once paid. ── */}
        {showPaintAccept ? <AcceptBlock token={token} view={paintAcceptView} /> : null}

        {/* Self-serve visit booking — appears once the deposit is paid. The
            picker itself lives on the dedicated /book page since 2026-07-22
            (spec booking-three-page-split R3), so this is a link rather than an
            inline picker the customer has to scroll a pricing page to find.
            Mig 167. */}
        {paid ? (
          <SheetSection eyebrow={paintScheduledAt ? 'Visit booked' : 'Pick your visit time'} eyebrowAccent>
            {paintScheduledAt ? (
              <div style={{ marginTop: 12, display: 'grid', gap: 14, justifyItems: 'start' }}>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                  Your visit is booked for{' '}
                  <strong style={{ color: 'var(--text-pri)' }}>
                    {formatVisitSlot(paintScheduledAt, paintScheduledWindow, tzForState(identity?.state ?? null))}
                  </strong>
                  . {business} will text you the day before to confirm.
                </p>
                <a href={`/q/paint/${token}/thanks`} className="qm-cta" style={PAINT_CTA_LINK}>
                  View your booking →
                </a>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                  Deposit received — pick a time that suits and we&apos;ll lock in your visit.
                </p>
                <a href={`/q/paint/${token}/book`} className="qm-cta" style={PAINT_CTA_LINK}>
                  Pick your visit time →
                </a>
              </div>
            )}
          </SheetSection>
        ) : null}

        <CredentialFooter rows={footerRows} />
      </QuoteSheet>
    </QuoteChrome>
  )
}
