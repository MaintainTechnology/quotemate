// Customer-facing public solar estimate page (spec §6). Token-gated
// against solar_estimates.public_token (unguessable); service-role client
// because this is a public sharing surface.
//
// CONFIRM GATE: prices + deposit CTA are hidden until the estimate is
// confirmed (solar_estimates.confirmed_at set). A CLEAN estimate confirms
// AUTOMATICALLY at creation (Path B, docs/strategy.md v12 2026-06-16); a
// flagged estimate stays unconfirmed until the tradie reviews. The deferred
// assets (heatmap, auto-confirm) land a few seconds after creation, so
// HeatmapAutoRefresh re-renders the page until they arrive (no manual
// reload). Before confirmation the page shows the real satellite roof photo
// + stats overlay framed "indicative — your installer confirms". After
// confirmation it shows the full priced tier breakdown
// (kW, panels, yearly kWh, gross → STC subtraction → net, annual savings,
// banded payback), the always-visible assumptions panel, the confidence
// chip, the mandatory SAA/CEC compliance copy, and the per-tier deposit
// CTA (reusing /r/[token]/[tier]).
//
// TRANSPARENCY LAYER: each hero stat carries a native-<details>
// "why this number?" explainer (buildSolarStatExplainers) and the
// assumptions panel shows value / source / meaning / sensitivity per
// assumption (buildSolarAssumptionsView). Both are pure view models over
// persisted estimate fields — the page stays a server component with no
// client JS.
//
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { SolarEstimate } from '@/lib/solar/types'
import { resolveSolarQuoteView } from '@/lib/solar/quote-page-row'
import { buildSolarTierCards } from '@/lib/solar/tier-cards'
import { asQuoteTierMode, resolveVisibleTiers, type QuoteTierMode } from '@/lib/quote/tier-visibility'
import { buildHeroOverlay } from '@/lib/solar/hero-overlay'
import { buildSolarStatExplainers, type SolarStatExplainer } from '@/lib/solar/explainers'
import { buildSolarAssumptionsView, type SolarAssumptionRow } from '@/lib/solar/assumptions-view'
import { confidenceChip } from '@/lib/solar/confidence-chip'
import { resolveSolarDepositCta } from '@/lib/solar/deposit-cta'
import {
  SOLAR_COMPLIANCE_COPY,
  SOLAR_PRE_CONFIRM_COPY,
  SOLAR_PROJECTION_COPY,
  SOLAR_LAYOUT_COPY,
  SOLAR_ENVIRONMENTAL_COPY,
} from '@/lib/solar/compliance-copy'
import {
  buildSolarPremiumQuote,
  solarPremiumQuoteEnabled,
  type SolarPremiumQuote,
} from '@/lib/solar/premium-quote'
import { loadSolarConfig } from '@/lib/solar/config'
import type { SolarChart } from '@/lib/solar/charts'
import { buildSolarHardwareCards } from '@/lib/solar/hardware-cards'
import { buildSolarSunView } from '@/lib/solar/sun-view'
import { resolveSolarOverlayCenter } from '@/lib/solar/static-map-center'
import type { DetectedBuilding } from '@/lib/solar/types'
import { SunShadeOverlay } from './SunShadeOverlay'
import { SunShadeMap } from './SunShadeMap'
import { BuildingPickerSection } from './BuildingPickerSection'
import { HeatmapAutoRefresh } from './HeatmapAutoRefresh'
import { money, kwh, kw, paybackBand } from '@/lib/solar/quote-page-format'
import {
  repairSolarFeltLayers,
  type SolarFeltRecord,
} from '@/lib/solar/felt-provision'
import type { SolarAiBriefRecord } from '@/lib/solar/ai-brief'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  address: string | null
  state: string | null
  estimate: SolarEstimate | null
  confirmed_at: string | null
  quote_variant: string | null
  felt: SolarFeltRecord | null
  ai_brief: SolarAiBriefRecord | null
  buildings: DetectedBuilding[] | null
  selected_building_id: string | null
  tenant_id: string | null
}

const TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Starter',
  better: 'Full-size',
  best: 'Premium',
}

/** Staggered fade-up entrance, gated behind prefers-reduced-motion. */
function reveal(delayMs: number): string {
  return `motion-safe:animate-[fade-up_260ms_ease-out_both] [animation-delay:${delayMs}ms]`
}

export default async function SolarQuotePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const { data, error } = await supabase
    .from('solar_estimates')
    .select('address, state, estimate, confirmed_at, quote_variant, felt, ai_brief, buildings, selected_building_id, tenant_id')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row
  const estimate = row.estimate
  if (!estimate) notFound()

  // ── Felt variant (spec 2026-06-13 §4.7): the interactive roof map +
  // AI brief sections render only on quote_variant='felt' rows. A
  // failed/missing map degrades to the instant layout (§4.9). The lazy
  // repair pass styles layers that finished processing after the
  // provisioning poll budget — cheap status polls, no re-uploads.
  const isFeltVariant = row.quote_variant === 'felt'
  let felt = isFeltVariant ? row.felt : null
  if (felt && (felt.status === 'partial' || felt.status === 'provisioning')) {
    const repaired = await repairSolarFeltLayers(supabase, { publicToken: token })
    if (repaired) felt = repaired
  }
  const showFeltMap = Boolean(isFeltVariant && felt?.embed_url && felt.status !== 'failed')
  const aiBrief = isFeltVariant ? row.ai_brief : null

  const view = resolveSolarQuoteView({ estimate, confirmedAt: row.confirmed_at })
  const chip = confidenceChip({
    band: estimate.confidence_band,
    coverageSource: estimate.coverage_source,
  })
  const cards = buildSolarTierCards({
    price: estimate.price,
    production: estimate.production,
    economics: estimate.economics,
  })
  // Mig 142 — per-feature tier presentation mode for solar. Solar has no
  // quotes.selected_tier; its "recommended" is the headline (largest) tier, so
  // 'single' collapses to that. Read the tenant's solar pricing_book mode.
  const solarHeadlineTierKey =
    view.headlineTier?.tier ?? cards[cards.length - 1]?.tier ?? null
  let solarTierMode: QuoteTierMode = 'single'
  if (row.tenant_id) {
    const { data: pb } = await supabase
      .from('pricing_book')
      .select('quote_tier_mode')
      .eq('tenant_id', row.tenant_id)
      .eq('trade', 'solar')
      .maybeSingle()
    solarTierMode = asQuoteTierMode(
      (pb as { quote_tier_mode?: string | null } | null)?.quote_tier_mode,
    )
  }
  const visibleSolarTierKeys = resolveVisibleTiers({
    mode: solarTierMode,
    present: {
      good: cards.some((c) => c.tier === 'good'),
      better: cards.some((c) => c.tier === 'better'),
      best: cards.some((c) => c.tier === 'best'),
    },
    selectedTier: solarHeadlineTierKey,
  })
  const visibleCards = cards.filter((c) => visibleSolarTierKeys.includes(c.tier))
  const headlineProd = estimate.production[estimate.production.length - 1]
  const overlay = buildHeroOverlay({
    headlineTier: view.headlineTier,
    roof: estimate.roof,
    annualKwhAc: headlineProd?.annual_kwh_ac ?? 0,
  })
  const explainers = buildSolarStatExplainers(estimate)
  const assumptions = buildSolarAssumptionsView(estimate)
  // Sun & shade analysis (full-exploitation build 2026-06-13) — measured
  // sun hours, per-plane sun scores, the flux heatmap and the shade-free
  // window. No dollar figures → renders pre-confirm; null omits it.
  const sunView = buildSolarSunView(estimate)
  // Pylon hardware supplement (build 2026-06-13) — customer-facing
  // datasheet cards; empty array when the tenant nominated no SKUs.
  const hardwareCards = buildSolarHardwareCards(estimate.context)

  // ── Multi-roof building picker (2026-06-16). When the property carries
  // ≥2 detected buildings, let the viewer pick which roof the estimate is
  // for. The picker projects each building.footprint onto the SAME static
  // map the hero <img> shows — centred via resolveSolarOverlayCenter at
  // zoom 20 / 640×480 — so the outlines are pixel-aligned. Read-only once
  // the estimate is released/confirmed (no switching after the lock).
  const buildings = row.buildings ?? []
  const pickerCenter =
    buildings.length >= 2
      ? resolveSolarOverlayCenter({
          roof: estimate.roof,
          location: estimate.context.location ?? null,
        })
      : null
  const showBuildingPicker = buildings.length >= 2 && pickerCenter != null

  // Deferred-asset auto-refresh (2026-06-16): the Sun & shade heatmap and
  // — for a clean estimate — the auto-release confirm land a few seconds
  // after creation (estimate route's after() job). For a Google-coverage
  // estimate, poll until they arrive so a viewer who opened the quote
  // mid-generation sees the full result without a manual reload. The
  // confirm-flip is only awaited for a CLEAN estimate (a flagged one never
  // auto-confirms, so polling for it would never settle) — once its
  // heatmap lands the poller stops.
  const eligibleForAutoConfirm = (estimate.guardrail_flags ?? []).length === 0
  const pendingAssets =
    estimate.coverage_source === 'google' &&
    (!sunView?.flux_image_available || (!view.confirmed && eligibleForAutoConfirm))

  // Premium proposal sections (spec 2026-06-12 §4.4), behind the
  // SOLAR_PREMIUM_QUOTE flag. The view model degrades field-by-field
  // (§4.6) — each null simply omits its section.
  let premium: SolarPremiumQuote | null = null
  if (solarPremiumQuoteEnabled(process.env.SOLAR_PREMIUM_QUOTE)) {
    const config = await loadSolarConfig(supabase)
    premium = buildSolarPremiumQuote({ estimate, config, theme: 'dark' })
  }

  const chipBorder = chip.tone === 'warning' ? 'border-l-warning' : 'border-l-accent'
  const chipText = chip.tone === 'warning' ? 'text-warning' : 'text-accent'

  // AI "panels installed" concept: confirmed Google-coverage estimates
  // only. The proxy lazily renders + caches it post-confirm; manual roofs
  // have no trustworthy aerial to edit, so the block is simply omitted.
  const showAiConcept =
    view.confirmed && estimate.coverage_source === 'google' && view.headlineTier != null

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      {/* Reveal the heatmap + priced result without a manual reload once
          the estimate route's after() job finishes (renders nothing). */}
      {pendingAssets && <HeatmapAutoRefresh pending={pendingAssets} />}
      {/* Topographic background — signature Maintain motif. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.10]"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <path d="M0,820 Q240,640 480,730 T960,680 T1440,740 T1920,640" stroke="var(--teal-glow)" strokeWidth="1" fill="none" />
        <path d="M0,880 Q260,700 520,790 T1000,740 T1480,800 T1920,700" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.7" />
        <path d="M0,940 Q280,770 560,850 T1040,800 T1520,860 T1920,770" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.45" />
        <path d="M0,180 Q320,300 640,220 T1280,260 T1920,190" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.35" />
        <path d="M0,110 Q300,230 600,150 T1240,190 T1920,120" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.2" />
      </svg>

      <section className="relative z-10 mx-auto max-w-4xl px-6 pt-14 pb-10 sm:px-10">
        <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent ${reveal(0)}`}>
          QuoteMax · Solar
        </div>
        <h1 className={`mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)] ${reveal(60)}`}>
          Your solar <span className="text-accent">estimate</span>
        </h1>
        {row.address && (
          <p className={`mt-4 text-lg text-text-sec ${reveal(120)}`}>{row.address}</p>
        )}

        {/* Confidence chip */}
        <div className={reveal(180)}>
          <div className={`mt-6 inline-flex items-center gap-3 border border-ink-line ${chipBorder} border-l-4 bg-ink-card px-4 py-2`}>
            <span className={`font-mono text-sm font-semibold uppercase tracking-[0.16em] ${chipText}`}>
              {chip.bandLabel}
            </span>
            {chip.indicativeOnly && (
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-warning">
                Indicative only
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text-dim">{chip.caption}</p>
        </div>

        {/* Hero: real satellite roof photo + stats overlay, with the
            clearly-labelled AI concept render beside it once confirmed. */}
        <div className={`mt-8 grid gap-5 ${showAiConcept ? 'lg:grid-cols-2' : ''} ${reveal(240)}`}>
          <div className="overflow-hidden border border-ink-line bg-ink-card">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/solar/q/${token}/static-map`}
                alt={`Satellite view of the roof at ${row.address ?? 'the property'}`}
                className="h-112 w-full object-cover sm:h-128"
              />
              <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-px bg-ink-line/60 sm:grid-cols-4">
                {overlay.stats.map((s) => (
                  <div key={s.label} className="bg-ink-deep/85 px-4 py-3">
                    <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                      {s.label}
                    </div>
                    <div className="mt-1 font-mono text-base font-bold tabular-nums text-accent">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
              {overlay.caption}
            </div>
          </div>

          {showAiConcept && (
            <div className="overflow-hidden border border-ink-line bg-ink-card">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/solar/q/${token}/panels-after`}
                  alt={`AI-generated concept of ${view.headlineTier?.panels_count ?? ''} solar panels installed on the roof at ${row.address ?? 'the property'}`}
                  className="h-112 w-full object-cover sm:h-128"
                />
                <span className="absolute left-3 top-3 border border-ink-line bg-ink-deep/85 px-3 py-1.5 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-accent">
                  AI-generated concept
                </span>
              </div>
              <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
                How {view.headlineTier?.panels_count} panels could sit on this roof —
                illustrative only, not a design document.
              </div>
            </div>
          )}
        </div>

        {/* ── Size explainer — why the headline system is the size it is.
            Only renders when the largest tier came out below what the roof /
            request implied (export-limit clamp or roof-fit), so a "6 kW"
            result never looks like an unexplained shrink. */}
        {view.sizeNote && (
          <div className={`mt-8 border border-ink-line border-l-4 border-l-warning bg-ink-card p-5 sm:p-6 ${reveal(255)}`}>
            <h3 className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-warning">
              {view.sizeNote.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-text-sec">
              {view.sizeNote.body}
            </p>
          </div>
        )}

        {/* ── Felt interactive roof map (Felt tab spec 2026-06-13 §4.7).
            Live satellite map with the panel layout, sun-exposure heat
            map, roof-plane sun scores and elevation — toggled via Felt's
            own legend inside the embed. Unlisted view_only map, tokenless
            embed (Phase 0 verified). No dollars → renders pre-confirm. */}
        {showFeltMap && felt && (
          <div className={`mt-10 ${reveal(270)}`}>
            <SectionHeading label="Explore your roof — interactive map" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
              Pan and zoom the real satellite view of your roof. Use the map
              legend to flip between the proposed panel layout, the
              sun-exposure heat map, and the roof elevation. Tap any panel
              for its yearly output.
            </p>
            <div className="mt-5 overflow-hidden border border-ink-line bg-ink-card">
              <iframe
                src={felt.embed_url!}
                title={`Interactive roof map for ${row.address ?? 'the property'}`}
                className="h-112 w-full sm:h-128"
                loading="lazy"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups"
                allow="fullscreen"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-line px-5 py-3">
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
                  {felt.status === 'ready'
                    ? 'Panels · Sun exposure · Elevation — toggle in the map legend'
                    : 'Map layers are still building — refresh in a minute for the full set'}
                </span>
                <span className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-text-dim">
                  Maps by Felt
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── AI roof-intelligence brief (§4.6) — Anthropic prose grounded
            on the measured roof facts; a fabricated number would have
            discarded the whole brief server-side. Clearly labelled. */}
        {aiBrief && (
          <div className={`mt-10 ${reveal(285)}`}>
            <SectionHeading label="Roof intelligence" />
            <div className="mt-5 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-7">
              <div className="flex flex-wrap items-center gap-3">
                <span className="border border-ink-line bg-ink-deep px-3 py-1 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-accent">
                  AI-generated summary
                </span>
                <span className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-text-dim">
                  Figures from your roof analysis
                </span>
              </div>
              <h3 className="mt-4 text-xl font-extrabold uppercase tracking-tight text-text-pri">
                {aiBrief.headline}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-text-sec">
                {aiBrief.layout_rationale}
              </p>
              <div className="mt-5 grid gap-px bg-ink-line sm:grid-cols-2">
                <div className="bg-ink-deep px-5 py-4">
                  <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                    Best roof face
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-text-sec">
                    {aiBrief.best_plane_note}
                  </p>
                </div>
                <div className="bg-ink-deep px-5 py-4">
                  <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                    Across the seasons
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-text-sec">
                    {aiBrief.seasonal_note}
                  </p>
                </div>
              </div>
              {aiBrief.caveats.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {aiBrief.caveats.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-text-dim">
                      <span className="mt-0.5 font-mono font-bold text-accent" aria-hidden>
                        ·
                      </span>
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* §4.4-2 — Proposed panel layout (deterministic, pre-confirm OK).
            The SVG projects the SAME Solar API panel geometry against the
            SAME map centre the static-map route used — pixel-aligned by
            construction. Omitted when no geometry exists (§4.6). */}
        {premium?.layout && (
          <div className={`mt-10 ${reveal(300)}`}>
            <SectionHeading label="Proposed panel layout" />
            <div className="mt-5 overflow-hidden border border-ink-line bg-ink-card">
              <div className="relative aspect-[4/3] w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/solar/q/${token}/static-map`}
                  alt={`Satellite view of the roof at ${row.address ?? 'the property'} with the proposed panel layout drawn over it`}
                  className="absolute inset-0 h-full w-full"
                />
                <div
                  className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: premium.layout.svg }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-line px-5 py-3">
                {premium.layout.legend.map((l) => (
                  <span key={l.segment_index} className="inline-flex items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-text-sec">
                    <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: l.color }} aria-hidden />
                    {l.plane_label} · {l.panels_count} {l.panels_count === 1 ? 'panel' : 'panels'}
                  </span>
                ))}
              </div>
              <div className="border-t border-ink-line px-5 py-3 text-xs leading-relaxed text-text-dim">
                {SOLAR_LAYOUT_COPY} {overlay.caption}
              </div>
            </div>
          </div>
        )}

        {/* §4.4-3 — Panel strings & component markings (indicative). */}
        {premium?.strings && (
          <div className={`mt-10 ${reveal(330)}`}>
            <SectionHeading label="Panel strings & component markings" />
            <div className="mt-5 overflow-hidden border border-ink-line bg-ink-card">
              <div className="relative aspect-[4/3] w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/solar/q/${token}/static-map`}
                  alt={`Satellite view of the roof at ${row.address ?? 'the property'} with indicative panel string runs drawn over it`}
                  className="absolute inset-0 h-full w-full opacity-80"
                />
                <div
                  className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: premium.strings.svg }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-line px-5 py-3">
                {premium.strings.strings.map((s) => (
                  <span key={s.string_number} className="inline-flex items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-text-sec">
                    <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: s.color }} aria-hidden />
                    S{s.string_number} · {s.panels_count}{' '}
                    {s.panels_count === 1 ? 'panel' : 'panels'}
                  </span>
                ))}
              </div>
              <div className="border-t border-ink-line px-5 py-3 text-xs leading-relaxed text-text-dim">
                {premium.strings.caption}
              </div>
            </div>
          </div>
        )}

        {/* ── Multi-roof building picker (2026-06-16). Lets the viewer
            switch which structure the estimate is for. Read-only once the
            estimate is released/confirmed. Hidden below 2 buildings. */}
        {showBuildingPicker && pickerCenter && (
          <div className={`mt-10 ${reveal(275)}`}>
            <SectionHeading label="Which building?" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
              We found more than one building on this property. The estimate
              below is for the highlighted roof — tap another building to
              re-estimate that one instead.
            </p>
            <BuildingPickerSection
              token={token}
              center={pickerCenter}
              buildings={buildings}
              selectedBuildingId={row.selected_building_id}
              readOnly={view.confirmed}
            />
          </div>
        )}

        {/* Sun & shade analysis (full-exploitation build 2026-06-13) —
            measured roof irradiance heatmap, sunshine hours, per-plane
            sun scores and the shade-free window. No dollars → renders
            pre-confirm. Each sub-block omits itself without data. */}
        {sunView && (
          <div className={`mt-10 ${reveal(280)}`}>
            <SectionHeading label="Sun & shade analysis" />

            {sunView.flux_image_available &&
              (sunView.flux_bounds ? (
                // Georeferenced, pan/zoom heatmap — markers placed at real
                // lat/lng, so off-centre buildings stay aligned. New / re-drafted
                // estimates only (they carry flux_bounds).
                <SunShadeMap
                  heatmapSrc={`/api/solar/q/${token}/flux-heatmap`}
                  alt={`Roof irradiance heatmap for ${row.address ?? 'the property'} — brighter areas receive more annual sun`}
                  markers={sunView.markers}
                  caption={sunView.flux_caption}
                  bounds={sunView.flux_bounds}
                />
              ) : (
                // Static fallback for estimates drafted before flux_bounds was
                // persisted — image-% positioning, no regression.
                <SunShadeOverlay
                  heatmapSrc={`/api/solar/q/${token}/flux-heatmap`}
                  alt={`Roof irradiance heatmap for ${row.address ?? 'the property'} — brighter areas receive more annual sun`}
                  markers={sunView.markers}
                  caption={sunView.flux_caption}
                />
              ))}

            {sunView.stats.length > 0 && (
              <div className="mt-5 grid gap-px overflow-hidden border border-ink-line bg-ink-line sm:grid-cols-2 lg:grid-cols-3">
                {sunView.stats.map((s) => (
                  <MiniStat key={s.label} label={s.label} value={s.value} hint={s.hint} />
                ))}
              </div>
            )}

            {/* Per-plane rows are the FALLBACK for estimates without
                on-image anchors (pre-anchor rows, manual path). When the
                labels are pinned on the heatmap above, the list would
                duplicate them — so it only renders without markers. */}
            {sunView.markers.length === 0 && sunView.planes.length > 0 && (
              <div className="mt-5 grid gap-px bg-ink-line">
                {sunView.planes.map((p, i) => (
                  <div
                    key={`${p.orientation}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-3 bg-ink-deep px-5 py-3"
                  >
                    <span className="font-mono text-sm font-semibold text-text-pri">
                      {p.orientation} face · {p.area_m2.toLocaleString('en-AU')} m²
                    </span>
                    <span className="inline-flex items-center gap-3">
                      <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-accent">
                        {p.score_copy}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-text-dim">
                        {p.relative_pct}% of best face
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* The numbers, explained — expandable "why?" per hero stat. */}
        <div className={`mt-10 ${reveal(300)}`}>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
              The numbers, explained
            </span>
            <span className="h-px flex-1 bg-ink-line" aria-hidden />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-text-sec">
            Every figure above traces back to a measurement or a published
            rate. Open any number to see exactly how it was worked out —
            the same trail your installer reviews.
          </p>
          <div className="mt-5 grid gap-px bg-ink-line sm:grid-cols-2">
            {explainers.map((e) => (
              <ExplainerCard key={e.key} explainer={e} />
            ))}
          </div>
        </div>

        {/* §4.4-4 — System details: modelled monthly production + the
            Pylon-style assumed-values table. No dollar figures, so this
            renders pre-confirm. */}
        {premium && (premium.charts.monthlyProduction || premium.assumed_values.length > 0) && (
          <div className="mt-10">
            <SectionHeading label="System details" />
            {premium.charts.monthlyProduction && (
              <ChartFigure chart={premium.charts.monthlyProduction} className="mt-5" />
            )}
            {premium.assumed_values.length > 0 && (
              <div className="mt-5 grid gap-px overflow-hidden border border-ink-line bg-ink-line sm:grid-cols-3">
                {premium.assumed_values.map((r) => (
                  <div key={r.label} className="bg-ink-deep px-4 py-3">
                    <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                      {r.label}
                    </div>
                    <div className="mt-1 font-mono text-sm font-bold tabular-nums text-text-pri">
                      {r.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Your hardware — tenant-nominated components enriched with
            Pylon manufacturer datasheets (supplements build 2026-06-13).
            No dollar figures → renders pre-confirm. */}
        {hardwareCards.length > 0 && (
          <div className="mt-10">
            <SectionHeading label="Your hardware" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
              The equipment your installer fits as standard — manufacturer
              datasheets included.
            </p>
            <ul className="mt-5 space-y-3">
              {hardwareCards.map((c) => (
                <li key={c.kindLabel + c.name} className="border border-ink-line bg-ink-card p-5">
                  <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-accent">
                    {c.kindLabel}
                  </div>
                  <div className="mt-1.5 text-base font-semibold text-text-pri">{c.name}</div>
                  {c.detail && <div className="mt-0.5 text-sm text-text-sec">{c.detail}</div>}
                  {c.datasheetUrl && (
                    <a
                      href={c.datasheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block font-mono text-xs font-semibold uppercase tracking-[0.12em] text-text-dim underline decoration-1 underline-offset-2 transition-colors hover:text-accent"
                    >
                      Manufacturer datasheet
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pre-confirmation notice */}
        {!view.showPrices && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card px-6 py-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              {view.inspectionRequired ? 'On-site check needed' : 'Estimate drafted'}
            </div>
            <p className="mt-2 text-base text-text-sec">
              {view.inspectionRequired
                ? (estimate.routing.reason ||
                  'This roof needs a quick look on site before we can finalise a price.')
                : SOLAR_PRE_CONFIRM_COPY}
            </p>
          </div>
        )}

        {/* §4.4-5 — Utility costs (dollar figures → confirm-gated). */}
        {view.showPrices && premium?.charts.utilityCosts && (
          <div className="mt-10">
            <SectionHeading label="Utility costs — before & with solar" />
            <ChartFigure chart={premium.charts.utilityCosts} className="mt-5" />
          </div>
        )}

        {/* §4.4-6 — 20-year financial summary (confirm-gated). */}
        {view.showPrices && premium?.financial && (
          <div className="mt-10">
            <SectionHeading label="20-year financial summary" />
            <div className="mt-5 grid gap-px overflow-hidden border border-ink-line bg-ink-line sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat
                label="Net present value"
                value={`$${money(premium.financial.npv_aud)}`}
                hint={`Discounted at ${(premium.financial.assumptions.discount_rate_pct * 100).toFixed(1)}%`}
              />
              <MiniStat
                label="Payback"
                value={paybackBand(
                  premium.financial.payback_years_low,
                  premium.financial.payback_years_high,
                )}
                hint="Simple payback band"
              />
              <MiniStat
                label="Total ROI (20 yr)"
                value={`${premium.financial.total_roi_pct.toLocaleString('en-AU')}%`}
                hint={`$${money(premium.financial.total_savings_20yr_aud)} cumulative`}
              />
              <MiniStat
                label="IRR"
                value={
                  premium.financial.irr_pct != null
                    ? `${premium.financial.irr_pct.toLocaleString('en-AU')}%`
                    : 'See installer'
                }
                hint="Internal rate of return"
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-dim">{SOLAR_PROJECTION_COPY}</p>
          </div>
        )}

        {/* §4.4-7 — Financial analysis charts (confirm-gated). */}
        {view.showPrices &&
          premium &&
          (premium.charts.monthlyBill || premium.charts.cumulativeSavings) && (
            <div className="mt-10">
              <SectionHeading label="Financial analysis" />
              {premium.charts.cumulativeSavings && (
                <ChartFigure chart={premium.charts.cumulativeSavings} className="mt-5" />
              )}
              {premium.charts.monthlyBill && (
                <ChartFigure chart={premium.charts.monthlyBill} className="mt-5" />
              )}
            </div>
          )}

        {/* §4.4-8 — Environmental analysis (no dollars → pre-confirm OK).
            Omitted when the grid carbon factor is absent (§4.6). */}
        {premium?.environmental && (
          <div className="mt-10">
            <SectionHeading label="Environmental analysis" />
            <div className="mt-5 grid gap-px overflow-hidden border border-ink-line bg-ink-line sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat
                label="CO₂e avoided / yr"
                value={`${premium.environmental.tonnes_co2_per_year.toLocaleString('en-AU')} t`}
              />
              <MiniStat
                label="CO₂e over 20 yrs"
                value={`${premium.environmental.tonnes_co2_20yr.toLocaleString('en-AU')} t`}
              />
              <MiniStat
                label="Like planting"
                value={`${premium.environmental.trees_equiv_per_year.toLocaleString('en-AU')} trees/yr`}
              />
              <MiniStat
                label="Like not driving"
                value={`${premium.environmental.km_driven_equiv_per_year.toLocaleString('en-AU')} km/yr`}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-dim">{SOLAR_ENVIRONMENTAL_COPY}</p>
          </div>
        )}

        {/* §4.4-9 — Pricing & acceptance (tier cards, confirm-gated). */}
        {view.showPrices && (
          <div className="mt-10 space-y-6">
            <div className="flex items-center gap-4">
              <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
                System options · {visibleCards.length} size{visibleCards.length === 1 ? '' : 's'}
              </span>
              <span className="h-px flex-1 bg-ink-line" aria-hidden />
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {visibleCards.map((c, i) => {
                const cta = resolveSolarDepositCta({
                  confirmed: view.confirmed,
                  token,
                  tier: c.tier,
                  inspectionRequired: view.inspectionRequired,
                })
                return (
                  <article key={c.tier} className="flex flex-col border border-ink-line bg-ink-card p-6">
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-4xl font-bold leading-none text-accent">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                        {TIER_NAME[c.tier]} · {c.label}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MiniStat label="System" value={`${kw(c.systemKwDc)} kW`} />
                      <MiniStat label="Panels" value={String(estimate.sizing.tiers.find((t) => t.tier === c.tier)?.panels_count ?? 0)} />
                      <MiniStat label="Yearly output" value={`${kwh(c.annualKwhAc)} kWh`} />
                      <MiniStat label="Annual saving" value={`$${money(c.annualSavingsAud)}`} />
                    </div>

                    {/* Gross → STC subtraction → net */}
                    <div className="mt-5 space-y-1.5 border-t border-ink-line pt-4 font-mono text-sm tabular-nums">
                      <div className="flex justify-between text-text-sec">
                        <span>Gross (inc GST)</span>
                        <span>${money(c.grossIncGst)}</span>
                      </div>
                      <div className="flex justify-between text-text-sec">
                        <span>STC rebate ({c.stcCertificates} certs)</span>
                        <span>−${money(c.stcRebateAud)}</span>
                      </div>
                      <div className="flex justify-between border-t border-ink-line pt-2 text-base font-bold text-accent">
                        <span>Net (inc GST)</span>
                        <span>${money(c.netIncGst)}</span>
                      </div>
                    </div>

                    <div className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                      Payback {paybackBand(c.paybackLow, c.paybackHigh)}
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-text-sec">{c.scope}</p>

                    {/* Gated deposit CTA */}
                    <div className="mt-5 pt-2">
                      {cta.show ? (
                        <a
                          href={cta.href}
                          className="block bg-accent px-5 py-3 text-center font-mono text-sm font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent-press"
                        >
                          Pay deposit
                        </a>
                      ) : (
                        <div className="text-center font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                          {SOLAR_PRE_CONFIRM_COPY}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {/* Always-visible assumptions panel — value, source, meaning, direction. */}
        <div className="mt-10 border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              Assumptions — shown, not hidden
            </span>
            <span className="h-px flex-1 bg-ink-line" aria-hidden />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-text-sec">
            These are the levers behind the savings and payback figures.
            Each one shows the value we used, where it comes from, and
            which way your numbers move if your household differs.
          </p>
          <div className="mt-5 grid gap-px bg-ink-line">
            {assumptions.rows.map((r) => (
              <AssumptionRow key={r.key} row={r} />
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-text-dim">{assumptions.footnote}</p>
        </div>

        {/* Mandatory SAA/CEC compliance copy (+ projection disclaimer
            whenever the premium financial sections rendered). */}
        <p className="mt-8 text-sm text-text-dim">{SOLAR_COMPLIANCE_COPY}</p>
        {view.showPrices && premium?.financial && (
          <p className="mt-3 text-xs leading-relaxed text-text-dim">{SOLAR_PROJECTION_COPY}</p>
        )}
      </section>

      <div className="relative z-10 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax · Solar
        </span>
      </div>
    </main>
  )
}

/** Eyebrow + rule — the section divider every premium section reuses. */
function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
        {label}
      </span>
      <span className="h-px flex-1 bg-ink-line" aria-hidden />
    </div>
  )
}

/** One pure-SVG chart (charts.ts) in a bordered card with its caption. */
function ChartFigure({ chart, className }: { chart: SolarChart; className?: string }) {
  return (
    <figure className={`overflow-hidden border border-ink-line bg-ink-card ${className ?? ''}`}>
      <div
        className="p-4 [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: chart.svg }}
      />
      <figcaption className="border-t border-ink-line px-5 py-3 text-xs leading-relaxed text-text-dim">
        {chart.caption}
      </figcaption>
    </figure>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}

/**
 * One expandable "why this number?" card. Native <details> keeps the
 * page a pure server component — no client JS, works without hydration.
 */
function ExplainerCard({ explainer }: { explainer: SolarStatExplainer }) {
  return (
    <details className="group bg-ink-card">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors hover:bg-ink [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            {explainer.statLabel}
          </div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-accent">
            {explainer.statValue}
          </div>
        </div>
        <span className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors group-open:text-accent group-hover:text-text-sec">
          {explainer.question}
        </span>
        <span
          className="font-mono text-xl leading-none text-accent transition-transform duration-200 group-open:rotate-45"
          aria-hidden
        >
          +
        </span>
      </summary>

      <div className="border-t border-ink-line px-5 py-5">
        <p className="text-sm leading-relaxed text-text-sec">{explainer.answer}</p>

        {explainer.steps.length > 0 && (
          <ol className="mt-4 space-y-2.5">
            {explainer.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-sm font-bold leading-5 text-accent">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-sm leading-relaxed text-text-sec">{step}</span>
              </li>
            ))}
          </ol>
        )}

        {explainer.facts.length > 0 && (
          <dl className="mt-4 grid gap-px overflow-hidden border border-ink-line bg-ink-line sm:grid-cols-2">
            {explainer.facts.map((f) => (
              <div key={f.label} className="bg-ink-deep px-3.5 py-2.5">
                <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                  {f.label}
                </dt>
                <dd className="mt-1 font-mono text-sm font-bold tabular-nums text-text-pri">
                  {f.value}
                </dd>
                {f.note && <dd className="mt-0.5 text-xs leading-snug text-text-dim">{f.note}</dd>}
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  )
}

/** One transparent assumption: value, source, meaning, direction of effect. */
function AssumptionRow({ row }: { row: SolarAssumptionRow }) {
  return (
    <div className="grid gap-3 bg-ink-deep px-5 py-4 md:grid-cols-[14rem_1fr]">
      <div>
        <div className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          {row.label}
        </div>
        <div className="mt-1.5 font-mono text-base font-bold tabular-nums text-accent">
          {row.value}
        </div>
        <div className="mt-1.5 font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.14em] text-text-dim">
          Source · {row.source}
        </div>
      </div>
      <div className="text-sm leading-relaxed">
        <p className="text-text-sec">{row.meaning}</p>
        <p className="mt-1.5 text-text-dim">
          <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-teal-glow">
            If it moves ·{' '}
          </span>
          {row.sensitivity}
        </p>
      </div>
    </div>
  )
}
