// Pure row-shaping for the solar creation route. Mirrors
// lib/roofing/save-as-quote-helpers.ts: turns a SolarEstimate (the
// orchestrator return shape) + tenant/address/customer context into the
// three insert payloads — intakes (trade='solar'), solar_estimates
// (token-keyed, jsonb), and quotes (net price tiers, share_token).
//
// NO I/O. The route owns the actual inserts and stamps quote.intake_id
// after the intake insert returns its id (so we deliberately omit it).

import type { DetectedBuilding, SolarEstimate } from './types'
import { MAX_REQUESTED_SYSTEM_KW } from './limits'

/**
 * Normalise the customer's requested size to a value the solar_estimates
 * `requested_system_kw` CHECK constraint (null OR 0 < kw <= MAX) will always
 * accept. Any non-finite/non-positive request → null (no preference); a
 * request above the ceiling is clamped to it rather than allowed to fail the
 * INSERT. Defence-in-depth: the API/re-draft layers already bound the input,
 * but persistence must never hard-fail on a stored size (the 2026-07-06
 * "could not save your estimate" regression — see lib/solar/limits.ts).
 */
function clampRequestedSystemKw(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.min(value, MAX_REQUESTED_SYSTEM_KW)
}

export type SolarCustomer = {
  name?: string
  phone?: string
  email?: string
}

export type SolarAddressPayload = {
  address: string
  postcode: string
  state: string
}

export function buildSolarRowPayloads(args: {
  estimate: SolarEstimate
  tenantId: string
  address: SolarAddressPayload
  customer?: SolarCustomer
  /** Quote layout variant (Felt tab spec 2026-06-13). Default 'instant'. */
  quoteVariant?: 'instant' | 'felt'
  /**
   * Multi-roof building picker (approach A): the structures detected on the
   * property and which one this initial estimate is for. Default [] / null —
   * a single-building estimate persists an empty list and the picker is
   * hidden. Detection is best-effort (route-level) so the estimate never
   * blocks on it.
   */
  buildings?: DetectedBuilding[]
  selectedBuildingId?: string | null
}) {
  const { estimate, tenantId, address, customer } = args
  const inspection = estimate.routing.decision === 'inspection_required'
  const electricalPhase =
    estimate.context.phase === 'single' || estimate.context.phase === 'three'
      ? estimate.context.phase
      : 'unknown'

  // The "selected" tier mirrors roofing: prefer 'better', else the
  // first priced tier. Solar tiers are 2–3, ascending good→best.
  const priceTiers = estimate.price.tiers
  const selected =
    priceTiers.find((t) => t.tier === 'better') ?? priceTiers[0] ?? null
  const selectedTier = selected?.tier ?? 'better'
  const netEx = selected?.net_ex_gst ?? 0
  const netInc = selected?.net_inc_gst ?? 0
  const gst = Math.max(0, netInc - netEx)

  // Good/Better/Best jsonb for the DEPOSIT path. The customer deposit funnels
  // through the generic short-link /r/<token>/<tier> (app/r/[token]/[tier]),
  // whose fresh-Session mint reads quotes.good/better/best and re-applies GST
  // as subtotal_ex_gst × 1.10 (lib/stripe/checkout.tierIncGstCents). Before
  // this, solar left these columns NULL, so the mint returned null and the
  // deposit link 404'd ("No payment link for this tier") — even for a clean,
  // confirmed estimate. We store subtotal_ex_gst = net_inc_gst / 1.10 so the
  // checkout's ×1.10 reproduces the EXACT net-inc-GST price the /q/solar page
  // showed, and the 30% deposit charged always matches what the customer saw.
  // (The /q/solar page renders from solar_estimates.estimate, not these
  // columns — they exist purely to drive a correct deposit Session.)
  const solarCheckoutTier = (
    t: { system_kw_dc?: number; net_inc_gst?: number } | null | undefined,
  ): { label: string; subtotal_ex_gst: number } | null => {
    if (!t || !t.net_inc_gst || t.net_inc_gst <= 0) return null
    return {
      label: `${t.system_kw_dc ?? 0} kW solar`,
      subtotal_ex_gst: Math.round((t.net_inc_gst / 1.1) * 100) / 100,
    }
  }
  const goodTier = solarCheckoutTier(priceTiers.find((t) => t.tier === 'good'))
  const betterTier = solarCheckoutTier(priceTiers.find((t) => t.tier === 'better'))
  const bestTier = solarCheckoutTier(priceTiers.find((t) => t.tier === 'best'))

  const intake = {
    tenant_id: tenantId,
    trade: 'solar' as const,
    job_type: 'solar_install',
    address: address.address,
    suburb: null as string | null,
    scope: {
      ...estimate.roof,
      coverage_source: estimate.coverage_source,
      state: address.state,
      postcode: address.postcode,
      install_year: estimate.context.install_year,
      network: estimate.context.network,
    },
    access: { storeys: estimate.roof.storeys },
    property: { levels: estimate.roof.storeys ?? null, year_built: null },
    risks: estimate.guardrail_flags,
    inspection_required: inspection,
    caller: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
    },
    timing: { urgency: null },
    confidence: estimate.confidence_band === 'tight' ? 'HIGH' : 'MED',
    confidence_reason: `Solar estimate via ${estimate.coverage_source} roof source — deterministic engine (config ${estimate.config_version}).`,
  }

  const solarEstimate = {
    tenant_id: tenantId,
    public_token: estimate.token,
    address: address.address,
    state: address.state,
    postcode: address.postcode,
    install_year: estimate.context.install_year,
    network: estimate.context.network,
    electrical_phase: electricalPhase,
    requested_system_kw: clampRequestedSystemKw(estimate.context.requested_system_kw),
    coverage_source: estimate.coverage_source,
    imagery_quality: estimate.roof.imagery_quality,
    imagery_date: estimate.roof.imagery_date,
    confidence_band: estimate.confidence_band,
    roof: estimate.roof,
    sizing: estimate.sizing,
    production: estimate.production,
    price: estimate.price,
    economics: estimate.economics,
    satellite_image_url: estimate.satellite_image_url,
    config_version: estimate.config_version,
    routing: estimate.routing.decision,
    guardrail_flags: estimate.guardrail_flags,
    quote_variant: args.quoteVariant ?? 'instant',
    // Multi-roof picker (approach A): the detected structures on the
    // property + which one this `estimate` reflects. [] / null on the
    // single-building path (picker hidden).
    buildings: args.buildings ?? [],
    selected_building_id: args.selectedBuildingId ?? null,
    // Full estimate persisted as jsonb so the /q/solar/[token] page
    // re-renders without recomputation.
    estimate: estimate,
  }

  const quote = {
    tenant_id: tenantId,
    status: 'draft' as const,
    share_token: estimate.token,
    scope_of_works: selected?.scope ?? '',
    assumptions: [
      `System size ${selected?.system_kw_dc ?? 0} kW (DC).`,
      `STC rebate ${selected?.stc.certificates ?? 0} certificates @ $${selected?.stc.stc_price_aud ?? 0}.`,
      `Self-consumption ${Math.round((estimate.economics.assumptions.self_consumption_pct ?? 0) * 100)}%.`,
      ...estimate.price.loadings_applied.map((l) => l.detail),
    ],
    risk_flags:
      estimate.routing.decision !== 'auto_quote'
        ? [estimate.routing.reason, ...estimate.guardrail_flags]
        : estimate.guardrail_flags,
    needs_inspection: inspection,
    inspection_reason: inspection ? estimate.routing.reason : null,
    selected_tier: selectedTier,
    subtotal_ex_gst: netEx,
    gst,
    total_inc_gst: netInc,
    routing_decision: estimate.routing.decision,
    // Deposit-path tiers (see solarCheckoutTier above). Null on an
    // inspection-routed estimate is fine — that path uses the $99 site-visit
    // Session, which needs no tiers.
    good: goodTier,
    better: betterTier,
    best: bestTier,
  }

  return { intake, solarEstimate, quote }
}
