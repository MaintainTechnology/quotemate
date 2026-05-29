// ════════════════════════════════════════════════════════════════════
// Roofing — measurement orchestrator.
//
// Picks a provider, runs the measurement, applies pricing + routing,
// returns the structured result the API route hands to the dashboard.
//
// Provider selection (in order):
//   1. opts.provider — explicit override (tests pass MockRoofingProvider)
//   2. ROOFING_PROVIDER env var — 'geoscape' | 'mock' | 'manual'
//   3. fallback — Geoscape if GEOSCAPE_API_KEY present, else mock
//
// PURE-ish: the orchestrator itself is I/O-free, the provider it calls
// does the network work. Unit tests pass MockRoofingProvider.
// ════════════════════════════════════════════════════════════════════

import type {
  RoofAddressInput,
  RoofMetrics,
  RoofUserInputs,
  RoofingMeasurementResult,
  RoofingQuotePrice,
  RoofingRateCard,
} from './types'
import type { RoofingMeasurementProvider } from './providers/base'
import { GeoscapeProvider } from './providers/geoscape'
import { MockRoofingProvider } from './providers/mock'
import { calculateRoofingPrice, slopedAreaFromFootprint } from './pricing'

export type MeasureRoofOpts = {
  /** Explicit provider override — tests and the dashboard demo path use this. */
  provider?: RoofingMeasurementProvider
  /** Per-tenant rate card. When omitted, pricing.ts default applies. */
  rateCard?: RoofingRateCard
}

export type MeasureRoofResult =
  | {
      ok: true
      metrics: RoofMetrics
      price: RoofingQuotePrice
      provider: RoofingMeasurementProvider['name']
      warnings: string[]
    }
  | {
      ok: false
      code: string
      detail: string
    }

/** PURE — apply the customer's pitch declaration to update sloped area. */
export function reapplyPitchToMetrics(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
): RoofMetrics {
  const sloped = slopedAreaFromFootprint(metrics.footprint_m2, inputs.pitch)
  return { ...metrics, sloped_area_m2: sloped }
}

/** Pick a measurement provider based on opts → env → key presence. */
export function pickProvider(opts: MeasureRoofOpts = {}): RoofingMeasurementProvider {
  if (opts.provider) return opts.provider
  const envChoice = (process.env.ROOFING_PROVIDER ?? '').toLowerCase()
  if (envChoice === 'mock')   return new MockRoofingProvider()
  if (envChoice === 'geoscape') return new GeoscapeProvider()
  // Fallback heuristic
  if (process.env.GEOSCAPE_API_KEY) return new GeoscapeProvider()
  return new MockRoofingProvider()
}

/**
 * Full pipeline: address + customer inputs → measurement → tier prices
 * + routing decision. Best-effort surface: any provider failure surfaces
 * as { ok: false, code, detail } — no throws on operational failure.
 */
export async function measureAndPriceRoof(
  address: RoofAddressInput,
  inputs: RoofUserInputs,
  opts: MeasureRoofOpts = {},
): Promise<MeasureRoofResult> {
  const provider = pickProvider(opts)

  let raw: RoofingMeasurementResult
  try {
    raw = await provider.measure(address)
  } catch (e) {
    return {
      ok: false,
      code: 'provider_unavailable',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  if (!raw.ok) {
    return { ok: false, code: raw.code, detail: raw.detail }
  }

  // The provider used a default pitch to seed sloped area; rerun the
  // pitch correction with the customer's declared bucket so the price
  // matches what the customer just confirmed.
  const metrics = reapplyPitchToMetrics(raw.metrics, inputs)

  const price = calculateRoofingPrice({
    metrics,
    inputs,
    rateCard: opts.rateCard,
  })

  return {
    ok: true,
    metrics,
    price,
    provider: raw.provider,
    warnings: raw.warnings,
  }
}
