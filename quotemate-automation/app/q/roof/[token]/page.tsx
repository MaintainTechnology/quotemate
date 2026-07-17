// Customer-facing public roofing quote page.
// Reached via the SMS link "Full breakdown + your roof image: {url}".
// Token-gated against roofing_measurements.public_token (unguessable);
// the service-role client is used because this is a public sharing
// surface — only the columns rendered below are exposed.
//
// CONFIRM GATE: prices are hidden until the customer confirms over SMS
// (roofing_measurements.confirmed_at is set). Before that the page is a
// price-free "which building is yours?" picker — the satellite + the
// measured outlines + per-structure metrics, no dollar figures. After
// confirmation it shows the full priced breakdown, narrowed to the
// structure(s) they picked (confirmed_structure, or the ?s= link from a
// follow-up like "give me 2 and 3"), plus an AI "after re-roof" preview
// rendered from the satellite aerial.
//
// This mirrors the dashboard /dashboard/roofing/measure result: the
// Geoscape roof outline on satellite (RoofMap, free Esri tiles), the
// Google satellite "second eye", and a full per-structure pricing
// breakdown (metrics, every tier with its scope, effective rate +
// loadings) plus the combined total. Read-only — no editing.
//
// Reskin: the QuoteMax "command-center" quote surface (app/q/_chrome/*) —
// dark, square, 520px sheet. All data + gate logic is unchanged; only the
// presentation of already-computed values moved into the kit components.

import type { CSSProperties } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import type {
  MultiRoofQuote,
  RoofMaterial,
  RoofMetrics,
  RoofStructurePrice,
} from '@/lib/roofing/types'
import { partitionRoofQuote, resolveEffectiveIndices } from '@/lib/roofing/selection'
import { structureStaticMapPath } from '@/lib/roofing/structure-images'
import {
  ZONE_COLOR_HEX,
  ZONE_TEXT_HEX,
  combinedLayoutMetrics,
  layoutMaterials,
  type LayoutPlan,
} from '@/lib/roofing/layout-plan'
import type { LayoutOverlayStructure } from '@/lib/roofing/layout-overlay-svg'
import { edgeStat } from '@/lib/roofing/geometry-edges'
import { buildingAttributeChips, propertyContextChips } from '@/lib/roofing/attributes-display'
import { applySolarToTiers, indicativeCombinedTiers } from '@/lib/sms/roofing-compose'
import { roofQuoteCta } from '@/lib/roofing/quote-cta'
import { loadTenantIdentity, contactDisplayName } from '@/lib/quote/tenant-identity'
import { asQuoteTierMode, resolveVisibleTiers } from '@/lib/quote/tier-visibility'
import { RoofMap, type RoofMapBuilding } from '@/app/dashboard/roofing/_components/RoofMap'
import { QuoteChrome, type StickyBar } from '../../_chrome/QuoteChrome'
import { RoofLayoutMapFigure } from '../../_chrome/RoofLayoutMapFigure'
import { TradieJobBanner } from '../../_chrome/TradieJobBanner'
import { AcceptBlock } from '../../_chrome/AcceptBlock'
import { resolveAcceptView } from '@/lib/quote/accept'
import { loadTenantBookingOptions, formatVisitSlot } from '@/lib/quote/trade-booking'
import { tzForState } from '@/lib/quote/availability'
import { SlotPicker } from '@/app/q/[token]/book/SlotPicker'
import { tradeIcon } from '../../_chrome/icons'
import {
  QuoteSheet,
  Letterhead,
  QuoteHero,
  StatGrid,
  SheetSection,
  Scope,
  MetricGrid,
  TierCards,
  GoodToKnow,
  CredentialFooter,
  type Stat,
  type QuoteTier,
  type ScopeItem,
  type Metric,
  type FooterRow,
} from '../../_chrome/parts'

export const dynamic = 'force-dynamic'

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)' }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  tenant_id: string | null
  address: string | null
  state: string | null
  provider: string | null
  routing: string | null
  combined_area_m2: number | null
  quote: MultiRoofQuote | null
  public_token: string
  confirmed_at: string | null
  confirmed_structure: number | null
  included_indices: number[] | null
}

function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const MATERIAL_LABEL: Record<RoofMaterial, string> = {
  colorbond_corrugated: 'Colorbond Corrugated',
  colorbond_trimdek: 'Colorbond Trimdek',
  colorbond_spandek: 'Colorbond Spandek',
  colorbond_kliplok: 'Colorbond Klip-Lok 700',
  concrete_tile: 'Concrete tile',
  terracotta_tile: 'Terracotta tile',
  cement_sheet: 'Cement sheet',
  unknown: 'To confirm on site',
}

function formLabel(form: RoofMetrics['form']): string {
  switch (form) {
    case 'gable': return 'Gable'
    case 'hip': return 'Hip'
    case 'skillion': return 'Skillion'
    case 'gable_hip': return 'Gable + hip'
    case 'complex': return 'Complex'
    default: return 'To confirm'
  }
}

const TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Patch',
  better: 'Full roof replacement',
  best: 'Upgraded roof replacement',
}

/** Parse a `?s=2,3` query value into validated 1-based indices (or null). */
function parseIndices(s: string | string[] | undefined, max: number): number[] | null {
  const raw = Array.isArray(s) ? s.join(',') : s
  if (!raw) return null
  const nums = raw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= max)
  const uniq = [...new Set(nums)].sort((a, b) => a - b)
  return uniq.length > 0 ? uniq : null
}

export default async function RoofingQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ s?: string | string[]; full?: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()
  const sp = await searchParams

  const { data, error } = await supabase
    .from('roofing_measurements')
    .select('tenant_id, address, state, provider, routing, combined_area_m2, quote, public_token, confirmed_at, confirmed_structure, included_indices')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row

  // Promoted measurement (mig 168): its single source of truth is the quotes
  // row (spec quote-sync-and-roofing-workflow-fix F1) — old SMS'd /q/roof
  // links must land on the live, tradie-editable quote, not this frozen
  // pre-promotion snapshot with stale prices. Exceptions:
  //   • a measurement that already took its own site-visit payment stays —
  //     this page is that payment's receipt + booking surface;
  //   • ?full=1 — the dashboard's Saved-roofing-job "View" opens THIS rich
  //     measurement view (satellite + structures + layout map, priced from
  //     the live selection); without it the tradie landed on the generic
  //     promoted quote whose geocoded hero often showed the WRONG building.
  // Both columns post-date 081, so they're read best-effort (like the
  // mig-165 payment block below): a pre-migration DB just skips the redirect.
  if (sp.full !== '1') {
    const { data: promo } = await supabase
      .from('roofing_measurements')
      .select('quote_share_token, paid_at')
      .eq('public_token', token)
      .maybeSingle()
    if (promo?.quote_share_token && !promo.paid_at) {
      redirect(`/q/${promo.quote_share_token}`)
    }
  }

  // Tradie identity for the letterhead (logo + Contact / Phone / Email),
  // matching the reference quote surface. Best-effort: degrades to null when
  // tenant_id is absent or the identity columns aren't present, so the page
  // still renders (logo/contact simply hidden).
  const identity = await loadTenantIdentity(supabase, row.tenant_id ?? null)

  // Mig 142 — per-tenant tier presentation mode (spec five-sections R3b).
  // This page was the LAST customer-reachable surface rendering all three
  // roofing tiers unconditionally while the promoted quote page, the PDF and
  // the SMS all honoured quote_tier_mode. 'single' (the platform default and
  // both live roofing books) resolves to 'better' — "Full roof replacement".
  let roofTierMode = asQuoteTierMode(null)
  if (row.tenant_id) {
    const { data: pb } = await supabase
      .from('pricing_book')
      .select('quote_tier_mode')
      .eq('tenant_id', row.tenant_id)
      .eq('trade', 'roofing')
      .maybeSingle()
    roofTierMode = asQuoteTierMode(
      (pb as { quote_tier_mode?: string | null } | null)?.quote_tier_mode,
    )
  }

  const fullQuote = row.quote
  const allStructures: RoofStructurePrice[] = Array.isArray(fullQuote?.structures) ? fullQuote!.structures : []

  // Confirm gate — prices show only after the customer confirms over SMS.
  const confirmed = row.confirmed_at != null

  // AI layout plan (spec quote-visual-parity R6e) — READ-ONLY here: the
  // customer page renders the cached plan and never triggers generation.
  // Separate best-effort query (migration 170 pattern).
  let layoutPlan: LayoutPlan | null = null
  {
    const { data: lp, error: lpErr } = await supabase
      .from('roofing_measurements')
      .select('layout_status, layout_plan')
      .eq('public_token', token)
      .maybeSingle()
    if (!lpErr && lp && lp.layout_status === 'ready') {
      layoutPlan = (lp.layout_plan as LayoutPlan | null) ?? null
    }
  }

  // Which structures to show on the priced view. The tradie's persisted
  // selection (included_indices) is the source of truth; a ?s= link or the
  // single pick stamped at confirm time can only NARROW it further, never
  // widen past what the tradie included.
  const paramIndices = parseIndices(sp.s, allStructures.length)
  const effectiveIndices = resolveEffectiveIndices(
    {
      included: row.included_indices,
      confirmedStructure: row.confirmed_structure,
      paramIndices,
    },
    fullQuote,
  )

  // On the priced view, the headline total covers only the INCLUDED quotable
  // structures (partition.narrowed) — but we still LIST every detected
  // structure, marking excluded ones "not included" and inspection-routed ones
  // "on inspection", neither priced into the total. The picker view always
  // shows every measured building so the customer can pick.
  const partition = confirmed && fullQuote ? partitionRoofQuote(fullQuote, effectiveIndices) : null
  const quote: MultiRoofQuote | null = partition ? partition.narrowed : fullQuote
  // Per-structure cards: every structure (with its state) on the priced view;
  // every measured building on the picker view.
  const structureCards: Array<{ structure: RoofStructurePrice; excluded: boolean }> = confirmed
    ? (partition?.rows ?? []).map((r) => ({ structure: r.structure, excluded: r.state === 'excluded' }))
    : allStructures.map((s) => ({ structure: s, excluded: false }))
  const structures: RoofStructurePrice[] = structureCards.map((c) => c.structure)

  // One satellite photo per structure shown (excluded ones omitted): every
  // measured building on the picker view, the included structures on the priced
  // view. structureCards are in detection order, so position i → the 1-based
  // index i+1 into the full quote that the static-map `?b=` param targets. Fixes
  // the page showing only the first structure's photo. (spec
  // roofing-pdf-multi-structure-images R4)
  const satelliteImages = structureCards
    .map(({ structure: s, excluded }, i) => ({ index1Based: i + 1, label: s.label, excluded }))
    .filter((c) => !c.excluded)

  const isInspection = row.routing === 'inspection_required' || quote?.routing?.decision === 'inspection_required'
  const flagged = new Set(quote?.inspection_structures ?? [])

  // Price visibility. The confirm gate (confirmed) is intentional and stays.
  // The BUG was ALSO gating on !isInspection, which blanked every on-site-
  // flagged roof into a $0 quote. Instead, once confirmed:
  //   • firm — at least one included structure is quotable → headline = the
  //     quotable total (partition.narrowed.combined); inspection-routed
  //     structures are listed "priced on site", never summed into the headline.
  //   • indicative — NO included structure is quotable (a whole-job on-site
  //     quote) → headline = an INDICATIVE sum over ALL included structures,
  //     labelled "subject to on-site confirmation", so the customer never sees
  //     a blank/$0 quote. A genuinely unpriceable roof (asbestos / unknown
  //     material → $0 tiers) has no indicative numbers and falls back to the
  //     price-free inspection notice rather than a $0 quote.
  // All numbers come verbatim from the stored per-structure engine output.
  const includedStructures: RoofStructurePrice[] = partition
    ? partition.rows.filter((r) => r.included).map((r) => r.structure)
    : structures
  const hasFirmPrice = partition ? partition.rows.some((r) => r.state === 'priced') : false
  const indicativeTotals =
    confirmed && !hasFirmPrice ? indicativeCombinedTiers(includedStructures) : null
  const hasIndicativeNumbers =
    !!indicativeTotals && indicativeTotals.tiers.some((t) => t.inc_gst > 0)
  const indicative = confirmed && !hasFirmPrice && hasIndicativeNumbers
  const showPrices = confirmed && (hasFirmPrice || indicative)
  // Headline total: the quotable-only narrow on a firm quote; the indicative
  // all-structure sum on a whole-job on-site quote.
  const combinedForDisplay = indicative ? indicativeTotals : quote?.combined

  const mapBuildings: RoofMapBuilding[] = structureCards.map(({ structure: s, excluded }, i) => ({
    id: s.buildingId ?? `s-${i}`,
    polygon: s.metrics?.polygon_geojson ?? null,
    role: s.role,
    included: !excluded,
  }))
  const primary = structures.find((s) => s.role === 'primary') ?? structures[0]
  const primaryStats = primary
    ? {
        sloped_area_m2: primary.metrics.sloped_area_m2,
        hips: primary.metrics.hips,
        valleys: primary.metrics.valleys,
        storeys: primary.metrics.storeys,
      }
    : null
  const primaryMaterialLabel = primary ? MATERIAL_LABEL[primary.inputs.material] : null

  // Existing-solar detach & reinstate — a deterministic add-on persisted at
  // save time (lib/roofing/solar.ts). Read off the FULL (job-level) quote, not
  // the narrowed view. When it applies on a re-roof it's a distinct line added
  // to ALL three tier totals; the electrician disclaimer shows whenever solar
  // is present on a priced quote.
  const solar = fullQuote?.solar ?? null
  const solarApplies = showPrices && solar?.allowance?.applies === true
  const solarIncGst = solarApplies ? solar?.allowance?.inc_gst ?? 0 : 0
  const solarExGst = solarApplies ? solar?.allowance?.ex_gst ?? 0 : 0
  const showElectricianNote =
    showPrices && solar?.detection?.has_solar === true && !!solar?.allowance

  // ── Presentational mapping (reuses only the computed values above) ────

  // Letterhead identity — we now load the owning tradie's identity (loaded
  // above) so the letterhead carries their logo + Contact / Phone / Email; the
  // roofing quote falls back to a generic name when no tenant is joined.
  const placeLabel = [row.address, row.state].filter(Boolean).join(', ') || null

  // Hero headline: the "FULL REROOF, / DONE RIGHT." style from the confirmed
  // state, or the measurement framing before confirmation.
  const headline = confirmed
    ? { line1: 'Your roof,', line2: 'quoted.' }
    : { line1: 'Your roof,', line2: 'measured.' }
  const heroStatus = confirmed
    ? ({ label: 'Ready to book', tone: 'booked' } as const)
    : ({ label: 'Awaiting you', tone: 'await' } as const)
  const greeting = confirmed
    ? "Here are your options measured from the satellite. Pick what suits and reply to lock it in — a licensed roofer confirms the final price on site."
    : structures.length > 1
      ? "We found more than one building at this address. Reply to our text with YES for all of them, the building number for just one, or NO, and we'll send your full priced quote."
      : "Reply YES to our text and we'll send your full priced quote for this roof."

  // Summary stat grid — ROOF AREA / MATERIAL / PITCH / WARRANTY, from the
  // primary structure's measured metrics.
  const areaM2 = combinedForDisplay?.area_m2 ?? row.combined_area_m2 ?? primary?.metrics.sloped_area_m2
  const summaryStats: Stat[] = [
    {
      k: 'Roof area',
      v: areaM2 != null ? `${Math.round(areaM2)}` : '—',
      sub: areaM2 != null ? 'm² measured aerial' : 'measured aerial',
    },
    {
      k: 'Material',
      v: primaryMaterialLabel ? primaryMaterialLabel.split(' ')[0] : 'To confirm',
      sub: primaryMaterialLabel ?? 'confirmed on site',
    },
    {
      k: 'Roof form',
      v: primary ? formLabel(primary.metrics.form) : 'To confirm',
      sub: primary?.metrics.storeys != null ? `${primary.metrics.storeys}-storey` : 'from aerial',
    },
    {
      k: 'Structures',
      v: `${structures.length}`,
      sub: structures.length === 1 ? 'measured building' : 'measured buildings',
    },
  ]

  // Scope of works — the job, what's always included, timing & access.
  const scopeItems: ScopeItem[] = [
    {
      title: 'The job',
      body: confirmed
        ? 'Re-sheet or repair the roof to the option you choose — new sarking, battens, ridge capping and flashings as your tier includes.'
        : 'We measured this roof from satellite imagery. Confirm which building is yours and we send the full priced options.',
    },
    {
      title: 'Included on every option',
      list: [
        'Measured area, hips and valleys from aerial imagery',
        'Make good and flashings to suit the roof form',
        'Site cleaned and magnet-swept for nails',
        'A licensed roofer reviews every quote before booking',
      ],
    },
    {
      title: 'Timing & access',
      body: 'Final measure is confirmed on site before any work starts. Scaffold and skip arrive the day before; we keep it watertight each night.',
    },
  ]

  // Aerial measurement metrics overlay (mockup "Selected structure" panel).
  const measureMetrics: Metric[] = primaryStats
    ? [
        { k: 'Sloped area', v: primaryStats.sloped_area_m2 != null ? `${Math.round(primaryStats.sloped_area_m2)} m²` : '—' },
        { k: 'Hips', v: primaryStats.hips != null ? String(primaryStats.hips) : '?' },
        { k: 'Valleys', v: primaryStats.valleys != null ? String(primaryStats.valleys) : '?' },
        { k: 'Storeys', v: primaryStats.storeys != null ? String(primaryStats.storeys) : '?' },
      ]
    : []

  // Tier cards from the combined headline total. On the priced view each tier
  // links to the SMS reply flow (there is no per-tier Stripe checkout on this
  // roofing surface — booking is confirmed over text), so CTAs are label-only.
  // When the gate hides prices we still render the three tier names, price-free,
  // with a "reply to unlock" label — never a price the gate intends to hide.
  const displayTiers = combinedForDisplay?.tiers ?? []
  // Solar detach & reinstate is added to the Re-roof + Upgrade tiers ONLY (a
  // patch doesn't detach panels) — one code path, no double-count.
  const displayTiersWithSolar = applySolarToTiers(displayTiers, solar)
  const propertyChips = fullQuote?.property_context ? propertyContextChips(fullQuote.property_context) : []

  // Which tier keys this tenant's mode surfaces (matches the promoted quote
  // page / PDF / SMS): 'single' → the recommended 'better' only. Presence is
  // declared all-true because this surface always renders the full triple
  // shape (priced or as the price-free teaser) — the MODE is the filter.
  const visibleRoofTierKeys = resolveVisibleTiers({
    mode: roofTierMode,
    present: { good: true, better: true, best: true },
    selectedTier: 'better',
  })
  const visibleRoofTierSet = new Set<string>(visibleRoofTierKeys)
  // One visible option IS the offer — no badge (same rule as /q/[token]).
  const showRoofBadge = visibleRoofTierKeys.length > 1

  let quoteTiers: QuoteTier[]
  if (showPrices && displayTiers.length) {
    quoteTiers = displayTiersWithSolar
      // Mig 142 — hide tiers the tenant's mode hides (R3b).
      .filter((t) => visibleRoofTierSet.has(t.tier))
      // In indicative mode hide any $0 tier (e.g. asbestos has only an upgrade
      // price) so the customer never sees a "$0" option. Firm quotes show all.
      .filter((t) => !indicative || t.inc_gst > 0)
      .map((t, i) => ({
        name: TIER_NAME[t.tier],
        badge: showRoofBadge && t.tier === 'better' ? 'Most popular' : null,
        recommended: showRoofBadge && t.tier === 'better',
        blurb:
          t.tier === 'good'
            ? 'Fix what needs it. The lightest-touch option.'
            : t.tier === 'better'
              ? 'A full re-roof — what most homes get.'
              : 'Top spec: upgraded sheeting and the longest cover.',
        priceText: `$${money(t.inc_gst)}`,
        priceNote: `inc GST · $${money(t.ex_gst)} ex`,
        // CTA filled in by the shared tierCta remap below (needs
        // roofAcceptView, which isn't resolved yet at this point).
        ctaLabel: '',
        ctaHref: null,
        // Full per-tier line detail preserved below in the breakdown section.
        items: [
          `${TIER_NAME[t.tier]} across ${combinedForDisplay?.area_m2 ? `${Math.round(combinedForDisplay.area_m2)} m²` : 'the measured roof'}`,
          t.tier !== 'good' && solarIncGst > 0 ? 'Includes solar detach & reinstate' : 'Licensed & insured roofer',
        ].filter(Boolean) as QuoteTier['items'],
      }))
  } else {
    // Gate closed — price-free tier names only (mode-filtered like priced).
    quoteTiers = (['good', 'better', 'best'] as const)
      .filter((tier) => visibleRoofTierSet.has(tier))
      .map((tier) => ({
      name: TIER_NAME[tier],
      badge: showRoofBadge && tier === 'better' ? 'Most popular' : null,
      recommended: showRoofBadge && tier === 'better',
      blurb:
        tier === 'good'
          ? 'Fix what needs it. The lightest-touch option.'
          : tier === 'better'
            ? 'A full re-roof — what most homes get.'
            : 'Top spec: upgraded sheeting and the longest cover.',
      priceText: '—',
      priceNote: 'reply to unlock',
      // CTA filled in by the shared tierCta remap below.
      ctaLabel: '',
      ctaHref: null,
    }))
  }

  // Good to know — assumptions + the electrician disclaimer + solar note.
  const goodToKnow: string[] = [
    'Measurements are indicative from satellite imagery; the final measure is confirmed on site.',
    'A licensed roofer reviews every quote before any work is booked.',
    'No major structural repairs to the roof frame are assumed.',
    'Asbestos, if present, is confirmed and quoted before we start.',
  ]
  if (solarApplies) {
    goodToKnow.push(
      `Existing solar panels are detached and reinstated as part of a re-roof${
        solar?.detection?.array_count ? ` (${solar.detection.array_count} array${solar.detection.array_count === 1 ? '' : 's'})` : ''
      }.`,
    )
  }
  const goodToKnowNote = showElectricianNote ? solar?.allowance?.electrician_note : undefined

  // Footer credential rows — only data that exists.
  const footerRows: FooterRow[] = []
  if (placeLabel) footerRows.push({ k: 'Property', v: placeLabel })
  if (areaM2 != null) footerRows.push({ k: 'Measured', v: `${Math.round(areaM2)} m² sloped roof area from aerial imagery` })
  footerRows.push({
    k: 'Terms',
    v: showPrices
      ? 'Prices include GST and are indicative from a satellite measurement. A licensed roofer reviews every quote before any work is booked.'
      : 'Measurements are indicative from satellite imagery. Confirm your building over text and a licensed roofer reviews every quote before any work is booked.',
  })

  // Sticky deposit bar — the featured (recommended → better, else middle,
  // else first) VISIBLE priced tier. Absent while the gate hides prices; there
  // is no deposit checkout on this surface, so booking is a reply (no ctaHref).
  let sticky: StickyBar | null = null
  if (showPrices && quoteTiers.length) {
    const featured =
      quoteTiers.find((t) => t.recommended) ?? quoteTiers[Math.floor(quoteTiers.length / 2)] ?? quoteTiers[0]
    sticky = {
      tierLabel: `${featured.name}${indicative ? ' · indicative' : ''}`,
      priceText: featured.priceText,
      // CTA filled in by the shared tierCta remap below.
      ctaLabel: '',
      ctaHref: null,
    }
  }

  // Roofing site-visit payment + acceptance (mig 165) — SEPARATE best-effort
  // read so a deploy before the migration simply reads not-paid/not-accepted
  // rather than failing this live page. A roof price is ALWAYS confirmed on
  // site, so the only on-page money action is the refundable $99 site visit;
  // the accept block records acceptance then routes to /r/roof/<token>/
  // inspection (previously this surface had no on-page payment at all).
  let roofPaidAt: string | null = null
  let roofAcceptedAt: string | null = null
  let roofScheduledAt: string | null = null
  let roofScheduledWindow: string | null = null
  {
    const { data: pay } = await supabase
      .from('roofing_measurements')
      .select('paid_at, customer_accepted_at, scheduled_at, scheduled_window')
      .eq('public_token', token)
      .maybeSingle()
    if (pay) {
      roofPaidAt = (pay.paid_at as string | null) ?? null
      roofAcceptedAt = (pay.customer_accepted_at as string | null) ?? null
      roofScheduledAt = (pay.scheduled_at as string | null) ?? null
      roofScheduledWindow = (pay.scheduled_window as string | null) ?? null
    }
  }

  // Self-serve visit booking (mig 167): once the $99 is paid the customer picks
  // a half-day window right here. Load the tradie's open windows ONLY in that
  // state so an unpaid / already-booked view costs no extra query.
  let roofBookingOptions: Awaited<ReturnType<typeof loadTenantBookingOptions>> = []
  if (roofPaidAt && !roofScheduledAt && row.tenant_id) {
    roofBookingOptions = await loadTenantBookingOptions(supabase, {
      tenantId: row.tenant_id,
      table: 'roofing_measurements',
    })
  }
  const roofAcceptView = resolveAcceptView({
    token,
    tier: 'better',
    isPaid: !!roofPaidAt,
    pricesVisible: false, // roof price is always confirmed on site → $99 visit
    priceExpired: false,
    priceLabel: null,
    siteVisitFee: '$99',
    inspectionHref: `/r/roof/${token}/inspection`,
  })

  // One shared CTA for the tier cards + sticky bar (specs/quote-confirm-send.md
  // task 5): priced views anchor to the on-page AcceptBlock below (#accept);
  // while the confirm gate hides prices the CTA deep-links into the customer's
  // SMS thread instead of the old dead null-href pill. Applied here because
  // actionability follows roofAcceptView.mode (a paid visit leaves nothing to
  // book, so those views keep the label-only pill).
  const tierCta = roofQuoteCta({
    showPrices,
    indicative,
    acceptActionable: roofAcceptView.mode === 'deposit' || roofAcceptView.mode === 'inspection',
    smsNumber: identity?.twilio_sms_number ?? null,
  })
  quoteTiers = quoteTiers.map((t) => ({ ...t, ctaLabel: tierCta.label, ctaHref: tierCta.href }))
  if (sticky && !sticky.paid) {
    sticky = { ...sticky, ctaLabel: tierCta.label, ctaHref: tierCta.href }
  }

  return (
    <QuoteChrome trade={{ label: 'Roof', icon: tradeIcon('roof') }} sticky={sticky}>
      {/* Owner-only "Review & edit" pill → /m/[measure_token] (spec R3). */}
      <TradieJobBanner trade="roofing" publicToken={row.public_token} />
      <QuoteSheet label={`Quote ${row.public_token.slice(0, 8).toUpperCase()}`}>
        <Letterhead
          name={identity?.business_name ?? 'Your roofer'}
          credential={placeLabel ? `Measured roof · ${placeLabel}` : 'Measured from satellite imagery'}
          logoUrl={identity?.logo_url ?? null}
          contactName={contactDisplayName(identity)}
          phone={(identity?.owner_mobile ?? '').trim() || null}
          email={(identity?.owner_email ?? '').trim() || null}
        />

        <QuoteHero
          quoteId={`Roof · ${row.public_token.slice(0, 8).toUpperCase()}`}
          status={heroStatus}
          line1={headline.line1}
          line2={headline.line2}
          greeting={greeting}
          issued={placeLabel ?? undefined}
        />

        <StatGrid items={summaryStats} />

        {/* Pre-confirmation notice — explain why there's no price yet. */}
        {!confirmed && (
          <SheetSection eyebrow={structures.length > 1 ? 'Which building is yours?' : 'Is this your roof?'} eyebrowAccent>
            <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              {structures.length > 1
                ? "We found more than one building at this address. Reply to our text with YES for all of them, the building number for just one, or NO, and we'll send your full priced quote."
                : "Reply YES to our text and we'll send your full priced quote for this roof."}
            </p>
          </SheetSection>
        )}

        <Scope items={scopeItems} />

        {/* Roof measurement — the Geoscape outline (RoofMap) with its metrics
            overlay, the measurement metric grid, and one Google satellite photo
            per shown structure. */}
        <SheetSection
          eyebrow="Roof measurement"
          aside={areaM2 != null ? `${Math.round(areaM2)} m² from aerial` : 'from aerial'}
        >
          <div
            className="qm-duotone"
            style={{ marginTop: 14, position: 'relative', border: '1px solid var(--ink-line)', overflow: 'hidden' }}
          >
            <RoofMap
              polygon={null}
              form={primary?.metrics.form ?? 'unknown'}
              stats={primaryStats}
              buildings={mapBuildings}
              selectedId={mapBuildings[0]?.id ?? null}
            />
          </div>

          {measureMetrics.length ? <MetricGrid items={measureMetrics} /> : null}

          {satelliteImages.map((img) => (
            <figure
              key={img.index1Based}
              className="qm-duotone"
              style={{ margin: '10px 0 0', position: 'relative', border: '1px solid var(--ink-line)', overflow: 'hidden' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={structureStaticMapPath(row.public_token, img.index1Based)}
                alt={`Satellite view of ${img.label} at ${row.address ?? 'the property'}`}
                // Full 4:3 frame (the source is 640×480) — a short letterbox
                // crop hid most of the roof (user feedback 2026-07-11).
                style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }}
              />
              <figcaption
                style={{
                  ...MONO,
                  padding: '9px 12px',
                  fontSize: 8.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--text-dim)',
                  borderTop: '1px solid var(--ink-line)',
                }}
              >
                {satelliteImages.length > 1 ? `${img.label} · satellite view` : 'Google satellite view'}
              </figcaption>
            </figure>
          ))}

          <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
            Measured from aerial imagery. The final measure is confirmed on site before we start.
          </p>
        </SheetSection>

        {/* PropRadar property context — dwelling type, age, areas. */}
        {propertyChips.length ? (
          <SheetSection eyebrow="Property details" eyebrowAccent>
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {propertyChips.map(([label, value]) => (
                <span
                  key={label}
                  style={{
                    ...MONO,
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: 6,
                    border: '1px solid var(--ink-line)',
                    background: 'var(--ink-deep)',
                    padding: '6px 10px',
                    fontSize: 11.5,
                  }}
                >
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>{label}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-pri)' }}>{value}</span>
                </span>
              ))}
            </div>
          </SheetSection>
        ) : null}

        {/* On-site inspection notice. */}
        {isInspection && (
          <SheetSection>
            <div
              style={{
                borderLeft: '3px solid var(--warning-bright)',
                background: 'var(--ink-deep)',
                border: '1px solid var(--ink-line)',
                borderLeftWidth: 3,
                borderLeftColor: 'var(--warning-bright)',
                padding: '14px 16px',
              }}
            >
              <div style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--warning-bright)' }}>
                On-site inspection needed
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-sec)' }}>
                {quote?.routing?.reason ??
                  'This roof needs a quick inspection on site before we can give an accurate price.'}
              </p>
            </div>
          </SheetSection>
        )}

        {/* Indicative-estimate reassurance banner. */}
        {showPrices && indicative && (
          <SheetSection>
            <div
              style={{
                border: '1px solid var(--ink-line)',
                borderLeftWidth: 3,
                borderLeftColor: 'var(--warning-bright)',
                background: 'var(--ink-deep)',
                padding: '14px 16px',
              }}
            >
              <div style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--warning-bright)' }}>
                Indicative estimate
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-sec)' }}>
                Subject to on-site confirmation. These prices are estimated from your satellite measurement; your roofer confirms the
                final price at a quick on-site visit. Reply to our text and we&apos;ll book a time.
              </p>
            </div>
          </SheetSection>
        )}

        {/* Choose your option — combined tier headline (or price-free gate). */}
        <TierCards
          tiers={quoteTiers}
          heading={
            quoteTiers.length === 1
              ? showPrices
                ? 'Your roofing quote'
                : 'Your option'
              : showPrices
                ? 'Patch · Re-roof · Upgrade'
                : 'Your three options'
          }
          intro={
            showPrices
              ? indicative
                ? 'Indicative from your satellite measurement — your roofer confirms the final price on a quick on-site visit.'
                : `All prices include GST${solarIncGst > 0 ? ' and the solar detach & reinstate allowance' : ''}. Reply to lock in your option.`
              : quoteTiers.length === 1
                ? 'Reply YES to our text and we send your full priced quote for this roof.'
                : 'Reply YES to our text and we send your full priced options for this roof.'
          }
        />

        {/* ── Explicit "Accept & book $99 site visit" (Gap #1/#3/#4). The roof
            price is always confirmed on site, so the refundable $99 visit is
            the on-page action — no more "reply to SMS" dead end. ── */}
        <AcceptBlock token={token} view={roofAcceptView} alreadyAccepted={!!roofAcceptedAt} />

        {/* Self-serve visit booking — appears once the $99 site visit is paid.
            Pick a half-day window (or see the booked one). Mig 167. */}
        {roofPaidAt ? (
          <SheetSection eyebrow={roofScheduledAt ? 'Visit booked' : 'Pick your visit time'} eyebrowAccent>
            {roofScheduledAt ? (
              <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                Your site visit is booked for{' '}
                <strong style={{ color: 'var(--text-pri)' }}>
                  {formatVisitSlot(roofScheduledAt, roofScheduledWindow, tzForState(identity?.state ?? null))}
                </strong>
                . {identity?.business_name ?? 'Your roofer'} will text you the day before to confirm.
              </p>
            ) : (
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                  Deposit received — pick a time that suits and we&apos;ll lock in your site visit.
                </p>
                <SlotPicker
                  token={token}
                  options={roofBookingOptions}
                  endpoint={`/api/q/book/roof/${token}`}
                  labels={{ idle: 'Book this time →', submitting: 'Booking…', done: 'Booked ✓' }}
                />
              </div>
            )}
          </SheetSection>
        ) : null}

        {/* Combined solar add-on note under the tiers. */}
        {solarApplies && (
          <SheetSection>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>
                Incl. solar panel detach and reinstate
                {solar?.detection?.array_count
                  ? ` · ${solar.detection.array_count} array${solar.detection.array_count === 1 ? '' : 's'}`
                  : ''}
              </div>
              <div style={{ ...MONO, fontSize: 16, fontWeight: 800, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                + ${money(solarIncGst)} inc GST
              </div>
            </div>
          </SheetSection>
        )}

        {/* Per-structure breakdown — metrics always; prices only when confirmed.
            Full itemised detail lives here so no data is lost from the compact
            tier cards. */}
        <SheetSection
          eyebrow={showPrices ? 'Detailed breakdown' : 'Measured buildings'}
          aside={`${structures.length} structure${structures.length === 1 ? '' : 's'}`}
        >
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            {structureCards.map(({ structure: s, excluded }, i) => (
              <StructureBreakdown
                key={s.buildingId ?? i}
                structure={s}
                index={i}
                flagged={flagged.has(s.label)}
                showPrices={showPrices}
                indicative={indicative}
                excluded={excluded}
              />
            ))}
          </div>
        </SheetSection>

        {/* AI work-strategy layout map (spec quote-visual-parity R6e) — an
            INTERACTIVE map (drag-pan, zoom, rotate, compass reset) drawing the
            CACHED plan's zones as geographic layers. Selection-aware: only the
            structures INCLUDED in the job are framed, zoned, and counted —
            zone.structureIndex stays 1-based into the FULL quote. */}
        {confirmed && layoutPlan && fullQuote?.structures?.length
          ? (() => {
              const overlayStructures: LayoutOverlayStructure[] = fullQuote.structures.map((s) => ({
                polygon: s.metrics?.polygon_geojson ?? null,
                form: s.metrics?.form ?? 'unknown',
              }))
              const includedSet = new Set(effectiveIndices)
              const visibleZones =
                includedSet.size > 0
                  ? layoutPlan.zones.filter((z) => includedSet.has(z.structureIndex))
                  : layoutPlan.zones
              if (visibleZones.length === 0) return null
              if (!overlayStructures.some((s) => s.polygon)) return null
              const includedStructures = effectiveIndices
                .map((i) => fullQuote.structures[i - 1])
                .filter(Boolean)
              const materials = layoutMaterials(
                combinedLayoutMetrics(
                  includedStructures.length > 0 ? includedStructures : fullQuote.structures,
                ),
                layoutPlan.mode,
              )
              return (
                <SheetSection eyebrow="Roof layout map" eyebrowAccent>
                  <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                    {layoutPlan.header}
                  </p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
                    Drag to pan · scroll or ± to zoom · right-click drag to rotate · compass resets north
                  </p>
                  <div
                    style={{
                      marginTop: 14,
                      border: '1px solid var(--ink-line)',
                      overflow: 'hidden',
                    }}
                  >
                    <RoofLayoutMapFigure
                      zones={visibleZones}
                      structures={overlayStructures}
                      fitIndices={effectiveIndices}
                    />
                  </div>
                  <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                    {visibleZones.map((z, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span
                          style={{
                            marginTop: 2,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.12em',
                            color: ZONE_TEXT_HEX[z.color],
                          }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span
                          aria-hidden
                          style={{
                            marginTop: 3,
                            width: 13,
                            height: 13,
                            flexShrink: 0,
                            display: 'inline-block',
                            background: ZONE_COLOR_HEX[z.color],
                            border: '1px solid var(--ink-line)',
                          }}
                        />
                        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>{z.label}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Estimated materials — deterministic whole-job estimates
                      with each quantity's arithmetic and where it goes. */}
                  {materials.items.length > 0 ? (
                    <div style={{ marginTop: 18, borderTop: '1px solid var(--ink-line)', paddingTop: 14 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.16em',
                          color: 'var(--text-dim)',
                        }}
                      >
                        Estimated materials
                      </div>
                      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                        {materials.items.map((m) => (
                          <li
                            key={m.item}
                            style={{ padding: '10px 0', borderBottom: '1px solid color-mix(in srgb, var(--ink-line) 60%, transparent)' }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'baseline',
                                gap: 16,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 13.5,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              <span style={{ color: 'var(--text-pri)' }}>{m.item}</span>
                              <span style={{ whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-pri)' }}>
                                {m.qty.toLocaleString('en-AU')} {m.unit}
                              </span>
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                              <span style={{ color: 'var(--text-sec)' }}>How:</span> {m.basis}
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                              <span style={{ color: 'var(--text-sec)' }}>Where:</span> {m.use}
                            </p>
                          </li>
                        ))}
                      </ul>
                      {materials.note ? (
                        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                          {materials.note}
                        </p>
                      ) : null}
                      <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                        Quantities are estimated from the measured roof geometry — your roofer confirms
                        final counts on site.
                      </p>
                    </div>
                  ) : null}
                </SheetSection>
              )
            })()
          : null}

        {/* AI "after re-roof" preview — generated FROM the satellite aerial.
            Shown after the breakdown so a slow render can never hide the quote. */}
        {showPrices && (
          <section style={{ borderTop: '1px solid var(--ink-line)' }}>
            <figure style={{ margin: 0, position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--ink-line)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/roofing/q/${row.public_token}/after-image`}
                alt={`AI preview of the property with a new ${primaryMaterialLabel ?? ''} roof`}
                // Full 4:3 frame — the 300px letterbox crop made the AI
                // preview unreadably small (user feedback 2026-07-11).
                style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }}
              />
              <span
                aria-hidden="true"
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%', background: 'linear-gradient(180deg,transparent,color-mix(in srgb, var(--ink-deep) 90%, transparent))' }}
              />
              <figcaption style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px', textAlign: 'center' }}>
                <span style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--accent)' }}>Preview</span>
                <span style={{ ...MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-pri)' }}>
                  {' '}· your roof in {primaryMaterialLabel ?? 'a new roof'}
                </span>
                <div style={{ marginTop: 5, ...MONO, fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
                  AI generated from the satellite image
                </div>
              </figcaption>
            </figure>
          </section>
        )}

        <GoodToKnow items={goodToKnow} note={goodToKnowNote} />

        <CredentialFooter rows={footerRows} />
      </QuoteSheet>
    </QuoteChrome>
  )
}

function StructureBreakdown({
  structure,
  index,
  flagged,
  showPrices,
  indicative = false,
  excluded = false,
}: {
  structure: RoofStructurePrice
  index: number
  flagged: boolean
  showPrices: boolean
  /** Whole-job on-site quote: show this structure's tiers as an indicative
   *  range rather than the "priced on site" note. */
  indicative?: boolean
  excluded?: boolean
}) {
  const m = structure.metrics
  const p = structure.price
  const edges = edgeStat(m, structure.inputs.pitch)
  const inspection = p.routing?.decision === 'inspection_required' || flagged
  const buildingChips = buildingAttributeChips(m)

  const metrics: Metric[] = [
    { k: 'Sloped area', v: m.sloped_area_m2 != null ? `${Math.round(m.sloped_area_m2)} m²` : '—', sub: m.footprint_m2 ? `Footprint ${Math.round(m.footprint_m2)} m²` : undefined },
    { k: 'Roof form', v: formLabel(m.form), sub: m.storeys != null ? `${m.storeys}-storey` : undefined },
    { k: 'Hips · valleys', v: `${edges.hips ?? '?'} · ${edges.valleys ?? '?'}`, sub: `≈ ${Math.round(edges.hips_lm ?? 0)} · ${Math.round(edges.valleys_lm ?? 0)} m` },
    showPrices
      ? { k: 'Rate', v: p.effective_rate_per_m2 ? `$${money(p.effective_rate_per_m2)}/m²` : '—', sub: p.area_m2 ? `over ${Math.round(p.area_m2)} m²` : undefined }
      : { k: 'Area', v: p.area_m2 ? `${Math.round(p.area_m2)} m²` : '—', sub: 'sloped' },
  ]

  return (
    <article
      style={{
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-card)',
        padding: '16px 18px',
        opacity: excluded ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...MONO, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--accent)' }}>
            {structure.role === 'primary' ? 'Main dwelling' : 'Secondary structure'} · {String(index + 1).padStart(2, '0')}
            {excluded ? ' · Not included' : ''}
          </div>
          <h3 style={{ margin: '5px 0 0', fontFamily: 'var(--font-sans)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', fontSize: 16, color: 'var(--text-pri)' }}>
            {structure.label}
          </h3>
        </div>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{MATERIAL_LABEL[structure.inputs.material]}</span>
      </div>

      <MetricGrid items={metrics} valueSize={14} valueColor="var(--text-pri)" />

      {buildingChips.length ? (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {buildingChips.map(([label, value]) => (
            <span
              key={label}
              style={{
                ...MONO,
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 6,
                border: '1px solid var(--ink-line)',
                background: 'var(--ink-deep)',
                padding: '6px 10px',
                fontSize: 11.5,
              }}
            >
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>{label}</span>
              <span style={{ fontWeight: 700, color: 'var(--text-pri)' }}>{value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {excluded ? (
        <NoteBox tone="var(--text-dim)">Not included in this quote — leave it out, or ask us to add it.</NoteBox>
      ) : !showPrices ? (
        inspection ? (
          <NoteBox tone="var(--warning-bright)">This structure needs a quick look on site before we can price it.</NoteBox>
        ) : null
      ) : inspection && !indicative ? (
        <NoteBox tone="var(--warning-bright)">
          Priced on site — {p.routing?.reason ?? 'this structure needs a quick look before we can price it.'}
        </NoteBox>
      ) : (
        <>
          {indicative && (
            <NoteBox tone="var(--warning-bright)">Indicative estimate — subject to on-site confirmation.</NoteBox>
          )}
          {/* Each tier with its scope of works. In indicative mode hide $0
              tiers (asbestos has only an upgrade price) so no "$0" is shown. */}
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {p.tiers
              .filter((t) => !indicative || t.inc_gst > 0)
              .map((t) => (
                <div key={t.tier} style={{ border: '1px solid var(--ink-line)', background: 'var(--ink-deep)', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>
                      {TIER_NAME[t.tier]}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span style={{ ...MONO, fontSize: 18, fontWeight: 800, color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums' }}>${money(t.inc_gst)}</span>
                      <span style={{ ...MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}> inc · ${money(t.ex_gst)} ex</span>
                    </span>
                  </div>
                  <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-sec)' }}>{t.scope}</p>
                </div>
              ))}
          </div>

          {/* Loadings + call-out floor */}
          {(p.loadings_applied.length > 0 || p.call_out_minimum_applied) && (
            <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: 12.5, color: 'var(--text-sec)' }}>
              {p.loadings_applied.map((l) => (
                <p key={l.code} style={{ margin: 0 }}>+ {l.detail}</p>
              ))}
              {p.call_out_minimum_applied && <p style={{ margin: 0 }}>Minimum job charge applied (small structure).</p>}
            </div>
          )}
        </>
      )}
    </article>
  )
}

function NoteBox({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--ink-line)',
        borderLeftWidth: 3,
        borderLeftColor: tone,
        background: 'var(--ink-deep)',
        padding: '12px 14px',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--text-sec)',
      }}
    >
      {children}
    </div>
  )
}
