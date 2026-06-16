// ════════════════════════════════════════════════════════════════════
// Solar — the orchestrator (spec §2, §4, §7).
//
// runSolarEstimate wires the whole deterministic slice together:
//   geocode → coverage gate → roof facts (google) OR manual fallback →
//   sizing → production (per tier) → pricing (gross − STC = net) →
//   economics → deterministic-output guardrails → SolarEstimate.
//
// Covered and uncovered addresses feed the SAME pricing/economics engine;
// only the roof-data source differs. I/O (geocode, the Solar API call, and
// row persistence) is injected so the orchestrator is fully unit-testable
// with no DB / network. Config freshness is enforced up front — a stale
// config throws BEFORE any estimate is computed (spec §5).
//
// Guardrails (spec §7): each tier is checked against sane bounds
// (gross $/kW $700–$1,800, payback 2–12 yrs, AC/kW within ±35% of the CEC
// benchmark). Failures are collected into guardrail_flags — the estimate
// is still returned (tradie reviews it), never published silently.
// ════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto'
import { resolveSolarOpts } from '../roofing/solar-api'
import type { SolarEnrichmentOpts } from '../roofing/solar-api'
import { checkSolarCoverage } from './coverage'
import { fetchSolarBuildingInsights } from './insights'
import { addressValidationLocationUsable } from './address-validation'
import { normaliseSolarRoofFacts } from './roof'
import { buildManualRoofFacts } from './manual-fallback'
import { sizeSolarSystem } from './sizing'
import { estimateSolarProduction } from './production'
import { calculateSolarPrice } from './pricing'
import { calculateSolarEconomics } from './economics'
import { validateSolarConfig } from './config'
import { runSolarGuardrails, checkRoofAreaConsistency } from './guardrails'
import type {
  SolarAddressInput,
  SolarManualRoofInput,
  SolarPanelType,
  SolarPhase,
  SolarConfig,
  LatLng,
  SolarEstimate,
  SolarEstimateContext,
  SolarRoofFacts,
  SolarProductionResult,
  SolarConfidenceBand,
  SolarRoutingDecision,
  SolarAddressValidationInsight,
  SolarDataLayersSummary,
} from './types'

/**
 * PURE — stamp deterministic-output flags on a drafted estimate and
 * force tradie_review whenever any flag fired (spec §7: out-of-bounds →
 * flag for tradie, never publish silently). A clean estimate keeps its
 * incoming routing if already tradie-review, else is normalised to it
 * (solar never auto-sends — inherits roofing's high-ticket rule).
 */
export function finaliseSolarEstimate(estimate: SolarEstimate): SolarEstimate {
  const flags = runSolarGuardrails(estimate)
  const routing: SolarRoutingDecision =
    flags.length > 0
      ? {
          decision: 'tradie_review',
          reason: `${flags.length} estimate check${flags.length === 1 ? '' : 's'} need your review before this can be sent.`,
        }
      : {
          decision: 'tradie_review',
          reason:
            'Quote auto-calculated from roof data. Every solar quote requires tradie sign-off before customer send.',
        }
  return { ...estimate, guardrail_flags: flags, routing }
}

export type SolarEnrichmentOrchestratorOpts = {
  /** Resolve the address to a coordinate. */
  geocode: (input: SolarAddressInput) => Promise<LatLng>
  /**
   * Multi-roof building picker (approach A): when set, this coordinate
   * (a detected building's footprint centroid) is used as the point fed to
   * the coverage gate / Solar API / dataLayers INSTEAD of geocoding the
   * address. Lets the engine re-estimate a specific building on the
   * property without changing the stored address. Address validation and
   * geocode are skipped when present. Absent ⇒ today's behaviour (estimate
   * the building Google's findClosest snaps to at the geocoded address).
   */
  targetLocation?: LatLng | null
  /** Forwarded to the Solar API client (apiKey, fetchImpl, …). */
  solarOpts?: SolarEnrichmentOpts
  /** Install year for the STC deeming lookup. Defaults to current year. */
  installYear?: number
  /** DNSP/network for feed-in + export limit. */
  network: string
  /** Optional persistence hook — writes the solar_estimates row. */
  persist?: (estimate: SolarEstimate) => Promise<void>
  /** Optional satellite hero image URL resolver (real photo, no generative). */
  satelliteImageUrl?: (location: LatLng) => Promise<string | null>
  /**
   * Optional Google Address Validation enrichment. Best-effort: when it
   * returns a premise-level location it refines the coordinate; otherwise
   * geocode is used. The insight is persisted on context.address_validation.
   */
  addressValidation?: (
    input: SolarAddressInput,
  ) => Promise<SolarAddressValidationInsight | null>
  /**
   * Optional Google Solar dataLayers enrichment for the covered path. Best-
   * effort: a miss never blocks the quote. Persisted on estimate.data_layers.
   */
  dataLayers?: (location: LatLng) => Promise<SolarDataLayersSummary | null>
}

export async function runSolarEstimate(args: {
  input: SolarAddressInput
  manual?: SolarManualRoofInput
  panelType?: SolarPanelType
  /** Customer's optional quarterly electricity bill, AUD (premium quote
   *  §4.1) — persisted on context for utility-cost personalisation. */
  quarterlyBillAud?: number | null
  /** Property power-supply phase (entry form). 'three' enlarges the export
   *  ceiling 3× in sizing.ts. Undefined → 'unknown' (single-phase, no
   *  multiplier). Persisted on context.phase. */
  phase?: SolarPhase
  /** Customer's preferred system size, kW DC (entry form). When finite and
   *  positive, anchors the sizing tiers (still roof/export-capped). Persisted
   *  on context.requested_size_kw AND context.requested_system_kw (the DB
   *  column the dashboard reads back); non-finite/non-positive → null. */
  requestedSizeKw?: number | null
  config: SolarConfig
  opts?: SolarEnrichmentOrchestratorOpts
}): Promise<SolarEstimate> {
  const opts = args.opts
  if (!opts) throw new Error('runSolarEstimate requires orchestrator opts (geocode + network).')

  const installYear = opts.installYear ?? new Date().getFullYear()
  const panelType: SolarPanelType = args.panelType ?? 'standard_panels'

  // 0. Config freshness gate — throw before any computation (spec §5).
  const validation = validateSolarConfig(args.config, installYear)
  if (!validation.ok) {
    throw new Error(`solar config invalid: ${validation.code} — ${validation.detail}`)
  }
  const config = validation.config

  // Preferred size — only a finite positive value anchors the sizing tiers
  // and persists; anything else degrades to null (tiers anchor to the roof
  // max). The SAME value backs both context.requested_size_kw (the sizing
  // anchor sizing.ts reads) and context.requested_system_kw (the DB column
  // the dashboard / premium-quote / persist-helpers read back).
  const requestedSizeKw =
    typeof args.requestedSizeKw === 'number' &&
    Number.isFinite(args.requestedSizeKw) &&
    args.requestedSizeKw > 0
      ? args.requestedSizeKw
      : null

  const context: SolarEstimateContext = {
    postcode: args.input.postcode,
    state: args.input.state,
    install_year: installYear,
    network: opts.network,
    requested_system_kw: requestedSizeKw,
    // Optional bill — only a finite positive value is persisted; anything
    // else degrades to null (modelled utility costs downstream).
    quarterly_bill_aud:
      typeof args.quarterlyBillAud === 'number' &&
      Number.isFinite(args.quarterlyBillAud) &&
      args.quarterlyBillAud > 0
        ? args.quarterlyBillAud
        : null,
    // Power-supply phase — defaults to 'unknown' (single-phase, no export
    // multiplier in sizing). Drives the export ceiling for three-phase.
    phase: args.phase ?? 'unknown',
    // Preferred size — anchors the sizing tiers (still roof/export-capped).
    requested_size_kw: requestedSizeKw,
  }

  // 1. Address validation (best-effort) → geocode → coverage gate.
  //    Address Validation, when it returns a premise-level coordinate,
  //    is a more precise seed than a free-text geocode; otherwise we fall
  //    back to geocode. A missing/disabled API never blocks the path.
  // Multi-roof: an explicit building centroid short-circuits address
  // resolution entirely (we already know exactly which roof to estimate).
  let addressValidation: SolarAddressValidationInsight | null = null
  if (!opts.targetLocation && opts.addressValidation) {
    try {
      addressValidation = await opts.addressValidation(args.input)
    } catch {
      addressValidation = null
    }
  }
  context.address_validation = addressValidation

  const location: LatLng = opts.targetLocation
    ? opts.targetLocation
    : addressValidationLocationUsable(addressValidation)
      ? addressValidation.location
      : await opts.geocode(args.input)
  context.location = location

  const solarOpts = resolveSolarOpts(opts.solarOpts)
  const coverage = await checkSolarCoverage(location, solarOpts)

  // 2. Roof facts — google when covered, manual fallback otherwise.
  let roof: SolarRoofFacts
  let coverage_source: SolarEstimate['coverage_source']
  let satellite_image_url: string | null = null
  let data_layers: SolarDataLayersSummary | null = null

  if (coverage.covered) {
    // Re-fetch the raw body for the panel configs roof.ts needs. The
    // coverage gate already proved the call succeeds; fetch once more
    // through the solar-owned insights client and parse.
    const raw = await fetchRawInsights(location, opts.solarOpts)
    roof = normaliseSolarRoofFacts(raw, coverage, config)
    // Validation-only cross-check (premium quote §4.1): our summed segment
    // areas vs Google's wholeRoofStats. Logged, never blocks — see
    // checkRoofAreaConsistency for why this is not a guardrail flag.
    for (const note of checkRoofAreaConsistency(roof)) {
      console.warn('[solar/intake]', note)
    }
    coverage_source = 'google'
    satellite_image_url = opts.satelliteImageUrl
      ? await opts.satelliteImageUrl(location)
      : null
    // dataLayers is pure enrichment for a future shade/heatmap view — a
    // miss must never block the quote (spec §7).
    if (opts.dataLayers) {
      try {
        data_layers = await opts.dataLayers(location)
      } catch {
        data_layers = null
      }
    }
  } else if (args.manual) {
    roof = buildManualRoofFacts(args.manual, config, context.state)
    coverage_source = 'manual'
  } else {
    // Uncovered and no manual input — return an inspection-routed empty
    // estimate from a synthetic empty manual roof. The customer page will
    // collect the manual answers and re-run.
    roof = buildManualRoofFacts(
      { orientation: 'unknown', roof_size: 'small', storeys: 1 },
      config,
      context.state,
    )
    roof = { ...roof, max_panels_count: 0, panel_configs: [] }
    coverage_source = 'manual'
  }

  // 3. Sizing → production → pricing → economics.
  const sizing = sizeSolarSystem({ roof, panelType, config, context })
  const production: SolarProductionResult[] = sizing.tiers.map((tier) =>
    estimateSolarProduction({ tier, roof, config, context }),
  )

  // When sizing produces no tiers (inspection_required path), pricing and
  // economics cannot run — return empty but type-compatible structures.
  const price =
    sizing.tiers.length > 0
      ? calculateSolarPrice({ sizing, roof, context, config })
      : emptyPrice(sizing.routing)
  const economics =
    sizing.tiers.length > 0
      ? calculateSolarEconomics({ price, production, config, context })
      : emptyEconomics(config, context)

  // 4. Confidence band — worst of imagery + source.
  const confidence_band: SolarConfidenceBand =
    coverage_source === 'google' && roof.imagery_quality === 'HIGH' ? 'tight' : 'wide'

  // 5. Assemble draft estimate — guardrail_flags and final routing are
  //    stamped by finaliseSolarEstimate below (spec §7).
  const estimate: SolarEstimate = {
    token: generateSolarToken(),
    context,
    coverage_source,
    roof,
    sizing,
    production,
    price,
    economics,
    confidence_band,
    satellite_image_url,
    data_layers,
    routing: sizing.routing,
    guardrail_flags: [],
    config_version: config.version,
  }

  // 6. Stamp guardrail_flags and force tradie_review routing (spec §7).
  const finalEstimate = finaliseSolarEstimate(estimate)

  if (opts.persist) await opts.persist(finalEstimate)
  return finalEstimate
}

// ── helpers ──────────────────────────────────────────────────────────

/** Fetch the raw buildingInsights body so roof.ts can read panel configs.
 *  Delegates to the solar-owned insights client (insights.ts), which uses
 *  the same injected client/key as the coverage gate. */
async function fetchRawInsights(
  location: LatLng,
  solarOpts: SolarEnrichmentOpts | undefined,
): Promise<import('./roof').SolarRoofInsightWithRaw> {
  const res = await fetchSolarBuildingInsights(location, solarOpts)
  if (!res.ok) {
    throw new Error(`Solar API raw re-fetch failed (${res.code}): ${res.detail}`)
  }
  return res.insight
}

/** Public share token — base64url, 16 bytes (mirrors generateShareToken). */
export function generateSolarToken(): string {
  return randomBytes(16).toString('base64url')
}

/** PURE — empty price result for inspection-required path (no tiers). */
function emptyPrice(routing: SolarRoutingDecision): SolarEstimate['price'] {
  return {
    tiers: [],
    effective_rate_per_kw: 0,
    loadings_applied: [],
    routing,
    call_out_minimum_applied: false,
  }
}

/** PURE — empty economics result for inspection-required path (no tiers). */
function emptyEconomics(
  config: SolarConfig,
  context: SolarEstimateContext,
): SolarEstimate['economics'] {
  const feedIn =
    config.feed_in.by_network[context.network] ?? config.feed_in.default_aud_per_kwh
  return {
    tiers: [],
    assumptions: {
      self_consumption_pct: config.self_consumption_pct,
      retail_rate_aud_per_kwh: config.retail_rate_aud_per_kwh,
      feed_in_tariff_aud_per_kwh: feedIn,
      feed_in_network: context.network,
    },
  }
}

