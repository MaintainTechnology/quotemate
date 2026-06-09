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
import { normaliseSolarRoofFacts } from './roof'
import { buildManualRoofFacts } from './manual-fallback'
import { sizeSolarSystem } from './sizing'
import { estimateSolarProduction } from './production'
import { calculateSolarPrice } from './pricing'
import { calculateSolarEconomics } from './economics'
import { validateSolarConfig } from './config'
import { runSolarGuardrails } from './guardrails'
import type {
  SolarAddressInput,
  SolarManualRoofInput,
  SolarPanelType,
  SolarConfig,
  LatLng,
  SolarEstimate,
  SolarEstimateContext,
  SolarRoofFacts,
  SolarProductionResult,
  SolarConfidenceBand,
  SolarRoutingDecision,
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

/** Deterministic-output guardrail bounds (spec §7). */
const GROSS_PER_KW_MIN = 700
const GROSS_PER_KW_MAX = 1800
const PAYBACK_YEARS_MIN = 2
const PAYBACK_YEARS_MAX = 12

export type SolarEnrichmentOrchestratorOpts = {
  /** Resolve the address to a coordinate. */
  geocode: (input: SolarAddressInput) => Promise<LatLng>
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
}

export async function runSolarEstimate(args: {
  input: SolarAddressInput
  manual?: SolarManualRoofInput
  panelType?: SolarPanelType
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

  const context: SolarEstimateContext = {
    postcode: args.input.postcode,
    state: args.input.state,
    install_year: installYear,
    network: opts.network,
  }

  // 1. Geocode + coverage gate.
  const location = await opts.geocode(args.input)
  const solarOpts = resolveSolarOpts(opts.solarOpts)
  const coverage = await checkSolarCoverage(location, solarOpts)

  // 2. Roof facts — google when covered, manual fallback otherwise.
  let roof: SolarRoofFacts
  let coverage_source: SolarEstimate['coverage_source']
  let satellite_image_url: string | null = null

  if (coverage.covered) {
    // Re-fetch the raw body for the panel configs roof.ts needs. The
    // coverage gate already proved the call succeeds; fetch once more
    // through the same injected client and parse.
    const raw = await fetchRawInsights(location, opts.solarOpts)
    roof = normaliseSolarRoofFacts(raw, coverage, config)
    coverage_source = 'google'
    satellite_image_url = opts.satelliteImageUrl
      ? await opts.satelliteImageUrl(location)
      : null
  } else if (args.manual) {
    roof = buildManualRoofFacts(args.manual, config)
    coverage_source = 'manual'
  } else {
    // Uncovered and no manual input — return an inspection-routed empty
    // estimate from a synthetic empty manual roof. The customer page will
    // collect the manual answers and re-run.
    roof = buildManualRoofFacts({ orientation: 'unknown', roof_size: 'small', storeys: 1 }, config)
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
 *  Uses the same injected client/key as the coverage gate. */
async function fetchRawInsights(
  location: LatLng,
  solarOpts: SolarEnrichmentOpts | undefined,
): Promise<import('./roof').SolarRoofInsightWithRaw> {
  const { parseBuildingInsights } = await import('../roofing/solar-api')
  const resolved = resolveSolarOpts(solarOpts)
  const base =
    resolved.baseUrl ??
    'https://solar.googleapis.com/v1/buildingInsights:findClosest'
  const url =
    `${base}?location.latitude=${encodeURIComponent(location.lat.toFixed(7))}` +
    `&location.longitude=${encodeURIComponent(location.lng.toFixed(7))}` +
    `&requiredQuality=LOW&key=${encodeURIComponent(resolved.apiKey ?? '')}`
  const fetchImpl = resolved.fetchImpl ?? ((u, init) => fetch(u, init))
  const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
  const body = await res.json()
  const parsed = parseBuildingInsights(body)
  if (!parsed) throw new Error('Solar API raw re-fetch returned no usable roof segments.')
  return { ...parsed, raw: body }
}

/** PURE — collect deterministic-output guardrail breaches (spec §7). */
export function runGuardrails(args: {
  price: SolarEstimate['price']
  production: SolarProductionResult[]
  economics: SolarEstimate['economics']
}): string[] {
  const flags: string[] = []
  const { price, production, economics } = args

  price.tiers.forEach((t, i) => {
    if (t.system_kw_dc > 0) {
      const grossPerKw = t.gross_ex_gst / t.system_kw_dc
      if (grossPerKw < GROSS_PER_KW_MIN || grossPerKw > GROSS_PER_KW_MAX) {
        flags.push(
          `Tier ${t.tier}: gross $${grossPerKw.toFixed(0)}/kW is outside the sane $${GROSS_PER_KW_MIN}–$${GROSS_PER_KW_MAX}/kW band.`,
        )
      }
    }
    // Net must equal gross − rebate (allow 1c rounding tolerance).
    const expectedNet = Math.max(0, t.gross_ex_gst - t.stc.rebate_aud)
    if (Math.abs(t.net_ex_gst - expectedNet) > 0.01) {
      flags.push(`Tier ${t.tier}: net ${t.net_ex_gst} ≠ gross − STC (${expectedNet.toFixed(2)}).`)
    }
    const prod = production[i]
    if (prod && !prod.within_cec_benchmark) {
      flags.push(
        `Tier ${t.tier}: production ${prod.annual_kwh_ac} kWh/yr is outside ±35% of the CEC benchmark (${prod.cec_benchmark_kwh_per_kw} kWh/kW/yr).`,
      )
    }
    const econ = economics.tiers[i]
    if (
      econ &&
      econ.annual_savings_aud > 0 &&
      econ.payback_years_low != null &&
      econ.payback_years_high != null
    ) {
      if (
        econ.payback_years_low < PAYBACK_YEARS_MIN ||
        econ.payback_years_high > PAYBACK_YEARS_MAX
      ) {
        flags.push(
          `Tier ${t.tier}: payback ${econ.payback_years_low}–${econ.payback_years_high} yrs is outside the ${PAYBACK_YEARS_MIN}–${PAYBACK_YEARS_MAX} yr expectation.`,
        )
      }
    }
  })

  return flags
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

export const __test_only__ = {
  runGuardrails,
  GROSS_PER_KW_MIN,
  GROSS_PER_KW_MAX,
  PAYBACK_YEARS_MIN,
  PAYBACK_YEARS_MAX,
}
