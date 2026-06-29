// ════════════════════════════════════════════════════════════════════
// Roofing — pure pricing logic.
//
// $/m² × sloped area × loadings → tier prices + routing decision.
//
// The roofing trade does NOT use the strict-grounding estimator. The
// rationale (docs/strategy.md v10):
//   • Roofers price per sloped square metre operationally; line-item
//     granularity is unnecessary.
//   • Deterministic calc → no Opus on the money path → no grounding
//     validator needed → cheaper, faster, more predictable.
//   • Tier framing maps 1:1 onto the three operational scopes:
//     Good = patch / spot repair, Better = re-roof same material,
//     Best = upgrade to a better material.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  MultiRoofQuote,
  PitchBucket,
  RoofForm,
  RoofJobIntent,
  RoofMaterial,
  RoofMetrics,
  RoofStructurePrice,
  RoofStructureRole,
  RoofUserInputs,
  RoofingEdgeWorks,
  RoofingLineItem,
  RoofingPriceTier,
  RoofingQuotePrice,
  RoofingRateCard,
  RoofingRoutingDecision,
} from './types'

// ── Pitch corrections ───────────────────────────────────────────────
// Footprint × correction = sloped area. Per the standard residential
// pitch ranges in AU practice. unknown/very_steep cases route to
// inspection rather than guessing.
const PITCH_CORRECTION: Record<PitchBucket, number | null> = {
  shallow: 1.06, //   < 20°  (typical ~15°)
  standard: 1.10, // 20–25°  (the AU residential default ~22.5°)
  steep: 1.18, //   26–35°  (typical ~30°)
  very_steep: null, // route to inspection
  unknown: null,
}

/** PURE — sloped area in m² given footprint + customer pitch declaration. */
export function slopedAreaFromFootprint(
  footprint_m2: number,
  pitch: PitchBucket,
): number | null {
  if (!Number.isFinite(footprint_m2) || footprint_m2 <= 0) return null
  const c = PITCH_CORRECTION[pitch]
  if (c === null || c === undefined) return null
  return roundTo(footprint_m2 * c, 1)
}

/** PURE — true when this combination should never be auto-quoted. */
export function requiresInspection(args: {
  metrics: RoofMetrics
  inputs: RoofUserInputs
  outsideCoverage?: boolean
}): RoofingRoutingDecision | null {
  const { metrics, inputs, outsideCoverage } = args

  if (outsideCoverage === true) {
    return {
      decision: 'inspection_required',
      reason:
        'Address is outside Geoscape building coverage, so a tradie needs to attend to measure.',
    }
  }
  if (inputs.material === 'cement_sheet') {
    return {
      decision: 'inspection_required',
      reason:
        'Cement sheet roofs may contain asbestos, so a mandatory inspection on site is needed before any quote.',
    }
  }
  if (
    typeof inputs.building_year_built === 'number' &&
    inputs.building_year_built < 1990 &&
    inputs.intent === 'full_reroof'
  ) {
    return {
      decision: 'inspection_required',
      reason:
        'The building was built before 1990, so asbestos risk in the roof cavity must be assessed on site.',
    }
  }
  if (inputs.pitch === 'very_steep' || inputs.pitch === 'unknown') {
    return {
      decision: 'inspection_required',
      reason:
        'Roof pitch is steep or unknown, so fall protection cost cannot be priced without a measurement on site.',
    }
  }
  if (metrics.form === 'complex') {
    return {
      decision: 'inspection_required',
      reason:
        'Roof form is complex, so area and ridge counts need a measurement on site.',
    }
  }
  if (metrics.sloped_area_m2 === null) {
    return {
      decision: 'inspection_required',
      reason:
        'Sloped roof area could not be determined from available data, so a measurement on site is required.',
    }
  }
  if ((metrics.storeys ?? 1) >= 3) {
    return {
      decision: 'inspection_required',
      reason:
        'The building is 3 or more storeys, so scaffold or EWP access cannot be priced without an inspection on site.',
    }
  }
  return null
}

// ── Defaults ────────────────────────────────────────────────────────
// Per-tenant rate cards override these via pricing_book.overlays.
// Numbers chosen to match the per-m² norms in the AU re-roof market
// (Q1 2026): ~$80–$110 /m² for Colorbond, ~$95–$130 /m² for tile.

export const DEFAULT_ROOFING_RATE_CARD: RoofingRateCard = {
  reroof_rate_per_m2: {
    colorbond_corrugated: 90, // budget baseline metal; supply ≈ Trimdek, simplest pierce-fix
    colorbond_trimdek: 95,
    colorbond_spandek: 105, // supply +37% over Trimdek; sits between Trimdek and Klip-Lok
    colorbond_kliplok: 115,
    concrete_tile: 95,
    terracotta_tile: 130,
    cement_sheet: 0, // never auto-quoted
    unknown: 0,
  },
  multi_storey_loading_pct: 0.20,
  asbestos_loading_pct: 0.35,
  upgrade_material: 'colorbond_kliplok',
  gst_registered: true,
  // A half-day minimum mobilisation charge. Stops a tiny secondary
  // structure (e.g. a 12 m² shed → ~$228 patch) computing a number no
  // roofer would attend for. Well below any whole-house tier, so it
  // only binds on small structures.
  call_out_minimum_ex_gst: 550,
  // Edge-works rates — mirror the seeded assemblies in migration 080.
  ridge_hip_repoint_rate_per_lm: 12.0, // 'Repoint ridge and hip caps' (lm)
  valley_flashing_rate_per_lm: 45.0, // 'Valley flashing replacement' (lm)
  price_edge_works: true,
}

// ── Loadings ────────────────────────────────────────────────────────

type Loading = {
  code: 'multi_storey' | 'asbestos' | 'complexity'
  pct: number
  detail: string
}

/** PURE — which loadings stack on this job. */
export function applicableLoadings(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
  rateCard: RoofingRateCard,
): Loading[] {
  const out: Loading[] = []
  if ((metrics.storeys ?? 1) >= 2) {
    out.push({
      code: 'multi_storey',
      pct: rateCard.multi_storey_loading_pct,
      detail: `${(rateCard.multi_storey_loading_pct * 100).toFixed(0)}% multi-storey access loading`,
    })
  }
  // Asbestos loading only fires when the customer has confirmed asbestos
  // and the work was authorised past the inspection gate. (Inspection-
  // required quotes never reach this loading.)
  if (inputs.material === 'cement_sheet') {
    out.push({
      code: 'asbestos',
      pct: rateCard.asbestos_loading_pct,
      detail: `${(rateCard.asbestos_loading_pct * 100).toFixed(0)}% asbestos handling loading`,
    })
  }
  // Complexity loading — per-tenant override from the rate-card overlay
  // (the "always-applied buffer" lever borrowed from Jobber's research,
  // industry norm 0–25% to absorb on-the-job overhead that can't be
  // named in advance). Only applies when > 0; preserves the no-load
  // shape for tenants that don't set it.
  const cx = (rateCard as { complexity_loading_pct?: unknown }).complexity_loading_pct
  if (typeof cx === 'number' && Number.isFinite(cx) && cx > 0) {
    out.push({
      code: 'complexity',
      pct: cx,
      detail: `${(cx * 100).toFixed(0)}% complexity loading`,
    })
  }
  return out
}

// ── Edge works (hips + valleys) ──────────────────────────────────────
// Hips/valleys are stored as COUNTS. To price the seeded per-lm edge
// assemblies (repoint ridge & hip caps, replace valley flashing) we
// derive a linear-metre length per edge from the roof geometry, with a
// fixed-average fallback when geometry is too thin.

/** Representative pitch angle (degrees) for each bucket, for the geometry
 *  derivation. unknown/very_steep have none (those route to inspection). */
const REPRESENTATIVE_PITCH_DEGREES: Record<PitchBucket, number | null> = {
  shallow: 15,
  standard: 22.5,
  steep: 30,
  very_steep: null,
  unknown: null,
}

/** Fixed-average per-edge length when geometry can't derive one. */
const DEFAULT_EDGE_LENGTH_M = 6.0
const MIN_EDGE_LENGTH_M = 3
const MAX_EDGE_LENGTH_M = 20

/** Repair intents — edge works are charged on every tier (no full re-roof
 *  rate to bundle them into). full_reroof / gutter_replace / unknown only
 *  charge edge works on the patch-scoped `good` tier. */
const REPAIR_INTENTS: ReadonlySet<RoofJobIntent> = new Set<RoofJobIntent>([
  'patch_repair',
  'flashing_repair',
  'ridge_cap',
  'leak_trace',
])

function clampRange(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** PURE — usable pitch angle in degrees, preferring measured pitch. */
function resolvePitchDegrees(metrics: RoofMetrics, pitch: PitchBucket): number | null {
  const pd = metrics.pitch_degrees
  if (typeof pd === 'number' && Number.isFinite(pd) && pd > 0 && pd < 80) return pd
  return REPRESENTATIVE_PITCH_DEGREES[pitch]
}

/**
 * PURE — per-edge (hip/valley) length in metres. Derived from the roof
 * geometry — a hip/valley runs from an eave corner to the ridge, so its
 * plan run ≈ half the characteristic plan dimension (√footprint / 2),
 * lifted to true length by the pitch factor 1/cos(θ) and clamped to a
 * sane range. Falls back to a fixed average when footprint or pitch are
 * unusable.
 */
export function perEdgeLength(
  metrics: RoofMetrics,
  pitch: PitchBucket,
): { lengthM: number; source: 'geometry' | 'fallback' } {
  const fp = metrics.footprint_m2
  const deg = resolvePitchDegrees(metrics, pitch)
  if (Number.isFinite(fp) && fp > 0 && deg !== null && deg !== undefined) {
    const s = Math.sqrt(fp)
    const pitchFactor = 1 / Math.cos((deg * Math.PI) / 180)
    const raw = (s / 2) * pitchFactor
    return {
      lengthM: roundTo(clampRange(raw, MIN_EDGE_LENGTH_M, MAX_EDGE_LENGTH_M), 1),
      source: 'geometry',
    }
  }
  return { lengthM: DEFAULT_EDGE_LENGTH_M, source: 'fallback' }
}

/**
 * PURE — derive the hip/valley edge-works summary (counts + linear
 * metres). Null counts (unknown/complex form) stay null — we never
 * fabricate a count. A count of 0 derives 0 lm (no edge line).
 */
export function deriveEdgeWorks(metrics: RoofMetrics, pitch: PitchBucket): RoofingEdgeWorks {
  const { lengthM, source } = perEdgeLength(metrics, pitch)
  const toLm = (count: number | null | undefined): number | null => {
    if (count === null || count === undefined || !Number.isFinite(count)) return null
    if (count <= 0) return 0
    return roundTo(count * lengthM, 1)
  }
  return {
    hips_count: metrics.hips ?? null,
    valleys_count: metrics.valleys ?? null,
    hips_lm: toLm(metrics.hips),
    valleys_lm: toLm(metrics.valleys),
    per_edge_length_m: lengthM,
    length_source: source,
  }
}

/** PURE — are edge works charged on this tier (repair scope) vs already
 *  bundled in the full re-roof per-m² rate (shown at $0)? */
function edgeChargedForTier(intent: RoofJobIntent, tier: 'good' | 'better' | 'best'): boolean {
  if (tier === 'good') return true // good is always patch / repair scope
  return REPAIR_INTENTS.has(intent)
}

// ── Tier rates ──────────────────────────────────────────────────────
// Tier-to-multiplier mapping. Good = patch (20% of full re-roof typical
// scope), Better = re-roof same material (full rate), Best = re-roof in
// the per-material upgrade target (DEFAULT_UPGRADE_PATH), rate-floored to
// never sit below the Better tier (the monotonic backstop).
//
// The 'good' tier intentionally is NOT a discount on the full re-roof
// rate — it's a different scope (patch / leak repair only). Tradies
// should still review before send.

const GOOD_TIER_SCOPE_FRACTION = 0.20

// ── Upgrade ladder ──────────────────────────────────────────────────
// Per-material upgrade target for the Best tier. Upgrades stay within the
// same material family; the top of each family maps to ITSELF (it has no
// dearer in-card target), and the monotonic backstop in
// calculateRoofingPrice keeps Best ≥ Better in that case. Sourcing
// genuinely dearer premium rates (slate, premium terracotta / colorbond)
// for the top-of-ladder materials is a future enhancement — see
// specs/roofing-tier-ordering-fix.md.
const DEFAULT_UPGRADE_PATH: Record<RoofMaterial, RoofMaterial> = {
  colorbond_corrugated: 'colorbond_kliplok',
  colorbond_trimdek: 'colorbond_kliplok',
  colorbond_spandek: 'colorbond_kliplok',
  colorbond_kliplok: 'colorbond_kliplok', // top of the metal family
  concrete_tile: 'terracotta_tile',
  terracotta_tile: 'terracotta_tile', // top of the tile family
  cement_sheet: 'colorbond_kliplok', // asbestos can't be patched/re-roofed in-kind (good+better stay $0), but Upgrade prices a Colorbond strip-and-replace — an indicative figure; still always inspection-routed
  unknown: 'unknown', // genuinely unpriceable → routes to inspection, never priced
}

/**
 * PURE — resolve the Best-tier upgrade material for an existing material.
 * Consults the per-material ladder, falling back to the rate card's
 * `upgrade_material` field if a material has no ladder entry (the field
 * is retained for backward-compat / tenant overlay).
 */
function upgradeMaterialFor(
  material: RoofMaterial,
  rateCard: RoofingRateCard,
): RoofMaterial {
  return DEFAULT_UPGRADE_PATH[material] ?? rateCard.upgrade_material
}

/**
 * PURE — invariant tripwire for the reported bug: the Upgrade (best) tier
 * must never price below the Re-roof (better) tier. The upgrade-rate
 * ladder + backstop guarantee this by construction, so a violation means
 * a regression upstream — we throw rather than ship an out-of-order quote
 * (matching this module's programmer-error style).
 *
 * We deliberately do NOT assert good ≤ better here: the edge-works feature
 * legitimately charges ridge/valley works on the patch-scoped good tier,
 * which on a very small roof can lift good above the tiny better tier — a
 * benign state that must not crash pricing.
 */
function assertTierMonotonic(
  tiers: readonly RoofingPriceTier[],
  where: string,
): void {
  const better = tiers.find((t) => t.tier === 'better')
  const best = tiers.find((t) => t.tier === 'best')
  if (better && best && best.ex_gst < better.ex_gst) {
    throw new Error(
      `${where}: tier price inversion — better ($${better.ex_gst}) > best ($${best.ex_gst})`,
    )
  }
}

function tierLabel(
  intent: RoofJobIntent,
  tier: 'good' | 'better' | 'best',
  upgradeIsSameMaterial = false,
): string {
  if (intent === 'leak_trace') {
    if (tier === 'good') return 'Leak trace + minor repair'
    if (tier === 'better') return 'Leak trace + flashing rework'
    return 'Leak trace + full section repair'
  }
  if (intent === 'patch_repair' || intent === 'flashing_repair' || intent === 'ridge_cap') {
    if (tier === 'good') return 'Targeted patch / repair'
    if (tier === 'better') return 'Broader repair + repoint'
    return 'Full section repair'
  }
  if (intent === 'gutter_replace') {
    if (tier === 'good') return 'Gutter replace, Quad profile'
    if (tier === 'better') return 'Gutter + downpipe replace'
    return 'Gutter + downpipe + flashings'
  }
  if (tier === 'good') return 'Patch / spot repair'
  if (tier === 'better') return 'Full re-roof, same material'
  return upgradeIsSameMaterial
    ? 'Full re-roof, premium grade'
    : 'Full re-roof, upgrade material'
}

function tierScopeLine(
  intent: RoofJobIntent,
  tier: 'good' | 'better' | 'best',
  material: RoofMaterial,
  upgradeMaterial: RoofMaterial,
  area_m2: number,
): string {
  const materialWords: Record<RoofMaterial, string> = {
    colorbond_corrugated: 'Colorbond Corrugated',
    colorbond_trimdek: 'Colorbond Trimdek',
    colorbond_spandek: 'Colorbond Spandek',
    colorbond_kliplok: 'Colorbond Klip-Lok 700',
    concrete_tile: 'concrete tile',
    terracotta_tile: 'terracotta tile',
    cement_sheet: 'cement sheet',
    unknown: 'the existing material',
  }
  const m = materialWords[material]
  const u = materialWords[upgradeMaterial]
  if (intent === 'full_reroof') {
    if (tier === 'good') {
      return `Spot patches and ridge cap rebed on the existing ${m} roof (no full replacement).`
    }
    if (tier === 'better') {
      return `Full re-roof of approximately ${area_m2.toFixed(0)} m² using ${m}, including ridge caps and flashings.`
    }
    if (upgradeMaterial === material) {
      return `Full re-roof of approximately ${area_m2.toFixed(0)} m² in premium-grade ${m}, including ridge caps and flashings. A bespoke material upgrade can be priced on inspection.`
    }
    return `Full re-roof of approximately ${area_m2.toFixed(0)} m² using ${u} as a material upgrade, including ridge caps and flashings.`
  }
  if (intent === 'leak_trace') {
    if (tier === 'good') return 'Locate the leak source and perform a minor fix (replace one tile / reseal one flashing).'
    if (tier === 'better') return 'Leak trace plus full flashing rework at the suspect penetration.'
    return 'Leak trace plus targeted section repair (up to ~5 m² of roof material replaced).'
  }
  return `Roofing works applied across approximately ${area_m2.toFixed(0)} m² of the existing roof.`
}

/**
 * PURE — compute the three-tier price + routing for a roofing job.
 * Returns RoofingQuotePrice. Throws only on programmer error (negative
 * area, missing pitch correction); operational failures (inspection
 * routing) surface inside the result's `routing` field.
 */
export function calculateRoofingPrice(args: {
  metrics: RoofMetrics
  inputs: RoofUserInputs
  rateCard?: RoofingRateCard
  outsideCoverage?: boolean
}): RoofingQuotePrice {
  const rateCard = args.rateCard ?? DEFAULT_ROOFING_RATE_CARD
  const { metrics, inputs } = args

  const routing =
    requiresInspection({
      metrics,
      inputs,
      outsideCoverage: args.outsideCoverage,
    }) ??
    ({
      decision: 'tradie_review',
      reason:
        'Quote auto-calculated from Geoscape measurement. Every roofing quote requires tradie sign-off before customer send.',
    } as RoofingRoutingDecision)

  // Sloped area is the canonical pricing input. When inspection routing
  // already fired we still emit a "would have been" indicative number
  // for the tradie's situational awareness, using the footprint and a
  // gentle 1.10 correction. Customers never see this if inspection
  // routing applied — the UI swaps to the inspection CTA.
  const area_m2 =
    metrics.sloped_area_m2 ??
    (metrics.footprint_m2 > 0 ? roundTo(metrics.footprint_m2 * 1.10, 1) : 0)

  const baseRate = rateCard.reroof_rate_per_m2[inputs.material] ?? 0
  // Best tier re-roofs in the per-material upgrade target, with the rate
  // floored to the existing material's rate so "Upgrade" never prices
  // under "Re-roof" when the existing material is already premium (e.g.
  // terracotta $130 vs the colorbond upgrade $115). See
  // specs/roofing-tier-ordering-fix.md.
  const upgradeMaterial = upgradeMaterialFor(inputs.material, rateCard)
  const upgradeIsSameMaterial = upgradeMaterial === inputs.material
  const upgradeRate = Math.max(
    rateCard.reroof_rate_per_m2[upgradeMaterial] ?? 0,
    baseRate,
  )

  const loadings = applicableLoadings(metrics, inputs, rateCard)
  const loadingMultiplier = loadings.reduce((acc, l) => acc * (1 + l.pct), 1)

  const betterRaw = area_m2 * baseRate * loadingMultiplier
  const bestRaw = area_m2 * upgradeRate * loadingMultiplier
  const goodRaw = betterRaw * GOOD_TIER_SCOPE_FRACTION

  // Per-structure call-out floor — raise any positive tier to at least
  // the minimum job charge. Zero-rate tiers (unknown / cement_sheet,
  // which route to inspection anyway) are left at 0 rather than fabricating
  // a number. See call_out_minimum_ex_gst on the rate card.
  const floor = rateCard.call_out_minimum_ex_gst ?? 0
  const applyFloor = (n: number) => (floor > 0 && n > 0 ? Math.max(n, floor) : n)
  const goodEx = applyFloor(goodRaw)
  const betterEx = applyFloor(betterRaw)
  // Monotonic backstop (belt-and-suspenders with the upgrade-rate floor):
  // Best is never below Better after the call-out floor is applied.
  const bestEx = Math.max(applyFloor(bestRaw), betterEx)
  const callOutMinimumApplied =
    floor > 0 &&
    ((goodRaw > 0 && goodRaw < floor) ||
      (betterRaw > 0 && betterRaw < floor) ||
      (bestRaw > 0 && bestRaw < floor))

  const gstFactor = rateCard.gst_registered ? 1.10 : 1.0
  const toIncGst = (n: number) => roundTo(n * gstFactor, 2)

  const effectiveRate = baseRate * loadingMultiplier

  // Edge works (hip/ridge capping + valley flashing). Derived once; the
  // per-tier builder decides whether they are charged (repair scope) or
  // shown at $0 because the full re-roof per-m² rate already bundles them.
  const edgeEnabled = rateCard.price_edge_works !== false
  const edge = deriveEdgeWorks(metrics, inputs.pitch)
  const hipRate = rateCard.ridge_hip_repoint_rate_per_lm ?? 0
  const valleyRate = rateCard.valley_flashing_rate_per_lm ?? 0

  const buildTier = (tier: 'good' | 'better' | 'best', baseEx: number): RoofingPriceTier => {
    const scope = tierScopeLine(
      inputs.intent,
      tier,
      inputs.material,
      upgradeMaterial,
      area_m2,
    )
    const sqmEx = roundTo(baseEx, 2)
    const line_items: RoofingLineItem[] = [
      {
        unit: 'sqm',
        quantity: roundTo(area_m2, 1),
        description: scope,
        unit_price_ex_gst: roundTo(effectiveRate, 2),
        total_ex_gst: sqmEx,
        source: 'labour',
      },
    ]

    // Only itemise edge works when the tier has a priceable base (sqmEx > 0).
    // A $0 base rate (cement_sheet / unknown material → inspection) must stay
    // at 0 rather than fabricating a partial number from edge works alone.
    if (edgeEnabled && sqmEx > 0) {
      const charged = edgeChargedForTier(inputs.intent, tier)
      const pushEdge = (
        lm: number | null,
        rate: number,
        chargedDesc: string,
        includedDesc: string,
      ) => {
        if (lm === null || lm <= 0) return
        const total = charged ? roundTo(lm * rate, 2) : 0
        line_items.push({
          unit: 'lm',
          quantity: lm,
          description: charged ? chargedDesc : includedDesc,
          unit_price_ex_gst: charged ? roundTo(rate, 2) : 0,
          total_ex_gst: total,
          source: 'material',
        })
      }
      pushEdge(
        edge.hips_lm,
        hipRate,
        'Repoint ridge and hip caps.',
        'Ridge and hip caps (included in the re-roof scope).',
      )
      pushEdge(
        edge.valleys_lm,
        valleyRate,
        'Valley flashing replacement.',
        'Valley flashing (included in the re-roof scope).',
      )
    }

    // Tier total is the sum of its line items — keeps the invariant
    // sum(line_items) === ex_gst exact by construction.
    const tierEx = roundTo(
      line_items.reduce((acc, li) => acc + li.total_ex_gst, 0),
      2,
    )
    return {
      tier,
      label: tierLabel(inputs.intent, tier, upgradeIsSameMaterial),
      ex_gst: tierEx,
      inc_gst: toIncGst(tierEx),
      scope,
      line_items,
    }
  }

  const tiers: [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier] = [
    buildTier('good', goodEx),
    buildTier('better', betterEx),
    buildTier('best', bestEx),
  ]
  assertTierMonotonic(tiers, 'calculateRoofingPrice')

  return {
    area_m2,
    effective_rate_per_m2: roundTo(effectiveRate, 2),
    tiers,
    loadings_applied: loadings,
    routing,
    call_out_minimum_applied: callOutMinimumApplied,
    edge_works: edgeEnabled ? edge : undefined,
  }
}

// ── Multi-structure pricing ──────────────────────────────────────────

/** One structure handed to the multi-roof pricer (pre-pricing). */
export type RoofStructureInput = {
  buildingId: string | null
  role: RoofStructureRole
  /** Optional explicit label; auto-derived from role + index when absent. */
  label?: string
  metrics: RoofMetrics
  inputs: RoofUserInputs
  outsideCoverage?: boolean
}

/** PURE — default per-structure label from its role + secondary index. */
function defaultStructureLabel(role: RoofStructureRole, secondaryIndex: number): string {
  if (role === 'primary') return 'Main dwelling'
  return `Secondary structure ${secondaryIndex}`
}

/**
 * PURE — a structure's comparable "roof size" in m² for ranking. The roof
 * surface (sloped) area is the truest measure of how big a roof is; we fall
 * back to the ground footprint when the pitch-corrected sloped area is not
 * available, and to 0 when neither is usable (such a structure ranks last).
 */
export function roofStructureSizeM2(metrics: RoofMetrics): number {
  const sloped = metrics?.sloped_area_m2
  if (typeof sloped === 'number' && Number.isFinite(sloped) && sloped > 0) return sloped
  const footprint = metrics?.footprint_m2
  if (typeof footprint === 'number' && Number.isFinite(footprint) && footprint > 0) return footprint
  return 0
}

/**
 * PURE — indices of `structures` ordered largest roof first. Stable on ties
 * (equal sizes keep their original input order), and does not mutate the
 * input. The caller treats index 0 as the primary dwelling, so this is the
 * single source of the "Main dwelling is always the largest roof" invariant.
 */
export function roofSizeOrder(structures: readonly RoofStructureInput[]): number[] {
  return structures
    .map((s, i) => ({ size: roofStructureSizeM2(s.metrics), i }))
    .sort((a, b) => (b.size - a.size) || (a.i - b.i))
    .map((x) => x.i)
}

/**
 * PURE — order structures largest roof first and re-assign roles so the
 * biggest roof is ALWAYS the primary ("Main dwelling") and the rest are
 * secondary in descending roof size. Stable on ties; does not mutate input.
 */
export function orderStructuresByRoofSize(structures: RoofStructureInput[]): RoofStructureInput[] {
  return roofSizeOrder(structures).map((idx, rank) => ({
    ...structures[idx],
    role: rank === 0 ? 'primary' : 'secondary',
  }))
}

/**
 * PURE — price N structures and aggregate into one MultiRoofQuote.
 *
 * Each structure is priced INDEPENDENTLY with its own material, area and
 * loadings via calculateRoofingPrice — areas are never summed onto a
 * single material rate (a tile house + Colorbond shed would mis-price).
 * The combined tiers sum the per-structure tier amounts (GST is linear,
 * so summing inc-GST per structure is exact) over the QUOTABLE structures
 * only. The whole job routes to inspection ONLY when the PRIMARY dwelling
 * needs it, or when nothing is quotable — otherwise we quote what we can
 * and `inspection_structures` flags the rest. Each structure keeps its own
 * line-level routing flag.
 */
export function priceMultiRoof(args: {
  structures: RoofStructureInput[]
  rateCard?: RoofingRateCard
}): MultiRoofQuote {
  const rateCard = args.rateCard ?? DEFAULT_ROOFING_RATE_CARD

  let secondaryCounter = 0
  const structures: RoofStructurePrice[] = args.structures.map((s) => {
    const label =
      s.label ??
      defaultStructureLabel(
        s.role,
        s.role === 'secondary' ? ++secondaryCounter : 0,
      )
    const price = calculateRoofingPrice({
      metrics: s.metrics,
      inputs: s.inputs,
      rateCard,
      outsideCoverage: s.outsideCoverage,
    })
    return {
      buildingId: s.buildingId,
      role: s.role,
      label,
      metrics: s.metrics,
      inputs: s.inputs,
      price,
    }
  })

  // Split quotable vs inspection-needed. We price the quotable structures
  // and FLAG the rest — a small odd outbuilding shouldn't block a quote
  // for the main roof.
  const isInspection = (st: RoofStructurePrice) =>
    st.price.routing.decision === 'inspection_required'
  const quotable = structures.filter((st) => !isInspection(st))
  const inspection_structures = structures.filter(isInspection).map((st) => st.label)

  // Combined per-tier totals — over the QUOTABLE structures only.
  const combinedTiers = ([0, 1, 2] as const).map((i): RoofingPriceTier => {
    const tierName = (['good', 'better', 'best'] as const)[i]
    const exSum = quotable.reduce((acc, st) => acc + st.price.tiers[i].ex_gst, 0)
    const incSum = quotable.reduce((acc, st) => acc + st.price.tiers[i].inc_gst, 0)
    const labelWord = tierName === 'good' ? 'Patch / repair' : tierName === 'better' ? 'Re-roof' : 'Upgrade'
    return {
      tier: tierName,
      label: `${labelWord}, all structures`,
      ex_gst: roundTo(exSum, 2),
      inc_gst: roundTo(incSum, 2),
      scope: `${labelWord} priced across ${quotable.length} structure${quotable.length === 1 ? '' : 's'}.`,
    }
  }) as [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier]
  assertTierMonotonic(combinedTiers, 'priceMultiRoof')

  const combinedArea = roundTo(
    quotable.reduce((acc, st) => acc + st.price.area_m2, 0),
    1,
  )

  // Whole job routes to inspection ONLY when the PRIMARY dwelling needs
  // it, or when nothing is quotable. Otherwise we quote the quotable
  // structures and flag the inspection-needed ones separately.
  const primary = structures.find((st) => st.role === 'primary') ?? structures[0]
  const primaryNeedsInspection = primary ? isInspection(primary) : false

  let routing: RoofingRoutingDecision
  if (primaryNeedsInspection && primary) {
    routing = { decision: 'inspection_required', reason: primary.price.routing.reason }
  } else if (quotable.length === 0) {
    routing = {
      decision: 'inspection_required',
      reason:
        `${inspection_structures.join(', ')} require${inspection_structures.length === 1 ? 's' : ''} an on-site inspection before we can quote.`,
    }
  } else {
    routing = {
      decision: 'tradie_review',
      reason:
        'Quotable structures auto-calculated from measurement. Every roofing quote requires tradie sign-off before customer send.',
    }
  }

  return {
    structures,
    combined: { area_m2: combinedArea, tiers: combinedTiers },
    routing,
    inspection_structures,
  }
}

/** PURE — round to N decimal places, banker-rounding-free, predictable. */
function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

// Re-export the small helpers for tests + callers that want them direct.
export const __test_only__ = {
  roundTo,
  GOOD_TIER_SCOPE_FRACTION,
  PITCH_CORRECTION,
  assertTierMonotonic,
  upgradeMaterialFor,
  DEFAULT_UPGRADE_PATH,
}

/** Map a RoofForm value to a human-readable label for UI. */
export function formLabel(form: RoofForm): string {
  switch (form) {
    case 'gable':       return 'Gable'
    case 'hip':         return 'Hip'
    case 'skillion':    return 'Skillion (mono-pitch)'
    case 'gable_hip':   return 'Gable + hip combination'
    case 'complex':     return 'Complex / irregular'
    case 'unknown':     return 'Unknown, needs inspection'
  }
}
